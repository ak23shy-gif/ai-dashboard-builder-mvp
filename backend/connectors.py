"""Read-only extraction connectors. Each yields bounded batches of tabular rows."""
import json
import os
import re
from collections.abc import Mapping
from urllib.parse import quote

import httpx

S = "https://www.googleapis.com/auth/"
CATALOG = {
    "ga4": dict(name="Google Analytics 4", description="Website & app performance", scopes=[S+"analytics.readonly"], dimensions=["date", "country", "city", "deviceCategory", "sessionSource", "sessionMedium", "pagePath", "eventName"], metrics=["sessions", "activeUsers", "newUsers", "screenPageViews", "engagedSessions", "eventCount", "totalRevenue"], defaults=["date", "country"], defaultMetrics=["sessions", "activeUsers"], incremental=True),
    "ads": dict(name="Google Ads", description="Campaigns, clicks & ad spend", scopes=[S+"adwords"], dimensions=["segments.date", "campaign.id", "campaign.name", "campaign.status", "segments.device"], metrics=["metrics.impressions", "metrics.clicks", "metrics.cost_micros", "metrics.conversions", "metrics.ctr"], defaults=["segments.date", "campaign.id", "campaign.name"], defaultMetrics=["metrics.impressions", "metrics.clicks", "metrics.cost_micros"], incremental=True, note="Requires a Google Ads developer token. Cost is returned in micros."),
    "search": dict(name="Google Search Console", description="Search queries & organic visibility", scopes=[S+"webmasters.readonly"], dimensions=["date", "query", "page", "country", "device"], metrics=["clicks", "impressions", "ctr", "position"], defaults=["date", "query"], defaultMetrics=["clicks", "impressions", "ctr", "position"], incremental=True, note="Search Console returns top rows, not every query. Google’s privacy and daily data limits still apply."),
    "youtube": dict(name="YouTube Analytics", description="Views, watch time & engagement", scopes=[S+"youtube.readonly", S+"yt-analytics.readonly"], dimensions=["day", "country", "video"], metrics=["views", "estimatedMinutesWatched", "averageViewDuration", "likes", "comments", "subscribersGained"], defaults=["day"], defaultMetrics=["views", "estimatedMinutesWatched"], incremental=True, note="Channel reports only. Google validates compatible dimension/metric combinations. Brand channels may require a separate OAuth selection."),
    "business": dict(name="Google Business Profile", description="Business locations & contact details", scopes=[S+"business.manage"], dimensions=[], metrics=[], defaults=[], defaultMetrics=[], incremental=False, note="Location inventory export. Requires Google Business Profile API approval; the API requires the business.manage scope even for reads."),
    "sheets": dict(name="Google Sheets", description="Spreadsheet rows, ready to export", scopes=[S+"spreadsheets.readonly", S+"drive.metadata.readonly"], dimensions=[], metrics=[], defaults=[], defaultMetrics=[], incremental=False),
    "drive": dict(name="Google Drive", description="File inventory & metadata", scopes=[S+"drive.metadata.readonly"], dimensions=[], metrics=[], defaults=[], defaultMetrics=[], incremental=False, note="Exports file metadata only, without downloading file contents."),
    "api": dict(name="API Endpoint", description="Paste any JSON API endpoint", scopes=[], dimensions=[], metrics=[], defaults=[], defaultMetrics=[], incremental=False, note="Supports JSON REST APIs. Add request headers for API keys or bearer tokens when needed."),
}


def resource(id, name, **extra):
    return dict(id=id, name=name, **extra)


class Connector:
    def __init__(self, api):
        self.api = api

    async def pages(self, url, key, params=None, **kwargs):
        params = dict(params or {})
        while True:
            data = await self.api("GET", url, params=params, **kwargs)
            yield data.get(key, [])
            token = data.get("nextPageToken")
            if not token:
                break
            params["pageToken"] = token

    async def fields(self, rid):
        return {}


class GA4(Connector):
    async def discover(self):
        out = []
        async for accounts in self.pages("https://analyticsadmin.googleapis.com/v1beta/accountSummaries", "accountSummaries", {"pageSize": 200}):
            for account in accounts:
                for p in account.get("propertySummaries", []):
                    out.append(resource(p["property"], p.get("displayName", p["property"]), group=account.get("displayName")))
        return out

    async def fields(self, rid):
        d = await self.api("GET", f"https://analyticsdata.googleapis.com/v1beta/{rid}/metadata")
        return {"dimensions": [x["apiName"] for x in d.get("dimensions", [])], "metrics": [x["apiName"] for x in d.get("metrics", [])]}

    async def extract(self, q):
        offset = 0
        while True:
            d = await self.api("POST", f"https://analyticsdata.googleapis.com/v1beta/{q.resource}:runReport", json={"dateRanges": [{"startDate": q.start, "endDate": q.end}], "dimensions": [{"name": x} for x in q.dimensions], "metrics": [{"name": x} for x in q.metrics], "limit": 10000, "offset": offset, "orderBys": [{"dimension": {"dimensionName": x}} for x in q.dimensions]})
            rows = d.get("rows", [])
            output = []
            for r in rows:
                row = dict(zip(q.dimensions, [v["value"] for v in r.get("dimensionValues", [])]))
                for header, value in zip(d.get("metricHeaders", []), r.get("metricValues", [])):
                    row[header["name"]] = int(value["value"]) if header.get("type") == "TYPE_INTEGER" else float(value["value"])
                if "date" in row and re.fullmatch(r"\d{8}", row["date"]):
                    row["date"] = f'{row["date"][:4]}-{row["date"][4:6]}-{row["date"][6:]}'
                output.append(row)
            yield output
            offset += len(rows)
            if not rows or offset >= int(d.get("rowCount", 0)):
                break


class Ads(Connector):
    @property
    def base(self):
        return "https://googleads.googleapis.com/" + os.getenv("GOOGLE_ADS_API_VERSION", "v25")

    def headers(self, manager=None):
        token = os.getenv("GOOGLE_ADS_DEVELOPER_TOKEN")
        if not token:
            raise ValueError("Add GOOGLE_ADS_DEVELOPER_TOKEN to backend/.env to use Google Ads.")
        return {"developer-token": token, **({"login-customer-id": manager} if manager else {})}

    async def search(self, customer, query, manager=None):
        body = {"query": query}
        while True:
            d = await self.api("POST", f"{self.base}/customers/{customer}/googleAds:search", headers=self.headers(manager), json=body)
            yield d.get("results", [])
            if not d.get("nextPageToken"):
                break
            body["pageToken"] = d["nextPageToken"]

    async def discover(self):
        d = await self.api("GET", self.base+"/customers:listAccessibleCustomers", headers=self.headers())
        out = {}
        for name in d.get("resourceNames", []):
            root = name.split("/")[-1]
            async for rows in self.search(root, "SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager FROM customer_client", root):
                for row in rows:
                    c = row["customerClient"]
                    if not c.get("manager"):
                        cid = str(c["id"])
                        out.setdefault(cid, resource(cid+":"+root, c.get("descriptiveName") or cid, group="Manager / login " + root))
        return list(out.values())

    async def extract(self, q):
        cid, manager = q.resource.split(":")
        fields = q.dimensions + q.metrics
        query = f"SELECT {', '.join(fields)} FROM campaign WHERE segments.date BETWEEN '{q.start}' AND '{q.end}'"
        async for rows in self.search(cid, query, manager):
            out = []
            for row in rows:
                result = {}
                for field in fields:
                    value = row
                    for part in field.split("."):
                        camel = re.sub(r"_([a-z])", lambda m: m[1].upper(), part)
                        value = value.get(camel) if isinstance(value, dict) else None
                    if value is not None and field in q.metrics:
                        value = float(value) if field in ("metrics.conversions", "metrics.ctr") else int(value)
                    result[field] = value
                out.append(result)
            yield out


class SearchConsole(Connector):
    async def discover(self):
        d = await self.api("GET", "https://www.googleapis.com/webmasters/v3/sites")
        return [resource(x["siteUrl"], x["siteUrl"], group=x.get("permissionLevel")) for x in d.get("siteEntry", []) if x.get("permissionLevel") != "siteUnverifiedUser"]

    async def extract(self, q):
        offset = 0
        while True:
            d = await self.api("POST", f"https://www.googleapis.com/webmasters/v3/sites/{quote(q.resource, safe='')}/searchAnalytics/query", json={"startDate": q.start, "endDate": q.end, "dimensions": q.dimensions, "type": q.options.get("search_type", "web"), "rowLimit": 25000, "startRow": offset, "dataState": "final"})
            rows = d.get("rows", [])
            yield [{**dict(zip(q.dimensions, r.get("keys", []))), **{m: r.get(m) for m in q.metrics}} for r in rows]
            if len(rows) < 25000:
                break
            offset += len(rows)


class YouTube(Connector):
    async def discover(self):
        out = []
        async for rows in self.pages("https://www.googleapis.com/youtube/v3/channels", "items", {"part": "snippet", "mine": "true", "maxResults": 50}):
            out.extend(resource(x["id"], x["snippet"]["title"]) for x in rows)
        return out

    async def extract(self, q):
        offset = 1
        while True:
            params = {"ids": "channel=="+q.resource, "startDate": q.start, "endDate": q.end, "metrics": ",".join(q.metrics), "startIndex": offset, "maxResults": 200}
            if q.dimensions:
                params.update(dimensions=",".join(q.dimensions), sort=",".join(q.dimensions))
            d = await self.api("GET", "https://youtubeanalytics.googleapis.com/v2/reports", params=params)
            rows = d.get("rows", [])
            headers = [x["name"] for x in d.get("columnHeaders", [])]
            yield [dict(zip(headers, row)) for row in rows]
            if len(rows) < 200:
                break
            offset += len(rows)


class Business(Connector):
    async def discover(self):
        out = []
        async for rows in self.pages("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", "accounts", {"pageSize": 20}):
            out.extend(resource(x["name"], x.get("accountName", x["name"])) for x in rows)
        return out

    async def extract(self, q):
        async for rows in self.pages(f"https://mybusinessbusinessinformation.googleapis.com/v1/{q.resource}/locations", "locations", {"pageSize": 100, "readMask": "name,title,storeCode,storefrontAddress,websiteUri,phoneNumbers"}):
            yield [{"location_id": r["name"], "title": r.get("title"), "store_code": r.get("storeCode"), "website": r.get("websiteUri"), "phone": r.get("phoneNumbers", {}).get("primaryPhone"), "address": ", ".join(r.get("storefrontAddress", {}).get("addressLines", [])), "city": r.get("storefrontAddress", {}).get("locality"), "postal_code": r.get("storefrontAddress", {}).get("postalCode"), "country": r.get("storefrontAddress", {}).get("regionCode")} for r in rows]


class Sheets(Connector):
    async def discover(self):
        out = []
        async for rows in self.pages("https://www.googleapis.com/drive/v3/files", "files", {"q": "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false", "fields": "nextPageToken,files(id,name)", "pageSize": 1000, "includeItemsFromAllDrives": "true", "supportsAllDrives": "true"}):
            out.extend(resource(x["id"], x["name"]) for x in rows)
        return out

    async def fields(self, rid):
        d = await self.api("GET", f"https://sheets.googleapis.com/v4/spreadsheets/{quote(rid, safe='')}", params={"fields": "sheets.properties"})
        return {"tabs": [s["properties"] for s in d.get("sheets", [])]}

    async def extract(self, q):
        tabs = (await self.fields(q.resource))["tabs"]
        tab = next((t for t in tabs if t["title"] == q.options.get("tab")), None)
        if tab is None:
            raise ValueError("Select a worksheet tab.")
        if tab.get("sheetType", "GRID") != "GRID":
            raise ValueError("Only grid worksheets are supported.")
        title = "'"+tab["title"].replace("'", "''")+"'"
        headers = None
        for start in range(1, tab["gridProperties"]["rowCount"]+1, 2000):
            a1 = f"{title}!{start}:{min(start+1999, tab['gridProperties']['rowCount'])}"
            d = await self.api("GET", f"https://sheets.googleapis.com/v4/spreadsheets/{quote(q.resource, safe='')}/values/{quote(a1, safe='')}", params={"valueRenderOption": "UNFORMATTED_VALUE", "dateTimeRenderOption": "FORMATTED_STRING"})
            rows = d.get("values", [])
            if headers is None:
                if not rows:
                    raise ValueError("The worksheet needs column headers in row 1.")
                from .storage import column_names
                headers = column_names([str(x) if x is not None else "" for x in rows.pop(0)])
            if any(len(r) > len(headers) for r in rows):
                raise ValueError("Some data columns have no header. Add headers to every populated column before extracting.")
            yield [{h: r[i] if i < len(r) and r[i] != "" else None for i, h in enumerate(headers)} for r in rows if any(v not in ("", None) for v in r)]


class Drive(Connector):
    async def discover(self):
        return [resource("all", "All accessible files")]

    async def extract(self, q):
        async for rows in self.pages("https://www.googleapis.com/drive/v3/files", "files", {"q": "trashed=false", "fields": "nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)", "pageSize": 1000, "includeItemsFromAllDrives": "true", "supportsAllDrives": "true"}):
            yield [{"id": x["id"], "name": x["name"], "mime_type": x["mimeType"], "size_bytes": int(x["size"]) if x.get("size") else None, "modified_time": x.get("modifiedTime"), "web_view_link": x.get("webViewLink")} for x in rows]


def path_value(value, path):
    if not path:
        return value
    current = value
    for part in [p.strip() for p in path.split(".") if p.strip()]:
        if isinstance(current, Mapping):
            current = current.get(part)
        elif isinstance(current, list) and part.isdigit():
            current = current[int(part)] if int(part) < len(current) else None
        else:
            return None
    return current


def find_rows(value):
    if isinstance(value, list):
        return [row for row in value if isinstance(row, Mapping)]
    if not isinstance(value, Mapping):
        return []
    for key in ("data", "results", "items", "records", "rows", "values"):
        rows = find_rows(value.get(key))
        if rows:
            return rows
    return [value]


def flatten(value, prefix=""):
    out = {}
    if isinstance(value, Mapping):
        for key, item in value.items():
            name = f"{prefix}.{key}" if prefix else str(key)
            if isinstance(item, Mapping):
                out.update(flatten(item, name))
            elif isinstance(item, list):
                out[name] = json.dumps(item, ensure_ascii=False, separators=(",", ":")) if item else None
            else:
                out[name] = item
    return out


def parse_json_object(raw, label):
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except ValueError as exc:
        raise ValueError(f"{label} must be valid JSON.") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be a JSON object.")
    return value


class APIEndpoint(Connector):
    allowed_methods = {"GET", "POST"}

    def __init__(self, api=None):
        self.api = api

    async def discover(self):
        return [resource("endpoint", "Pasted API endpoint")]

    def request_options(self, q):
        url = q.options.get("url", "").strip()
        if not url:
            raise ValueError("Paste an API endpoint URL.")
        parsed = httpx.URL(url)
        if parsed.scheme not in ("http", "https"):
            raise ValueError("Only HTTP and HTTPS API endpoints are supported.")
        method = q.options.get("method", "GET").upper()
        if method not in self.allowed_methods:
            raise ValueError("Choose GET or POST for the API request.")
        headers = {"Accept": "application/json", **{str(k): str(v) for k, v in parse_json_object(q.options.get("headers"), "Headers JSON").items()}}
        body = parse_json_object(q.options.get("body"), "Body JSON") if method == "POST" else None
        return str(parsed), method, headers, body, q.options.get("data_path", "").strip()

    async def fetch_page(self, url, method, headers, body):
        async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=20), follow_redirects=True) as client:
            response = await client.request(method, url, headers=headers, json=body if method == "POST" else None)
        if response.status_code in (401, 403):
            raise ValueError("The API rejected the request. Check the headers or access token.")
        if response.is_error:
            raise ValueError(f"API request failed with HTTP {response.status_code}.")
        try:
            return response.json()
        except ValueError as exc:
            raise ValueError("The API response is not valid JSON.") from exc

    def next_url(self, data):
        for path in ("next", "next_url", "data.next", "links.next", "pagination.next", "paging.next"):
            value = path_value(data, path)
            if isinstance(value, str) and value.startswith(("http://", "https://")):
                return value
        return None

    async def sample(self, q):
        url, method, headers, body, data_path = self.request_options(q)
        data = await self.fetch_page(url, method, headers, body)
        return [flatten(row) for row in find_rows(path_value(data, data_path))]

    async def fields(self, rid):
        return {}

    async def extract(self, q):
        url, method, headers, body, data_path = self.request_options(q)
        limit = min(int(q.options.get("limit") or 100000), 1000000)
        total = pages = 0
        while url and pages < 50 and total < limit:
            data = await self.fetch_page(url, method, headers, body)
            rows = [flatten(row) for row in find_rows(path_value(data, data_path))]
            if not rows and pages == 0:
                raise ValueError("The API returned JSON, but no usable table rows were found.")
            remaining = limit - total
            batch = rows[:remaining]
            total += len(batch)
            yield batch
            pages += 1
            url = self.next_url(data)


CONNECTORS = dict(ga4=GA4, ads=Ads, search=SearchConsole, youtube=YouTube, business=Business, sheets=Sheets, drive=Drive, api=APIEndpoint)
