import asyncio
import json
import time
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from backend import main, storage
from backend.accounts import save_token, read_token, list_accounts, token_key
from backend.connectors import CATALOG


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DATA", tmp_path)
    monkeypatch.setenv("TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
    main.sessions.clear()
    main.oauth_states.clear()
    with TestClient(main.app) as c:
        main.sessions["test"] = {"owner": "primary", "expires": time.time()+1000}
        c.cookies.set("extract_session", "test")
        yield c


def account(subject, workspace="primary", token=None):
    save_token({"sub": subject, "email": subject+"@example.com", "access_token": token or "access-"+subject, "refresh_token": "refresh-"+subject, "scope": " ".join(CATALOG["ga4"]["scopes"]), "expires_at": time.time()+3600}, workspace)


def wait_job(client, jid):
    for _ in range(200):
        result = client.get("/jobs/"+jid).json()
        if result["status"] not in ("queued", "running"):
            return result
        time.sleep(.01)
    raise AssertionError("Job did not complete")


def spec(**extra):
    return {"product": "ga4", "start": "2026-08-01", "end": "2026-08-02", "dimensions": ["date"], "metrics": ["sessions"], "targets": [{"connection_id": "primary", "resource": "properties/1"}, {"connection_id": "second", "resource": "properties/2"}], **extra}


def fake_connectors(monkeypatch, fail_second=False, custom_headers=False):
    class Fake:
        def __init__(self, subject): self.subject = subject
        async def discover(self):
            return [{"id": "properties/1" if self.subject == "primary" else "properties/2", "name": "Website " + self.subject}]
        async def fields(self, rid): return {}
        async def extract(self, q):
            row = {"date": q.start, "sessions": 10}
            if custom_headers:
                row = {"source_resource_id": "user header", "only_"+self.subject: 5}
            yield [row, row]
            if self.subject == "second" and fail_second:
                raise ValueError("Source quota exhausted")
    monkeypatch.setattr(main, "connector", lambda product, request, connection_id=None: Fake(connection_id or "primary"))


def test_multiple_tokens_are_isolated_and_legacy_migration_keeps_credentials(client):
    legacy = {"sub": "primary", "email": "primary@example.com", "refresh_token": "legacy-refresh"}
    with storage.db() as c:
        c.execute("INSERT INTO secrets VALUES ('google',?)", (main.cipher().encrypt(json.dumps(legacy).encode()),))
    assert read_token("intruder", "primary") is None
    assert read_token("primary", "primary")["refresh_token"] == "legacy-refresh"
    account("second")
    account("second", workspace="unrelated", token="other-workspace-token")
    assert {a["id"] for a in list_accounts("primary")} == {"primary", "second"}
    assert read_token("primary", "second")["access_token"] == "access-second"
    assert read_token("unrelated", "second")["access_token"] == "other-workspace-token"
    with storage.db() as c:
        assert not c.execute("SELECT 1 FROM secrets WHERE id='google'").fetchone()


def test_status_reveals_only_workspace_accounts_without_tokens(client):
    account("primary")
    account("second")
    account("outsider", workspace="other")
    r = client.get("/status")
    assert len(r.json()["accounts"]) == 2
    assert "access-" not in r.text and "refresh-" not in r.text and "outsider" not in r.text
    assert r.json()["accounts"][0]["products"] == ["ga4"]


def test_disconnect_one_preserves_others_and_other_workspaces(client):
    account("primary")
    account("second")
    account("outsider", workspace="other")
    headers = {"Origin": main.ORIGIN}
    assert client.post("/auth/disconnect?connection_id=outsider", headers=headers).status_code == 404
    assert client.post("/auth/disconnect?connection_id=second", headers=headers).status_code == 200
    assert read_token("primary", "second") is None
    assert read_token("primary", "primary") is not None
    assert read_token("other", "outsider") is not None
    assert client.get("/status").json()["connected"] is True


def test_oauth_add_login_keeps_primary_and_binds_workspace(client, monkeypatch):
    account("primary")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-client")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "test-secret")
    start = client.get("/auth/connect?product=ga4", follow_redirects=False)
    query = parse_qs(urlparse(start.headers["location"]).query)
    assert "select_account" in query["prompt"][0]
    state = query["state"][0]
    assert main.oauth_states[state]["workspace"] == "primary"
    class FakeClient:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, *args, **kwargs):
            return httpx.Response(200, json={"access_token": "new-access", "refresh_token": "new-refresh", "scope": " ".join(CATALOG["ga4"]["scopes"]), "expires_in": 3600})
        async def get(self, *args, **kwargs):
            return httpx.Response(200, json={"sub": "second", "email": "second@example.com"})
    monkeypatch.setattr(main.httpx, "AsyncClient", FakeClient)
    result = client.get("/auth/callback?state="+state+"&code=valid", follow_redirects=False)
    assert result.status_code == 307
    assert read_token("primary", "primary")["access_token"] == "access-primary"
    assert read_token("primary", "second")["access_token"] == "new-access"
    assert client.get("/status").json()["workspace_owner"] == "primary"


def test_connector_requests_never_switch_tokens_when_adding_a_login(client, monkeypatch):
    account("primary")
    account("second")
    captured = []
    class FakeClient:
        def __init__(self, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def request(self, method, url, **kwargs):
            captured.append(kwargs["headers"]["Authorization"])
            return httpx.Response(200, json={}, request=httpx.Request(method, url))
    monkeypatch.setattr(main.httpx, "AsyncClient", FakeClient)
    async def run():
        await main.api("GET", "https://example.googleapis.com", workspace="primary", connection="primary")
        account("third")
        await main.api("GET", "https://example.googleapis.com", workspace="primary", connection="second")
        await main.api("GET", "https://example.googleapis.com", workspace="primary", connection="primary")
    asyncio.run(run())
    assert captured == ["Bearer access-primary", "Bearer access-second", "Bearer access-primary"]


def test_batch_combines_sources_with_provenance_and_scoped_dedup(client, monkeypatch):
    account("primary")
    account("second")
    fake_connectors(monkeypatch)
    r = client.post("/batches", json=spec(), headers={"Origin": main.ORIGIN})
    assert r.status_code == 200, r.text
    result = wait_job(client, r.json()["id"])
    assert result["status"] == "complete" and result["count"] == 2
    assert len(result["sources"]) == 2
    assert result["columns"] == ["date", "sessions"]
    assert result["rows"] == [{"date": "2026-08-01", "sessions": 10}, {"date": "2026-08-01", "sessions": 10}]
    assert len(client.get(f"/jobs/{result['id']}/export?format=json").json()) == 2


def test_batch_failure_rolls_back_failed_source_and_requires_explicit_partial_export(client, monkeypatch):
    account("primary")
    account("second")
    fake_connectors(monkeypatch, fail_second=True)
    r = client.post("/batches", json=spec(incremental=True), headers={"Origin": main.ORIGIN})
    result = wait_job(client, r.json()["id"])
    assert result["status"] == "partial" and result["count"] == 1
    assert result["sources"][1]["status"] == "failed" and result["sources"][1]["count"] == 0
    assert client.get(f"/jobs/{result['id']}/export?format=json").status_code == 409
    exported = client.get(f"/jobs/{result['id']}/export?format=json&successful_only=true")
    assert len(exported.json()) == 1 and "successful_sources_only" in exported.headers["content-disposition"]
    with storage.db() as c:
        assert c.execute("SELECT COUNT(*) FROM checkpoints").fetchone()[0] == 1


def test_incremental_skips_current_source_and_retries_failed_source(client, monkeypatch):
    account("primary")
    account("second")
    fake_connectors(monkeypatch, fail_second=True)
    headers = {"Origin": main.ORIGIN}
    first = client.post("/batches", json=spec(incremental=True), headers=headers)
    wait_job(client, first.json()["id"])
    fake_connectors(monkeypatch)
    second = client.post("/batches", json=spec(incremental=True), headers=headers)
    result = wait_job(client, second.json()["id"])
    assert result["status"] == "complete"
    assert [s["status"] for s in result["sources"]] == ["skipped", "complete"]
    assert result["count"] == 1


def test_batch_rejects_duplicate_property_and_inaccessible_target(client, monkeypatch):
    fake_connectors(monkeypatch)
    payload = spec()
    payload["targets"][1]["resource"] = "properties/1"
    assert client.post("/batches", json=payload, headers={"Origin": main.ORIGIN}).status_code == 422
    payload["targets"][1]["resource"] = "properties/unauthorized"
    assert client.post("/batches", json=payload, headers={"Origin": main.ORIGIN}).status_code == 403
    with storage.db() as c:
        assert c.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 0


def test_combined_schema_handles_mismatched_headers_and_reserved_names(client, monkeypatch):
    fake_connectors(monkeypatch, custom_headers=True)
    r = client.post("/batches", json=spec(), headers={"Origin": main.ORIGIN})
    result = wait_job(client, r.json()["id"])
    rows = client.get(f"/jobs/{result['id']}/export?format=json").json()
    assert "source_resource_id" not in rows[0]
    assert rows == [{"date": None, "sessions": None}, {"date": None, "sessions": None}]
    assert result["rows"] == rows


def test_other_workspaces_cannot_select_or_authorize_saved_login(client):
    account("outsider", workspace="other")
    assert client.get("/products/ga4/resources?connection_id=outsider").status_code == 401
    assert client.get("/auth/connect?connection_id=outsider").status_code == 403
