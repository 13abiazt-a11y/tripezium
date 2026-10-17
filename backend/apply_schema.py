"""Apply schema.sql to the database in DATABASE_URL. Run from backend/: python apply_schema.py"""
from pathlib import Path

import psycopg
from sqlalchemy import make_url

from app.config import get_settings
from app.db import normalise_db_url, sqlalchemy_url


def main() -> None:
    url = get_settings().database_url
    if not url:
        raise SystemExit("DATABASE_URL is not set (check backend/.env)")
    if "<password>" in url:
        raise SystemExit("DATABASE_URL still contains the <password> placeholder")

    sql = (Path(__file__).parent / "schema.sql").read_text(encoding="utf-8")
    host = make_url(sqlalchemy_url(url)).host  # print host only, never the password
    with psycopg.connect(normalise_db_url(url), connect_timeout=10) as conn:
        # ALTER TABLE needs an exclusive lock even when there's nothing to change, and while it waits
        # every other query on that table queues behind it: one forgotten open transaction froze the
        # live API this way. Give up after 5 s instead, and say who is holding the lock.
        conn.execute("SET lock_timeout = '5s'")
        try:
            conn.execute(sql)
        except psycopg.errors.LockNotAvailable:
            conn.rollback()
            blockers = conn.execute(
                "SELECT pid, state, now() - state_change, left(query, 80) FROM pg_stat_activity "
                "WHERE datname = current_database() AND state LIKE 'idle in transaction%' ORDER BY state_change"
            ).fetchall()
            details = "\n".join(f"  pid {p}: {s} for {str(d)[:8]}, last query: {q}" for p, s, d, q in blockers)
            raise SystemExit(
                "!! Schema not applied: a table is locked by another session (nothing was changed).\n"
                f"{details or '  (no idle transaction found; try again in a minute)'}\n"
                "   Close that session, or end it with SELECT pg_terminate_backend(<pid>), then re-run."
            ) from None
        tables = conn.execute(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' ORDER BY table_name"
        ).fetchall()
        hyper = conn.execute(
            "SELECT hypertable_name FROM timescaledb_information.hypertables"
        ).fetchall()
    print(f"Schema applied to {host}")
    print("Tables:", ", ".join(t[0] for t in tables))
    print("Hypertables:", ", ".join(h[0] for h in hyper) or "(none)")


if __name__ == "__main__":
    main()
