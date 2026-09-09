import csv
import io
import json
import os
import re
import sqlite3
from pathlib import Path

DATA = Path(__file__).parent / "data"


class PostgresCursor:
    def __init__(self, cursor):
        self.cursor = cursor

    def _sql(self, sql):
        sql = sql.replace("INSERT OR IGNORE INTO rows(job,data,source) VALUES (?,?,?)", "INSERT INTO rows(job,data,source) VALUES (?,?,?) ON CONFLICT DO NOTHING")
        sql = sql.replace("INSERT OR IGNORE INTO secrets VALUES (?,?)", "INSERT INTO secrets(id,value) VALUES (?,?) ON CONFLICT DO NOTHING")
        sql = sql.replace("INSERT OR REPLACE INTO secrets VALUES (?,?)", "INSERT INTO secrets(id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value")
        return sql.replace("?", "%s")

    def execute(self, sql, params=()):
        self.cursor.execute(self._sql(sql), params)
        return self

    def executemany(self, sql, seq):
        self.cursor.executemany(self._sql(sql), seq)
        return self

    def fetchone(self):
        return self.cursor.fetchone()

    def fetchall(self):
        return self.cursor.fetchall()

    @property
    def rowcount(self):
        return self.cursor.rowcount

    def __iter__(self):
        return iter(self.cursor)


class PostgresConnection:
    def __init__(self, conn):
        self.conn = conn
        self._last_cursor = None

    def execute(self, sql, params=()):
        cur = PostgresCursor(self.conn.cursor())
        cur.execute(sql, params)
        self._last_cursor = cur
        return cur

    def executemany(self, sql, seq):
        cur = PostgresCursor(self.conn.cursor())
        cur.executemany(sql, seq)
        self._last_cursor = cur
        return cur

    def executescript(self, script):
        for statement in [part.strip() for part in script.split(";") if part.strip()]:
            self.conn.execute(statement)

    @property
    def total_changes(self):
        return self._last_cursor.rowcount if self._last_cursor else 0

    def close(self):
        self.conn.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type:
            self.conn.rollback()
        else:
            self.conn.commit()
        self.conn.close()


def using_postgres():
    return bool(os.getenv("DATABASE_URL", "").strip())


def normalize_database_url(url):
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://") and "sslmode=" not in url:
        separator = "&" if "?" in url else "?"
        return url + separator + "sslmode=require"
    return url


def row_value(row, key, index=0):
    return row.get(key) if isinstance(row, dict) else row[index]


def column_names(names):
    used, out = set(), []
    for raw in names:
        base = re.sub(r"[^a-z0-9]+", "_", re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", raw).lower()).strip("_") or "column"
        name, i = base, 2
        while name in used:
            name = f"{base}_{i}"
            i += 1
        used.add(name)
        out.append(name)
    return out


def db():
    database_url = os.getenv("DATABASE_URL", "").strip()
    if database_url:
        import psycopg
        from psycopg.rows import dict_row
        conn = psycopg.connect(normalize_database_url(database_url), row_factory=dict_row)
        return PostgresConnection(conn)
    DATA.mkdir(exist_ok=True)
    conn = sqlite3.connect(DATA / "extract.db", timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init():
    with db() as c:
        if using_postgres():
            c.executescript("""
            CREATE TABLE IF NOT EXISTS secrets (id TEXT PRIMARY KEY, value BYTEA);
            CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, owner TEXT, status TEXT, spec TEXT, columns TEXT DEFAULT '[]', count INTEGER DEFAULT 0, error TEXT, created TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS rows (job TEXT, data TEXT, source INTEGER, UNIQUE(job,data));
            CREATE INDEX IF NOT EXISTS rows_job ON rows(job);
            CREATE TABLE IF NOT EXISTS checkpoints (id TEXT PRIMARY KEY, end_date TEXT);
            CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, owner TEXT, expires DOUBLE PRECISION);
            CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires);
            CREATE TABLE IF NOT EXISTS oauth_states (id TEXT PRIMARY KEY, data TEXT, expires DOUBLE PRECISION);
            CREATE INDEX IF NOT EXISTS oauth_states_expires ON oauth_states(expires);
            CREATE TABLE IF NOT EXISTS job_sources (
                job TEXT, position INTEGER, connection_id TEXT, email TEXT,
                resource TEXT, name TEXT, start_date TEXT, end_date TEXT,
                status TEXT DEFAULT 'queued', count INTEGER DEFAULT 0, error TEXT,
                PRIMARY KEY(job,position)
            );
            """)
        else:
            c.executescript("""
            CREATE TABLE IF NOT EXISTS secrets (id TEXT PRIMARY KEY, value BLOB);
            CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, owner TEXT, status TEXT, spec TEXT, columns TEXT DEFAULT '[]', count INTEGER DEFAULT 0, error TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS rows (job TEXT, data TEXT, UNIQUE(job,data));
            CREATE INDEX IF NOT EXISTS rows_job ON rows(job);
            CREATE TABLE IF NOT EXISTS checkpoints (id TEXT PRIMARY KEY, end_date TEXT);
            CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, owner TEXT, expires REAL);
            CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires);
            CREATE TABLE IF NOT EXISTS oauth_states (id TEXT PRIMARY KEY, data TEXT, expires REAL);
            CREATE INDEX IF NOT EXISTS oauth_states_expires ON oauth_states(expires);
            CREATE TABLE IF NOT EXISTS job_sources (
                job TEXT, position INTEGER, connection_id TEXT, email TEXT,
                resource TEXT, name TEXT, start_date TEXT, end_date TEXT,
                status TEXT DEFAULT 'queued', count INTEGER DEFAULT 0, error TEXT,
                PRIMARY KEY(job,position)
            );
            """)
            if "source" not in {row[1] for row in c.execute("PRAGMA table_info(rows)")}:
                c.execute("ALTER TABLE rows ADD COLUMN source INTEGER")
        c.execute("UPDATE jobs SET status='failed', error='Server stopped during extraction. Run the extraction again.' WHERE status IN ('queued','running')")
        c.execute("UPDATE job_sources SET status='failed', error='Server stopped during extraction.' WHERE status IN ('queued','running')")


def insert_rows(job, rows, columns, source=None, union=False):
    if not rows:
        return columns
    original = list(rows[0])
    names = column_names(original)
    if columns and columns != names and not union:
        raise ValueError("The API response schema changed during extraction. Retry the query.")
    with db() as c:
        c.executemany("INSERT OR IGNORE INTO rows(job,data,source) VALUES (?,?,?)", [(job, json.dumps(dict(zip(names, [r.get(k) for k in original])), ensure_ascii=False, allow_nan=False, separators=(",", ":")), source) for r in rows])
        added = c.total_changes
        combined = list(dict.fromkeys(columns + names)) if union else names
        c.execute("UPDATE jobs SET columns=?, count=count+? WHERE id=?", (json.dumps(combined), added, job))
        if source is not None:
            c.execute("UPDATE job_sources SET count=count+? WHERE job=? AND position=?", (added, job, source))
    return combined


def export_rows(job, columns, fmt):
    # Iterate with a cursor: exports never materialize the full dataset in memory.
    conn = db()
    try:
        cur = conn.execute("SELECT data FROM rows WHERE job=? ORDER BY rowid", (job,))
        if fmt == "json":
            yield "["
            first = True
            for row in cur:
                data = json.loads(row_value(row, "data", 0))
                yield ("" if first else ",") + json.dumps({k: data.get(k) for k in columns}, ensure_ascii=False, allow_nan=False)
                first = False
            yield "]"
        else:
            buf = io.StringIO(newline="")
            writer = csv.writer(buf, lineterminator="\r\n")
            writer.writerow(columns)
            yield "\ufeff" + buf.getvalue()
            for row in cur:
                buf.seek(0)
                buf.truncate(0)
                raw = row_value(row, "data", 0)
                writer.writerow([json.loads(raw).get(k) for k in columns])
                yield buf.getvalue()
    finally:
        conn.close()
