import asyncio
import csv
import io
import json
import time
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from backend import main, storage
from backend.connectors import GA4, Sheets, Ads, SearchConsole, YouTube, Business, Drive, APIEndpoint


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DATA", tmp_path)
    monkeypatch.setenv("TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
    main.sessions.clear()
    with TestClient(main.app) as c:
        yield c


def login(client, uid="user1"):
    main.sessions["test"] = {"owner": uid, "expires": time.time()+1000}
    client.cookies.set("extract_session", "test")


def job_record(jid="job1", status="complete", owner="user1", columns=None):
    with storage.db() as c:
        c.execute("INSERT INTO jobs(id,owner,status,spec,columns) VALUES (?,?,?,?,?)", (jid, owner, status, json.dumps({"product": "ga4"}), json.dumps(columns or [])))


def test_auth_and_origin_boundaries(client):
    assert client.get("/jobs").status_code == 401
    assert client.post("/jobs", json={}).status_code == 403
    assert client.post("/jobs", json={}, headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.get("/status", headers={"Host": "evil.example"}).status_code == 400
    login(client)
    job_record(owner="another-user")
    assert client.get("/jobs/job1").status_code == 404
    assert client.get("/jobs/job1/export").status_code == 404


def test_oauth_state_is_browser_bound_and_one_use(client, monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-client")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "test-secret")
    response = client.get("/auth/connect", follow_redirects=False)
    assert response.status_code == 307
    from urllib.parse import urlparse, parse_qs
    query = parse_qs(urlparse(response.headers["location"]).query)
    assert query["code_challenge_method"] == ["S256"]
    assert "analytics.readonly" in query["scope"][0]
    assert "adwords" not in query["scope"][0]
    state = query["state"][0]
    client.cookies.clear()
    assert client.get("/auth/callback?state="+state+"&code=fake").status_code == 400
    assert client.get("/auth/callback?state="+state+"&code=fake").status_code == 400


def test_tokens_are_encrypted(client):
    main.save_token({"access_token": "private-access", "refresh_token": "private-refresh"})
    with storage.db() as c:
        raw = c.execute("SELECT value FROM secrets").fetchone()[0]
    assert b"private-access" not in raw and b"private-refresh" not in raw
    assert main.read_token()["refresh_token"] == "private-refresh"
    assert "private-access" not in client.get("/status").text


def test_encryption_key_accepts_common_env_paste_artifacts(client, monkeypatch):
    key = Fernet.generate_key().decode()
    monkeypatch.setenv("TOKEN_ENCRYPTION_KEY", f'"{key.replace("_", "\\_")}"')
    main.save_token({"access_token": "private-access", "refresh_token": "private-refresh"})
    assert main.read_token()["refresh_token"] == "private-refresh"


def test_tabular_export_deduplication_and_types(client):
    login(client)
    job_record()
    rows = [{"activeUsers": 12, "campaign.id": "00123", "empty": None, "title": 'a,"b"\n雪', "boolean": True}]
    columns = storage.insert_rows("job1", rows+rows, [])
    assert columns == ["active_users", "campaign_id", "empty", "title", "boolean"]
    result = client.get("/jobs/job1").json()
    assert result["count"] == 1
    data = client.get("/jobs/job1/export?format=json").json()
    assert data[0]["campaign_id"] == "00123" and data[0]["active_users"] == 12
    assert data[0]["empty"] is None and data[0]["boolean"] is True
    content = client.get("/jobs/job1/export?format=csv").content.decode("utf-8-sig")
    assert list(csv.DictReader(io.StringIO(content)))[0]["title"] == 'a,"b"\n雪'


def test_failed_export_is_blocked_and_empty_export_keeps_headers(client):
    login(client)
    job_record(status="failed")
    assert client.get("/jobs/job1/export").status_code == 409
    job_record("empty", columns=["date", "sessions"])
    assert client.get("/jobs/empty/export?format=json").json() == []
    assert "date,sessions" in client.get("/jobs/empty/export").text


def test_column_collisions_and_schema_drift(client):
    assert storage.column_names(["A", "a", "a_2", "", "你好"]) == ["a", "a_2", "a_2_2", "column", "column_2"]
    job_record()
    storage.insert_rows("job1", [{"a": 1}], [])
    with pytest.raises(ValueError, match="schema changed"):
        storage.insert_rows("job1", [{"b": 2}], ["a"])


def test_ga4_discovers_all_account_pages_and_types():
    calls = []
    async def api(method, url, **kw):
        calls.append((url, kw))
        if "accountSummaries" in url:
            return {"accountSummaries": [{"displayName": "Account", "propertySummaries": [{"property": "properties/"+str(len(calls)), "displayName": "Website"}]}], **({"nextPageToken": "next"} if len(calls) == 1 else {})}
        offset = kw["json"]["offset"]
        return {"rows": [{"dimensionValues": [{"value": "20260801"}], "metricValues": [{"value": "12"}]}], "metricHeaders": [{"name": "activeUsers", "type": "TYPE_INTEGER"}], "rowCount": 2}
    async def run():
        con = GA4(api)
        assert len(await con.discover()) == 2
        q = SimpleNamespace(resource="properties/1", start="2026-08-01", end="2026-08-02", dimensions=["date"], metrics=["activeUsers"])
        rows = [batch async for batch in con.extract(q)]
        assert len(rows) == 2
        assert rows[0][0] == {"date": "2026-08-01", "activeUsers": 12}
        assert calls[2][0].endswith("/properties/1:runReport")
        assert calls[1][1]["params"]["pageToken"] == "next"
    asyncio.run(run())


def test_sheets_headers_nulls_and_chunking():
    seen = []
    async def api(method, url, **kw):
        seen.append(url)
        if "/values/" not in url:
            return {"sheets": [{"properties": {"title": "Data", "gridProperties": {"rowCount": 2001}}}]}
        if len(seen) == 2:
            return {"values": [["ID", "Amount", "Note"], ["0012", 4.5], ["", "", ""]]}
        return {"values": [["0013", 7, "end"]]}
    async def run():
        batches = [b async for b in Sheets(api).extract(SimpleNamespace(resource="sheet1", options={"tab": "Data"}))]
        assert batches == [[{"id": "0012", "amount": 4.5, "note": None}], [{"id": "0013", "amount": 7, "note": "end"}]]
    asyncio.run(run())


def test_incremental_checkpoint_advances_only_after_success(client):
    q = main.Query(product="ga4", resource="properties/1", start="2026-08-01", end="2026-08-02", dimensions=["date"], metrics=["sessions"], incremental=True)
    class Fake:
        async def extract(self, q):
            yield [{"date": q.start, "sessions": 1}]
    class Failure:
        async def extract(self, q):
            yield [{"date": q.start, "sessions": 2}]
            raise ValueError("Quota exhausted")
    job_record(status="queued")
    asyncio.run(main.run_job("job1", "user1", q, Fake()))
    q.end = "2026-08-03"
    job_record("job2", status="queued")
    asyncio.run(main.run_job("job2", "user1", q, Failure()))
    with storage.db() as c:
        assert c.execute("SELECT end_date FROM checkpoints").fetchone()[0] == "2026-08-02"
        assert c.execute("SELECT status FROM jobs WHERE id='job2'").fetchone()[0] == "failed"


def test_rate_limit_retry_then_success(client, monkeypatch):
    import httpx
    calls = []
    class FakeClient:
        def __init__(self, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def request(self, method, url, **kw):
            calls.append(kw)
            return httpx.Response(429 if len(calls) == 1 else 200, json={"error": {"message": "quota"}} if len(calls) == 1 else {"ok": True}, request=httpx.Request(method, url))
    async def token(*args): return "secret"
    async def sleep(seconds): pass
    monkeypatch.setattr(main.httpx, "AsyncClient", FakeClient)
    monkeypatch.setattr(main, "token_value", token)
    monkeypatch.setattr(main.asyncio, "sleep", sleep)
    assert asyncio.run(main.api("GET", "https://example.googleapis.com")) == {"ok": True}
    assert len(calls) == 2


def test_ads_manager_discovery_and_pagination(monkeypatch):
    monkeypatch.setenv("GOOGLE_ADS_DEVELOPER_TOKEN", "test")
    async def api(method, url, **kw):
        if url.endswith("listAccessibleCustomers"):
            return {"resourceNames": ["customers/100"]}
        if "customer_client" in kw["json"]["query"]:
            return {"results": [{"customerClient": {"id": "200", "descriptiveName": "Client", "manager": False}}]}
        return {"results": [{"campaign": {"id": "001"}, "metrics": {"clicks": "4", "costMicros": "1200000"}}], **({"nextPageToken": "two"} if not kw["json"].get("pageToken") else {})}
    async def run():
        con = Ads(api)
        assert (await con.discover())[0]["id"] == "200:100"
        q = SimpleNamespace(resource="200:100", start="2026-08-01", end="2026-08-02", dimensions=["campaign.id"], metrics=["metrics.clicks", "metrics.cost_micros"])
        batches = [b async for b in con.extract(q)]
        assert len(batches) == 2
        assert batches[0][0] == {"campaign.id": "001", "metrics.clicks": 4, "metrics.cost_micros": 1200000}
    asyncio.run(run())


def test_search_youtube_business_drive_mapping():
    async def api(method, url, **kw):
        if "searchAnalytics" in url:
            assert "sc-domain%3Aexample.com" in url
            return {"rows": [{"keys": ["2026-08-01"], "clicks": 5}]}
        if "youtubeanalytics" in url:
            return {"columnHeaders": [{"name": "day"}, {"name": "views"}], "rows": [["2026-08-01", 7]]}
        if "locations" in url:
            return {"locations": [{"name": "locations/1", "title": "Shop", "storefrontAddress": {"addressLines": ["1 Road"], "regionCode": "GB"}}]}
        return {"files": [{"id": "f1", "name": "Report", "mimeType": "text/csv", "size": "42"}]}
    async def run():
        q = SimpleNamespace(resource="sc-domain:example.com", start="2026-08-01", end="2026-08-02", dimensions=["date"], metrics=["clicks"], options={})
        assert ([b async for b in SearchConsole(api).extract(q)])[0][0]["clicks"] == 5
        q.dimensions, q.metrics = ["day"], ["views"]
        assert ([b async for b in YouTube(api).extract(q)])[0][0]["views"] == 7
        q.resource = "accounts/1"
        assert ([b async for b in Business(api).extract(q)])[0][0]["country"] == "GB"
        assert ([b async for b in Drive(api).extract(q)])[0][0]["size_bytes"] == 42
    asyncio.run(run())


def test_job_creation_preview_and_incremental_range(client, monkeypatch):
    login(client)
    seen = []
    class Fake:
        async def discover(self): return [{"id": "properties/1"}]
        async def fields(self, rid): return {}
        async def extract(self, q):
            seen.append((q.start, q.end))
            yield [{"date": q.start, "sessions": i} for i in range(120)]
    monkeypatch.setattr(main, "connector", lambda product, request: Fake())
    spec = dict(product="ga4", resource="properties/1", start="2026-08-01", end="2026-08-02", dimensions=["date"], metrics=["sessions"], incremental=True)
    headers = {"Origin": main.ORIGIN}
    r = client.post("/jobs", json=spec, headers=headers)
    assert r.status_code == 200, r.text
    jid = r.json()["id"]
    for _ in range(100):
        result = client.get("/jobs/"+jid).json()
        if result["status"] == "complete": break
        time.sleep(.01)
    assert result["status"] == "complete"
    assert result["count"] == 120 and len(result["rows"]) == 50
    assert len(client.get(f"/jobs/{jid}?offset=100").json()["rows"]) == 20
    assert len(client.get(f"/jobs/{jid}/export?format=json").json()) == 120
    assert client.post("/jobs", json=spec, headers=headers).status_code == 409
    spec["end"] = "2026-08-04"
    r = client.post("/jobs", json=spec, headers=headers)
    assert r.status_code == 200
    for _ in range(100):
        if len(seen) == 2: break
        time.sleep(.01)
    assert seen[1] == ("2026-08-03", "2026-08-04")


def test_job_validation_rejects_unauthorized_resources_and_fields(client, monkeypatch):
    login(client)
    class Fake:
        async def discover(self): return [{"id": "properties/1"}]
        async def fields(self, rid): return {}
    monkeypatch.setattr(main, "connector", lambda product, request: Fake())
    spec = dict(product="ga4", resource="properties/unknown", start="2026-08-01", end="2026-08-02", dimensions=["date"], metrics=["sessions"])
    headers = {"Origin": main.ORIGIN}
    assert client.post("/jobs", json=spec, headers=headers).status_code == 403
    spec["resource"] = "properties/1"
    spec["metrics"] = ["arbitrary_field"]
    assert client.post("/jobs", json=spec, headers=headers).status_code == 422
    spec["metrics"] = ["sessions"]
    spec["incremental"] = True
    spec["dimensions"] = ["country"]
    assert client.post("/jobs", json=spec, headers=headers).status_code == 422


def test_api_endpoint_detects_rows_flattens_nested_fields(monkeypatch):
    pages = [
        {"data": {"items": [{"id": "a1", "amount": 3.5, "customer": {"city": "London"}, "tags": ["new"]}], "next": "https://api.example.com/page-2"}},
        {"data": {"items": [{"id": "a2", "amount": 7, "customer": {"city": "Leeds"}, "tags": []}]}},
    ]
    async def fetch(self, url, method, headers, body):
        assert method == "GET"
        return pages.pop(0)
    monkeypatch.setattr(APIEndpoint, "fetch_page", fetch)
    q = SimpleNamespace(options={"url": "https://api.example.com/report", "method": "GET", "data_path": "data.items", "limit": "10"})
    async def run():
        con = APIEndpoint()
        assert (await con.sample(q))[0] == {"id": "a1", "amount": 3.5, "customer.city": "London", "tags": '["new"]'}
        pages.insert(0, {"data": {"items": [{"id": "a1", "amount": 3.5, "customer": {"city": "London"}, "tags": ["new"]}], "next": "https://api.example.com/page-2"}})
        rows = [batch async for batch in con.extract(q)]
        assert rows[1][0]["id"] == "a2"
        assert rows[1][0]["tags"] is None
    asyncio.run(run())


def test_api_endpoint_batch_runs_without_google_login(client, monkeypatch):
    async def fetch(self, url, method, headers, body):
        assert headers["Authorization"] == "Bearer token"
        return {"records": [{"id": 1, "score": 9}, {"id": 2, "score": 10}]}
    monkeypatch.setattr(APIEndpoint, "fetch_page", fetch)
    headers = {"Origin": main.ORIGIN}
    spec = {
        "product": "api",
        "resource": "",
        "start": "2026-08-01",
        "end": "2026-08-02",
        "dimensions": [],
        "metrics": [],
        "options": {"url": "https://api.example.com/records", "method": "GET", "headers": '{"Authorization":"Bearer token"}'},
        "targets": [{"connection_id": "api", "resource": "endpoint"}],
    }
    r = client.post("/batches", json=spec, headers=headers)
    assert r.status_code == 200, r.text
    jid = r.json()["id"]
    for _ in range(100):
        result = client.get("/jobs/"+jid).json()
        if result["status"] == "complete":
            break
        time.sleep(.01)
    assert result["status"] == "complete"
    assert result["count"] == 2
    assert result["columns"] == ["source_google_account", "source_resource_id", "source_resource_name", "id", "score"]
    assert client.get(f"/jobs/{jid}/export?format=json").json()[0]["score"] == 9


def test_direct_query_requires_key_and_streams_ga4(client, monkeypatch):
    login(client)
    monkeypatch.setenv("EXTRACT_API_KEY", "query-secret")
    main.save_token({"access_token": "a", "refresh_token": "r", "sub": "user1", "email": "me@example.com", "scope": "https://www.googleapis.com/auth/analytics.readonly", "expires_at": time.time()+1000}, "user1")
    class Fake:
        async def discover(self): return [{"id": "properties/1", "name": "Site"}]
        async def fields(self, rid): return {"dimensions": ["date"], "metrics": ["sessions"]}
        async def extract(self, q):
            assert q.dimensions == ["date"] and q.metrics == ["sessions"]
            yield [{"date": "2026-08-01", "sessions": 12}]
    monkeypatch.setattr(main, "connector_for_query", lambda product, workspace, connection_id: Fake())
    url = "/query/ga4?workspace=user1&connection_id=user1&resource=properties/1&date_from=2026-08-01&date_to=2026-08-02&fields=date,sessions"
    assert client.get(url).status_code == 401
    data = client.get(url + "&api_key=query-secret").json()
    assert data == [{"date": "2026-08-01", "sessions": 12}]



def test_direct_query_targets_are_self_contained(client, monkeypatch):
    login(client)
    monkeypatch.setenv("EXTRACT_API_KEY", "query-secret")
    seen = []
    class Fake:
        def __init__(self, connection_id):
            self.connection_id = connection_id
        async def discover(self):
            return [{"id": f"properties/{self.connection_id[-1]}", "name": self.connection_id}]
        async def fields(self, rid):
            return {"dimensions": ["date"], "metrics": ["sessions"]}
        async def extract(self, q):
            seen.append((q.connection_id, q.resource, q.options.get("filters")))
            yield [{"date": "2026-08-01", "sessions": len(seen)}]
    monkeypatch.setattr(main, "connector_for_query", lambda product, workspace, connection_id: Fake(connection_id))
    targets = json.dumps([
        {"connection_id": "conn1", "resource": "properties/1", "options": {}},
        {"connection_id": "conn2", "resource": "properties/2", "options": {}},
    ])
    from urllib.parse import quote
    url = "/query/ga4?workspace=user1&date_from=2026-08-01&date_to=2026-08-02&fields=date,sessions&filters=" + quote('{"dimensionFilter":{"filter":{"fieldName":"country"}}}') + "&targets=" + quote(targets) + "&api_key=query-secret"
    assert client.get(url).json() == [{"date": "2026-08-01", "sessions": 1}, {"date": "2026-08-01", "sessions": 2}]
    assert seen == [("conn1", "properties/1", '{"dimensionFilter":{"filter":{"fieldName":"country"}}}'), ("conn2", "properties/2", '{"dimensionFilter":{"filter":{"fieldName":"country"}}}')]


def test_ga4_filter_json_is_sent_to_data_api():
    calls = []
    async def api(method, url, **kw):
        calls.append(kw["json"])
        return {"rows": [], "rowCount": 0}
    async def run():
        q = SimpleNamespace(resource="properties/1", start="2026-08-01", end="2026-08-02", dimensions=["country"], metrics=["sessions"], options={"filters": '{"dimensionFilter":{"filter":{"fieldName":"country"}}}'})
        batches = [b async for b in GA4(api).extract(q)]
        assert batches == [[]]
        assert calls[0]["dimensionFilter"] == {"filter": {"fieldName": "country"}}
    asyncio.run(run())

def test_query_key_is_created_for_connected_workspace(client):
    login(client)
    first = client.get("/query/key").json()["api_key"]
    second = client.get("/query/key").json()["api_key"]
    assert first == second and len(first) > 20
