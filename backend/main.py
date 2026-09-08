import asyncio
import base64
import hashlib
import json
import os
import random
import secrets
import time
from contextlib import asynccontextmanager
from datetime import date, timedelta
from functools import partial
from pathlib import Path
from urllib.parse import urlencode

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse, StreamingResponse
from pydantic import BaseModel, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .connectors import CATALOG, CONNECTORS
from .storage import db, init, insert_rows, export_rows, column_names
from .accounts import cipher, save_token, read_token, list_accounts, remove_account

load_dotenv(Path(__file__).parent / ".env")
ORIGIN = os.getenv("APP_ORIGIN", "http://127.0.0.1:3001").rstrip("/")
REDIRECT = os.getenv("GOOGLE_REDIRECT_URI", ORIGIN+"/extract-api/auth/callback")
ALLOWED_HOSTS = [h.strip() for h in os.getenv("BACKEND_ALLOWED_HOSTS", "127.0.0.1,localhost,testserver").split(",") if h.strip()]
sessions = {}
oauth_states = {}
tasks = set()
refresh_lock = asyncio.Lock()
job_lock = asyncio.Lock()


def get_query_key():
    return get_workspace_query_key("local-api")


def get_workspace_query_key(workspace):
    configured = os.getenv("EXTRACT_API_KEY")
    if configured:
        return configured
    with db() as c:
        secret_id = "query_api_key:" + workspace
        row = c.execute("SELECT value FROM secrets WHERE id=?", (secret_id,)).fetchone()
        if row:
            return cipher().decrypt(row[0]).decode()
        key = secrets.token_urlsafe(32)
        c.execute("INSERT INTO secrets(id,value) VALUES (?,?)", (secret_id, cipher().encrypt(key.encode())))
        return key


def require_query_key(request, workspace="local-api"):
    supplied = request.query_params.get("api_key") or request.headers.get("x-api-key", "")
    if not supplied or not secrets.compare_digest(supplied, get_workspace_query_key(workspace)):
        raise HTTPException(401, "Valid api_key is required.")


def create_session(workspace):
    sid = secrets.token_urlsafe(48)
    expires = time.time()+86400*7
    sessions[sid] = dict(owner=workspace, expires=expires)
    with db() as c:
        c.execute("DELETE FROM sessions WHERE expires<?", (time.time(),))
        c.execute("INSERT INTO sessions(id,owner,expires) VALUES (?,?,?)", (sid, workspace, expires))
    return sid


def read_session(sid):
    session = sessions.get(sid)
    if session and session["expires"] >= time.time():
        return session
    if not sid:
        return None
    with db() as c:
        row = c.execute("SELECT owner,expires FROM sessions WHERE id=?", (sid,)).fetchone()
    if not row or row["expires"] < time.time():
        return None
    session = dict(owner=row["owner"], expires=row["expires"])
    sessions[sid] = session
    return session


def delete_workspace_sessions(workspace):
    for sid in [sid for sid, session in sessions.items() if session["owner"] == workspace]:
        del sessions[sid]
    with db() as c:
        c.execute("DELETE FROM sessions WHERE owner=?", (workspace,))


def save_oauth_state(state, value):
    oauth_states[state] = value
    with db() as c:
        c.execute("DELETE FROM oauth_states WHERE expires<?", (time.time(),))
        c.execute("INSERT INTO oauth_states(id,data,expires) VALUES (?,?,?)", (state, json.dumps(value), value["expires"]))


def pop_oauth_state(state):
    value = oauth_states.pop(state, None)
    with db() as c:
        row = c.execute("SELECT data FROM oauth_states WHERE id=?", (state,)).fetchone()
        c.execute("DELETE FROM oauth_states WHERE id=?", (state,))
    if value:
        return value
    return json.loads(row["data"]) if row else None


def owner(request):
    session = read_session(request.cookies.get("extract_session"))
    if not session or session["expires"] < time.time():
        raise HTTPException(401, "Connect Google to continue.")
    return session["owner"]


def job_owner(request, product=None):
    if product == "api":
        return "local-api"
    return owner(request)


async def token_value(workspace=None, connection=None):
    async with refresh_lock:
        token = read_token(workspace, connection)
        if not token:
            raise HTTPException(401, "Reconnect Google.")
        if token.get("expires_at", 0) < time.time()+60:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.post("https://oauth2.googleapis.com/token", data={"client_id": os.getenv("GOOGLE_CLIENT_ID"), "client_secret": os.getenv("GOOGLE_CLIENT_SECRET"), "refresh_token": token.get("refresh_token"), "grant_type": "refresh_token"})
            if response.status_code != 200:
                raise HTTPException(401, "Google session expired or was revoked. Reconnect Google.")
            token.update(response.json())
            token["expires_at"] = time.time()+token.get("expires_in", 3600)
            save_token(token, workspace)
        return token["access_token"]


async def api(method, url, workspace=None, connection=None, **kwargs):
    headers = dict(kwargs.pop("headers", {}))
    async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=20)) as client:
        for attempt in range(6):
            headers["Authorization"] = "Bearer " + await token_value(workspace, connection)
            try:
                response = await client.request(method, url, headers=headers, **kwargs)
            except (httpx.TimeoutException, httpx.NetworkError):
                if attempt == 5:
                    raise ValueError("Google could not be reached after six attempts. Retry the extraction.")
                await asyncio.sleep(min(2**attempt + random.random(), 32))
                continue
            if response.status_code == 401 and attempt == 0:
                token = read_token(workspace, connection)
                if not token:
                    raise HTTPException(401, "Reconnect this Google account.")
                token["expires_at"] = 0
                save_token(token, workspace)
                continue
            try:
                body = response.json()
            except ValueError:
                body = {}
            error = body.get("error", {}) if isinstance(body, dict) else {}
            retryable = response.status_code in (429, 500, 502, 503, 504) or (response.status_code == 403 and any(e.get("reason") in ("rateLimitExceeded", "userRateLimitExceeded") for e in error.get("errors", [])))
            if retryable and attempt < 5:
                try:
                    delay = min(float(response.headers.get("Retry-After", 2**attempt)), 120)
                except ValueError:
                    delay = 2**attempt
                await asyncio.sleep(delay + random.random())
                continue
            if response.is_error:
                message = error.get("message", "Google API request failed.") if isinstance(error, dict) else "Google API request failed."
                raise ValueError(f"Google API ({response.status_code}): {message}")
            return body
    raise ValueError("Google request retries exhausted.")


@asynccontextmanager
async def lifespan(app):
    init()
    yield
    for task in list(tasks):
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


app = FastAPI(title="Google Extract", lifespan=lifespan)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)


@app.middleware("http")
async def local_security(request, call_next):
    if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("origin") != ORIGIN:
        return JSONResponse({"detail": "Untrusted request origin."}, 403)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@app.exception_handler(ValueError)
async def bad_input(request, exc):
    return JSONResponse({"detail": str(exc)}, status_code=400)


@app.get("/status")
async def status(request: Request):
    configured = all(os.getenv(k) for k in ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY"))
    session = read_session(request.cookies.get("extract_session")) or {}
    connected = bool(session.get("expires", 0) > time.time())
    accounts = list_accounts(session["owner"]) if connected else []
    public_accounts = [{"id": a["id"], "email": a["email"], "products": [pid for pid, meta in CATALOG.items() if meta["scopes"] and set(meta["scopes"]).issubset(a["scopes"])]} for a in accounts]
    return {"configured": configured, "connected": connected and bool(accounts), "email": accounts[0]["email"] if accounts else None, "workspace_owner": session.get("owner") if connected else None, "accounts": public_accounts, "products": [{"id": k, **{a: b for a, b in v.items() if a != "scopes"}} for k, v in CATALOG.items()]}


@app.get("/auth/connect")
async def connect(request: Request, product: str = "ga4", connection_id: str = ""):
    if product not in CATALOG:
        raise HTTPException(404, "Unknown connector.")
    if not os.getenv("GOOGLE_CLIENT_ID") or not os.getenv("GOOGLE_CLIENT_SECRET"):
        raise HTTPException(503, "Configure Google OAuth in backend/.env first. See README.md.")
    cipher()
    state, verifier, browser = secrets.token_urlsafe(32), secrets.token_urlsafe(48), secrets.token_urlsafe(32)
    for key in list(oauth_states):
        if oauth_states[key]["expires"] < time.time():
            del oauth_states[key]
    session = read_session(request.cookies.get("extract_session")) or {}
    workspace = session.get("owner") if session.get("expires", 0) > time.time() else None
    existing = read_token(workspace, connection_id) if workspace and connection_id else None
    if connection_id and not existing:
        raise HTTPException(403, "This Google account is not connected to your workspace.")
    save_oauth_state(state, dict(verifier=verifier, browser=browser, expires=time.time()+600, workspace=workspace, connection=connection_id))
    query = {"client_id": os.getenv("GOOGLE_CLIENT_ID"), "redirect_uri": REDIRECT, "response_type": "code", "scope": " ".join(["openid", "email"] + CATALOG[product]["scopes"]), "state": state, "access_type": "offline", "prompt": "consent", "include_granted_scopes": "true", "code_challenge": base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode(), "code_challenge_method": "S256"}
    if existing:
        query["login_hint"] = existing.get("email", connection_id)
    else:
        query["prompt"] = "consent select_account"
    response = RedirectResponse("https://accounts.google.com/o/oauth2/v2/auth?"+urlencode(query))
    response.set_cookie("extract_oauth", browser, httponly=True, samesite="lax", max_age=600, secure=ORIGIN.startswith("https:"))
    return response


@app.get("/auth/callback")
async def callback(request: Request, state: str = "", code: str = "", error: str = ""):
    saved = pop_oauth_state(state)
    if not saved or saved["expires"] < time.time() or not secrets.compare_digest(saved["browser"], request.cookies.get("extract_oauth", "")):
        raise HTTPException(400, "Invalid or expired OAuth state. Connect Google again.")
    if error or not code:
        return RedirectResponse(ORIGIN+"/?auth_error=Google+connection+was+cancelled")
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post("https://oauth2.googleapis.com/token", data={"client_id": os.getenv("GOOGLE_CLIENT_ID"), "client_secret": os.getenv("GOOGLE_CLIENT_SECRET"), "redirect_uri": REDIRECT, "code": code, "code_verifier": saved["verifier"], "grant_type": "authorization_code"})
        if r.status_code != 200:
            raise HTTPException(400, "Google authorization failed. Connect again.")
        token = r.json()
        profile = await client.get("https://openidconnect.googleapis.com/v1/userinfo", headers={"Authorization": "Bearer "+token["access_token"]})
        if profile.status_code != 200:
            raise HTTPException(400, "Google identity could not be verified.")
    user = profile.json()
    if saved.get("connection") and saved["connection"] != user["sub"]:
        raise HTTPException(400, "A different Google account was selected. Use Add Google account to connect a new login.")
    workspace = saved.get("workspace") or user["sub"]
    async with refresh_lock:
        old = read_token(workspace, user["sub"])
        if old and old.get("sub") == user["sub"] and not token.get("refresh_token"):
            token["refresh_token"] = old.get("refresh_token")
        token.update(email=user.get("email"), sub=user["sub"], expires_at=time.time()+token.get("expires_in", 3600))
        # Each connector is bound to its own subject; adding a login never switches a running job.
        save_token(token, workspace)
    sid = create_session(workspace)
    response = RedirectResponse(ORIGIN)
    response.set_cookie("extract_session", sid, httponly=True, samesite="lax", max_age=86400*7, secure=ORIGIN.startswith("https:"))
    response.delete_cookie("extract_oauth")
    return response


@app.post("/auth/disconnect")
async def disconnect(request: Request, connection_id: str = ""):
    uid = owner(request)
    accounts = list_accounts(uid)
    targets = [a["id"] for a in accounts] if not connection_id else [connection_id]
    if connection_id and connection_id not in {a["id"] for a in accounts}:
        raise HTTPException(404, "Google account not found.")
    async with job_lock:
        with db() as c:
            if c.execute("SELECT 1 FROM jobs WHERE owner=? AND status IN ('queued','running')", (uid,)).fetchone():
                raise HTTPException(409, "Wait for your extraction to finish before disconnecting an account.")
        async with refresh_lock:
            for subject in targets:
                remove_account(uid, subject)
    response = JSONResponse({"ok": True})
    if not connection_id:
        delete_workspace_sessions(uid)
        response.delete_cookie("extract_session")
    return response


def connector(product, request, connection_id=None):
    if product == "api":
        return CONNECTORS[product]()
    uid = owner(request)
    if product not in CONNECTORS:
        raise HTTPException(404, "Unknown connector.")
    subject = connection_id or uid
    token = read_token(uid, subject)
    if not token or token.get("sub") != subject:
        raise HTTPException(401, "Reconnect Google.")
    granted = set(token.get("scope", "").split())
    if not set(CATALOG[product]["scopes"]).issubset(granted):
        raise HTTPException(403, "Authorize this product to discover its resources. Existing property permissions will be used automatically.")
    return CONNECTORS[product](partial(api, workspace=uid, connection=subject))


def connector_for_query(product, workspace, connection_id):
    if product == "api":
        return CONNECTORS[product]()
    if product not in CONNECTORS:
        raise HTTPException(404, "Unknown connector.")
    token = read_token(workspace, connection_id or workspace)
    if not token:
        raise HTTPException(401, "Reconnect Google before using this query.")
    granted = set(token.get("scope", "").split())
    if not set(CATALOG[product]["scopes"]).issubset(granted):
        raise HTTPException(403, "Authorize this product before using this query.")
    return CONNECTORS[product](partial(api, workspace=workspace, connection=connection_id or workspace))


@app.get("/query/key")
async def query_key(request: Request):
    uid = owner(request)
    return {"api_key": get_workspace_query_key(uid)}


def split_csv(value):
    return [item.strip() for item in value.split(",") if item.strip()]


def parse_targets(value):
    if not value:
        return []
    try:
        targets = json.loads(value)
    except json.JSONDecodeError:
        raise HTTPException(422, "targets must be a JSON array.")
    if not isinstance(targets, list) or len(targets) > 100:
        raise HTTPException(422, "targets must be an array with 1 to 100 sources.")
    parsed = []
    for target in targets:
        if not isinstance(target, dict):
            raise HTTPException(422, "Each target must be an object.")
        connection_id = str(target.get("connection_id", "")).strip()
        resource_id = str(target.get("resource", "")).strip()
        options = target.get("options") or {}
        if not connection_id or not resource_id or not isinstance(options, dict):
            raise HTTPException(422, "Each target needs connection_id, resource, and optional options.")
        parsed.append({"connection_id": connection_id, "resource": resource_id, "options": {str(k): str(v) for k, v in options.items() if v is not None}})
    return parsed


async def query_rows(q):
    targets = q.get("targets") or [{"connection_id": q.get("connection_id", ""), "resource": resource_id, "options": {}} for resource_id in q["resources"]]
    connector_cache, discovery_cache = {}, {}
    for target in targets:
        resource_id = target["resource"]
        target_options = {**q["options"], **target.get("options", {})}
        if q["product"] != "api":
            cid = target.get("connection_id") or q.get("connection_id", "")
            con = connector_cache.get(cid)
            if con is None:
                con = connector_for_query(q["product"], q.get("workspace", ""), cid)
                connector_cache[cid] = con
            if cid not in discovery_cache:
                discovery_cache[cid] = {r["id"]: r for r in await con.discover()}
            discovered = discovery_cache[cid]
            if resource_id not in discovered:
                raise HTTPException(403, f"Resource is not accessible: {resource_id}")
            meta = {**CATALOG[q["product"]], **await con.fields(resource_id)}
            dimensions, metrics = q["dimensions"], q["metrics"]
            if q.get("fields") and not (dimensions or metrics):
                fields = q["fields"]
                dimensions = [field for field in fields if field in meta["dimensions"]]
                metrics = [field for field in fields if field in meta["metrics"]]
            query = Query(product=q["product"], resource=resource_id, start=q["start"], end=q["end"], dimensions=dimensions, metrics=metrics, options=target_options, connection_id=cid)
            if not set(query.dimensions).issubset(meta["dimensions"]) or not set(query.metrics).issubset(meta["metrics"]):
                raise HTTPException(422, "Choose fields supported by this product.")
        else:
            con = connector_for_query("api", q.get("workspace", "local-api"), "api")
            query = Query(product="api", resource="endpoint", start=q["start"], end=q["end"], dimensions=[], metrics=[], options=target_options, connection_id="api")
        async for batch in con.extract(query):
            for row in batch:
                yield row


@app.get("/query/{product}")
async def direct_query(product: str, request: Request, format: str = "json"):
    if product not in CONNECTORS:
        raise HTTPException(404, "Unknown connector.")
    params = request.query_params
    workspace = params.get("workspace", "local-api" if product == "api" else "")
    if product != "api" and not workspace:
        raise HTTPException(422, "Add workspace to the query.")
    require_query_key(request, workspace)
    resources = split_csv(params.get("resources") or params.get("resource", ""))
    targets = parse_targets(params.get("targets", ""))
    if product != "api" and not resources and not targets:
        raise HTTPException(422, "Add resource, resources, or targets to the query.")
    if targets and not resources:
        resources = [target["resource"] for target in targets]
    start = params.get("date_from") or params.get("start") or date.today().isoformat()
    end = params.get("date_to") or params.get("end") or date.today().isoformat()
    options = {k: v for k, v in params.items() if k.startswith("option_")}
    options = {k.removeprefix("option_"): v for k, v in options.items()}
    if params.get("filters"):
        options["filters"] = params["filters"]
    if product == "api":
        options.update({k: params[k] for k in ("url", "method", "headers", "body", "data_path", "limit") if k in params})
        resources = ["endpoint"]
        if not targets:
            targets = [{"connection_id": "api", "resource": "endpoint", "options": options}]
    spec = {
        "product": product,
        "workspace": workspace,
        "connection_id": params.get("connection_id", ""),
        "resources": resources,
        "targets": targets,
        "start": start,
        "end": end,
        "fields": split_csv(params.get("fields", "")),
        "dimensions": split_csv(params.get("dimensions", "")),
        "metrics": split_csv(params.get("metrics", "")),
        "options": options,
    }
    if format not in ("json", "csv"):
        raise HTTPException(422, "Choose json or csv.")
    if format == "json":
        async def stream_json():
            columns, first = [], True
            yield "["
            async for row in query_rows(spec):
                names = column_names(row.keys())
                clean = dict(zip(names, row.values()))
                columns = list(dict.fromkeys(columns + names))
                yield ("" if first else ",") + json.dumps({k: clean.get(k) for k in columns}, ensure_ascii=False, allow_nan=False)
                first = False
            yield "]"
        return StreamingResponse(stream_json(), media_type="application/json")
    async def stream_csv():
        import csv, io
        rows, columns = [], []
        async for row in query_rows(spec):
            names = column_names(row.keys())
            clean = dict(zip(names, row.values()))
            columns = list(dict.fromkeys(columns + names))
            rows.append(clean)
        buf = io.StringIO(newline="")
        writer = csv.writer(buf, lineterminator="\r\n")
        writer.writerow(columns)
        yield "\ufeff" + buf.getvalue()
        for row in rows:
            buf.seek(0); buf.truncate(0)
            writer.writerow([row.get(k) for k in columns])
            yield buf.getvalue()
    return StreamingResponse(stream_csv(), media_type="text/csv; charset=utf-8")


@app.get("/products/{product}/resources")
async def resources(product: str, request: Request, connection_id: str = ""):
    if product == "api":
        return await connector(product, request).discover()
    return await connector(product, request, connection_id or None).discover()


@app.get("/products/{product}/fields")
async def fields(product: str, resource: str, request: Request, connection_id: str = ""):
    con = connector(product, request, connection_id or None)
    if product == "api":
        sample_query = Query(product=product, resource=resource, start=date.today().isoformat(), end=date.today().isoformat(), options=dict(request.query_params))
        sample = await con.sample(sample_query)
        columns = list(dict.fromkeys(key for row in sample[:100] for key in row))
        numeric = [key for key in columns if any(isinstance(row.get(key), (int, float)) and not isinstance(row.get(key), bool) for row in sample[:100])]
        return {"dimensions": columns, "metrics": numeric, "sampleRows": len(sample)}
    if resource not in {r["id"] for r in await con.discover()}:
        raise HTTPException(403, "Select an accessible resource.")
    return await con.fields(resource)


class Query(BaseModel):
    product: str
    resource: str = Field(min_length=1, max_length=2000)
    start: str
    end: str
    dimensions: list[str] = Field(default_factory=list, max_length=100)
    metrics: list[str] = Field(default_factory=list, max_length=100)
    options: dict[str, str] = Field(default_factory=dict)
    incremental: bool = False
    connection_id: str = Field(default="", max_length=200)


def checkpoint_key(uid, q):
    spec = q.model_dump(exclude={"start", "end", "incremental"})
    if spec.get("connection_id") in ("", uid):
        spec.pop("connection_id", None)
    return hashlib.sha256((uid+json.dumps(spec, sort_keys=True)).encode()).hexdigest()


async def validate_query(q, request, discovery_cache=None, connector_cache=None):
    uid = job_owner(request, q.product)
    cid = q.connection_id or uid
    if connector_cache is not None and cid in connector_cache:
        con = connector_cache[cid]
    else:
        con = connector(q.product, request, q.connection_id) if q.connection_id else connector(q.product, request)
        if connector_cache is not None:
            connector_cache[cid] = con
    if q.product == "api":
        start = end = date.today()
        q.start, q.end = start.isoformat(), end.isoformat()
        discovered = {"endpoint": {"id": "endpoint", "name": q.options.get("url", "Pasted API endpoint")}}
        q.resource = "endpoint"
    else:
        try:
            start, end = date.fromisoformat(q.start), date.fromisoformat(q.end)
        except ValueError:
            raise HTTPException(422, "Use ISO dates (YYYY-MM-DD).")
        if start > end or end > date.today():
            raise HTTPException(422, "Choose a valid date range ending today or earlier.")
        q.start, q.end = start.isoformat(), end.isoformat()
        if discovery_cache is not None and cid in discovery_cache:
            discovered = discovery_cache[cid]
        else:
            discovered = {r["id"]: r for r in await con.discover()}
            if discovery_cache is not None:
                discovery_cache[cid] = discovered
    if q.resource not in discovered:
        raise HTTPException(403, "Resource is not accessible to this Google account.")
    if q.product == "api":
        sample = await con.sample(q)
        inferred = list(dict.fromkeys(key for row in sample[:100] for key in row))
        meta = {**CATALOG[q.product], "dimensions": inferred, "metrics": inferred}
    else:
        meta = {**CATALOG[q.product], **await con.fields(q.resource)}
    if len(set(q.dimensions)) != len(q.dimensions) or len(set(q.metrics)) != len(q.metrics):
        raise HTTPException(422, "Duplicate fields are not allowed.")
    if not set(q.dimensions).issubset(meta["dimensions"]) or not set(q.metrics).issubset(meta["metrics"]):
        raise HTTPException(422, "Choose fields supported by this product.")
    if q.product == "api" and not (q.dimensions or q.metrics):
        q.dimensions = meta["dimensions"]
    if q.product != "api" and meta["metrics"] and not q.metrics:
        raise HTTPException(422, "Select at least one metric.")
    if q.product == "ga4" and (len(q.dimensions) > 9 or len(q.metrics) > 10):
        raise HTTPException(422, "GA4 allows up to 9 dimensions and 10 metrics per report.")
    if q.product == "search" and q.options.get("search_type", "web") not in ("web", "image", "video", "news", "discover", "googleNews"):
        raise HTTPException(422, "Invalid search type.")
    date_dim = {"ga4": "date", "ads": "segments.date", "search": "date", "youtube": "day"}.get(q.product)
    if q.incremental and (not date_dim or date_dim not in q.dimensions):
        raise HTTPException(422, "Incremental extraction requires the product's date dimension.")
    return uid, con, discovered[q.resource]


@app.post("/jobs")
async def extract(q: Query, request: Request):
    uid, con, _ = await validate_query(q, request)
    start = date.fromisoformat(q.start)
    async with job_lock:
        with db() as c:
            if c.execute("SELECT 1 FROM jobs WHERE status IN ('queued','running')").fetchone():
                raise HTTPException(409, "An extraction is already running. Wait for it to finish.")
            if q.incremental:
                saved = c.execute("SELECT end_date FROM checkpoints WHERE id=?", (checkpoint_key(uid, q),)).fetchone()
                if saved:
                    q.start = max(start, date.fromisoformat(saved[0])+timedelta(days=1)).isoformat()
                    if q.start > q.end:
                        raise HTTPException(409, "Already extracted through this end date. Choose a later end date or turn off incremental mode.")
            jid = ("api_" if q.product == "api" else "") + secrets.token_hex(16)
            columns = column_names(q.dimensions + q.metrics)
            c.execute("INSERT INTO jobs(id,owner,status,spec,columns) VALUES (?,?,'queued',?,?)", (jid, uid, q.model_dump_json(), json.dumps(columns)))
        task = asyncio.create_task(run_job(jid, uid, q, con))
        tasks.add(task)
        task.add_done_callback(tasks.discard)
    return {"id": jid}


class SourceSelection(BaseModel):
    connection_id: str = Field(min_length=1, max_length=200)
    resource: str = Field(min_length=1, max_length=2000)
    options: dict[str, str] = Field(default_factory=dict)


class BatchQuery(Query):
    resource: str = ""
    targets: list[SourceSelection] = Field(min_length=1, max_length=100)


@app.post("/batches")
async def batch_extract(q: BatchQuery, request: Request):
    uid = job_owner(request, q.product)
    prepared, seen, discoveries, connectors = [], set(), {}, {}
    for target in q.targets:
        # A resource selected through two logins must not double the reported totals.
        canonical = target.resource.split(":")[0] if q.product == "ads" else target.resource
        if canonical in seen:
            raise HTTPException(422, "The same resource was selected more than once. Select it under one Google login only.")
        seen.add(canonical)
        spec = q.model_dump(exclude={"targets", "resource", "connection_id"})
        source_query = Query(**{**spec, "resource": target.resource, "connection_id": target.connection_id, "options": {**q.options, **target.options}})
        _, con, resource_meta = await validate_query(source_query, request, discoveries, connectors)
        token = read_token(uid, target.connection_id) if q.product != "api" else None
        prepared.append((source_query, con, resource_meta.get("name", target.resource), token.get("email", target.connection_id) if token else "Local API"))
    async with job_lock:
        with db() as c:
            if c.execute("SELECT 1 FROM jobs WHERE status IN ('queued','running')").fetchone():
                raise HTTPException(409, "An extraction is already running. Wait for it to finish.")
            jid = ("api_" if q.product == "api" else "") + secrets.token_hex(16)
            columns = column_names(["source_google_account", "source_resource_id", "source_resource_name"] + q.dimensions + q.metrics)
            c.execute("INSERT INTO jobs(id,owner,status,spec,columns) VALUES (?,?,'queued',?,?)", (jid, uid, q.model_dump_json(), json.dumps(columns)))
            for index, (source_query, con, name, email) in enumerate(prepared):
                state = "queued"
                if source_query.incremental:
                    saved = c.execute("SELECT end_date FROM checkpoints WHERE id=?", (checkpoint_key(uid, source_query),)).fetchone()
                    if saved:
                        source_query.start = max(source_query.start, (date.fromisoformat(saved[0])+timedelta(days=1)).isoformat())
                        if source_query.start > source_query.end:
                            state = "skipped"
                c.execute("INSERT INTO job_sources(job,position,connection_id,email,resource,name,start_date,end_date,status) VALUES (?,?,?,?,?,?,?,?,?)", (jid, index, source_query.connection_id, email, source_query.resource, name, source_query.start, source_query.end, state))
        task = asyncio.create_task(run_batch(jid, uid, prepared, columns))
        tasks.add(task)
        task.add_done_callback(tasks.discard)
    return {"id": jid}


def failure_message(exc):
    return str(exc.detail) if isinstance(exc, HTTPException) else str(exc) if isinstance(exc, ValueError) else "Extraction failed unexpectedly. Retry this source."


async def run_batch(jid, uid, prepared, columns):
    try:
        with db() as c:
            c.execute("UPDATE jobs SET status='running' WHERE id=?", (jid,))
        for index, (q, con, name, email) in enumerate(prepared):
            with db() as c:
                if c.execute("SELECT status FROM job_sources WHERE job=? AND position=?", (jid, index)).fetchone()[0] == "skipped":
                    continue
                c.execute("UPDATE job_sources SET status='running' WHERE job=? AND position=?", (jid, index))
            try:
                async for batch in con.extract(q):
                    tagged = []
                    for row in batch:
                        # Allocate provenance columns first; colliding user headers get a suffix.
                        keys = ["source_google_account", "source_resource_id", "source_resource_name"] + list(row)
                        values = [email, q.resource, name] + list(row.values())
                        tagged.append(dict(zip(column_names(keys), values)))
                    columns = insert_rows(jid, tagged, columns, source=index, union=True)
                    await asyncio.sleep(0)
                with db() as c:
                    c.execute("UPDATE job_sources SET status='complete' WHERE job=? AND position=?", (jid, index))
                    if q.incremental:
                        c.execute("INSERT INTO checkpoints VALUES (?,?) ON CONFLICT(id) DO UPDATE SET end_date=MAX(end_date,excluded.end_date)", (checkpoint_key(uid, q), q.end))
            except Exception as exc:
                with db() as c:
                    removed = c.execute("DELETE FROM rows WHERE job=? AND source=?", (jid, index)).rowcount
                    c.execute("UPDATE jobs SET count=count-? WHERE id=?", (removed, jid))
                    c.execute("UPDATE job_sources SET status='failed',count=0,error=? WHERE job=? AND position=?", (failure_message(exc), jid, index))
        with db() as c:
            states = [r[0] for r in c.execute("SELECT status FROM job_sources WHERE job=?", (jid,))]
            failed = states.count("failed")
            final = "partial" if failed and "complete" in states else "failed" if failed else "complete"
            error = f"{failed} source(s) failed. Only successful sources are available for export." if failed else None
            c.execute("UPDATE jobs SET status=?,error=? WHERE id=?", (final, error, jid))
    except asyncio.CancelledError:
        with db() as c:
            c.execute("UPDATE jobs SET status='failed',error='Extraction interrupted. Run it again.' WHERE id=?", (jid,))
            c.execute("UPDATE job_sources SET status='failed',error='Extraction interrupted.' WHERE job=? AND status IN ('queued','running')", (jid,))
        raise
    except Exception as exc:
        with db() as c:
            c.execute("UPDATE jobs SET status='failed',error=? WHERE id=?", (failure_message(exc), jid))


async def run_job(jid, uid, q, con):
    try:
        with db() as c:
            c.execute("UPDATE jobs SET status='running' WHERE id=?", (jid,))
        columns = []
        async for batch in con.extract(q):
            columns = insert_rows(jid, batch, columns)
            await asyncio.sleep(0)
        with db() as c:
            c.execute("UPDATE jobs SET status='complete' WHERE id=?", (jid,))
            if q.incremental:
                c.execute("INSERT INTO checkpoints VALUES (?,?) ON CONFLICT(id) DO UPDATE SET end_date=MAX(end_date,excluded.end_date)", (checkpoint_key(uid, q), q.end))
    except asyncio.CancelledError:
        with db() as c:
            c.execute("UPDATE jobs SET status='failed',error='Extraction interrupted. Run it again.' WHERE id=?", (jid,))
        raise
    except Exception as exc:
        message = exc.detail if isinstance(exc, HTTPException) else str(exc) if isinstance(exc, ValueError) else "Extraction failed unexpectedly. Check the local server and retry."
        with db() as c:
            c.execute("UPDATE jobs SET status='failed',error=? WHERE id=?", (message, jid))


def get_job(jid, uid):
    with db() as c:
        row = c.execute("SELECT * FROM jobs WHERE id=? AND owner=?", (jid, uid)).fetchone()
    if not row:
        raise HTTPException(404, "Extraction not found.")
    return dict(row)


@app.get("/jobs")
async def history(request: Request):
    uid = owner(request)
    with db() as c:
        rows = c.execute("SELECT id,status,count,created,spec,error FROM jobs WHERE owner=? ORDER BY created DESC,rowid DESC LIMIT 30", (uid,)).fetchall()
    return [{**dict(r), "spec": json.loads(r["spec"])} for r in rows]


@app.get("/jobs/{jid}")
async def job(jid: str, request: Request, offset: int = 0, limit: int = 50):
    requested_owner = "local-api" if jid.startswith("api_") else owner(request)
    row = get_job(jid, requested_owner)
    with db() as c:
        rows = c.execute("SELECT data FROM rows WHERE job=? ORDER BY rowid LIMIT ? OFFSET ?", (jid, max(1, min(limit, 200)), max(0, offset))).fetchall()
        sources = [dict(r) for r in c.execute("SELECT * FROM job_sources WHERE job=? ORDER BY position", (jid,))]
    columns = json.loads(row["columns"])
    return {**row, "spec": json.loads(row["spec"]), "columns": columns, "rows": [{k: value.get(k) for k in columns} for value in (json.loads(r[0]) for r in rows)], "sources": sources}


@app.get("/jobs/{jid}/export")
async def export(jid: str, request: Request, format: str = "csv", successful_only: bool = False):
    requested_owner = "local-api" if jid.startswith("api_") else owner(request)
    row = get_job(jid, requested_owner)
    if row["status"] != "complete" and not (row["status"] == "partial" and successful_only):
        raise HTTPException(409, "Only completed extractions can be exported.")
    if format not in ("csv", "json"):
        raise HTTPException(422, "Choose CSV or JSON.")
    product = json.loads(row["spec"])["product"]
    suffix = "_successful_sources_only" if row["status"] == "partial" else ""
    return StreamingResponse(export_rows(jid, json.loads(row["columns"]), format), media_type="text/csv; charset=utf-8" if format == "csv" else "application/json", headers={"Content-Disposition": f'attachment; filename="{product}_{jid[:8]}{suffix}.{format}"'})


@app.delete("/jobs/{jid}")
async def delete_job(jid: str, request: Request):
    row = get_job(jid, owner(request))
    if row["status"] in ("queued", "running"):
        raise HTTPException(409, "Wait for the extraction to finish before deleting it.")
    with db() as c:
        c.execute("DELETE FROM rows WHERE job=?", (jid,))
        c.execute("DELETE FROM job_sources WHERE job=?", (jid,))
        c.execute("DELETE FROM jobs WHERE id=?", (jid,))
    return {"ok": True}
