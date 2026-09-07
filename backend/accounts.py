"""Encrypted credentials scoped to a local workspace and Google subject."""
import json
import os

from cryptography.fernet import Fernet
from fastapi import HTTPException

from .storage import db


def cipher():
    key = os.getenv("TOKEN_ENCRYPTION_KEY", "").strip().strip("\"'").replace("\\_", "_")
    if not key:
        raise HTTPException(503, "Set TOKEN_ENCRYPTION_KEY in backend/.env. See the setup guide.")
    try:
        return Fernet(key.encode())
    except (ValueError, TypeError):
        raise HTTPException(503, "TOKEN_ENCRYPTION_KEY must be a valid Fernet key.")


def decode(value):
    try:
        return json.loads(cipher().decrypt(value))
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, "Stored credentials cannot be decrypted. Restore the original encryption key.")


def token_key(workspace, connection):
    return "google:" + json.dumps([workspace, connection], separators=(",", ":"))


def save_token(token, workspace=None):
    subject = token.get("sub")
    key = token_key(workspace or subject, subject) if subject else "google"
    with db() as c:
        c.execute("INSERT OR REPLACE INTO secrets VALUES (?,?)", (key, cipher().encrypt(json.dumps(token).encode())))


def read_token(workspace=None, connection=None):
    key = token_key(workspace, connection or workspace) if workspace else "google"
    with db() as c:
        row = c.execute("SELECT value FROM secrets WHERE id=?", (key,)).fetchone()
        if row:
            return decode(row[0])
        # Migrate the original single-account store only to its own workspace.
        legacy = c.execute("SELECT value FROM secrets WHERE id='google'").fetchone()
        if legacy:
            token = decode(legacy[0])
            if workspace and token.get("sub") == workspace == (connection or workspace):
                c.execute("INSERT OR IGNORE INTO secrets VALUES (?,?)", (key, legacy[0]))
                c.execute("DELETE FROM secrets WHERE id='google'")
                return token
    return None


def list_accounts(workspace):
    read_token(workspace, workspace)
    with db() as c:
        records = c.execute("SELECT id,value FROM secrets WHERE id LIKE 'google:%'").fetchall()
    result = []
    for record in records:
        account_workspace, subject = json.loads(record["id"][7:])
        if account_workspace != workspace:
            continue
        token = decode(record["value"])
        result.append({"id": subject, "email": token.get("email", subject), "scopes": token.get("scope", "").split()})
    return sorted(result, key=lambda a: (a["id"] != workspace, a["email"]))


def remove_account(workspace, connection):
    with db() as c:
        c.execute("DELETE FROM secrets WHERE id=?", (token_key(workspace, connection),))
