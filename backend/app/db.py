"""Database engine + session. Sync SQLAlchemy 2.0 over psycopg 3."""
from collections.abc import Iterator
from functools import lru_cache
from urllib.parse import quote, unquote

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from .config import get_settings
from .errors import ApiError


def normalise_db_url(url: str) -> str:
    """Percent-encode the password so characters like @ : / # in it don't break URL parsing.

    Splits on the LAST '@' (hosts never contain one). Already-encoded passwords are left as-is.
    """
    scheme, sep, rest = url.partition("://")
    userinfo, at, hostpart = rest.rpartition("@")
    if not (sep and at):
        return url
    user, colon, password = userinfo.partition(":")
    if not colon:
        return url
    return f"{scheme}://{user}:{quote(unquote(password), safe='')}@{hostpart}"


def sqlalchemy_url(url: str) -> str:
    """Tiger Data hands out postgres://...; SQLAlchemy needs postgresql+psycopg://..."""
    url = normalise_db_url(url)
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


@lru_cache
def get_engine() -> Engine:
    url = get_settings().database_url
    if not url:
        raise ApiError(503, "db_not_configured", "DATABASE_URL is not set.")
    return create_engine(
        sqlalchemy_url(url),
        pool_pre_ping=True,  # drop dead connections (cloud DBs close idle ones)
        pool_size=5,
        max_overflow=5,
        connect_args={"connect_timeout": 5},
    )


@lru_cache
def _session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one session per request."""
    session = _session_factory()()
    try:
        yield session
    finally:
        session.close()


def check_db() -> str:
    """'ok' | 'not_configured' | 'error'"""
    if not get_settings().database_url:
        return "not_configured"
    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        return "ok"
    except Exception:
        return "error"
