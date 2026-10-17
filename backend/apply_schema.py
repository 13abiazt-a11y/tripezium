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
        conn.execute(sql)
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
