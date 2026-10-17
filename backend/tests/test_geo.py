from app.db import normalise_db_url, sqlalchemy_url
from app.services import geo


def test_known_country_currency():
    assert geo.currency_for("JP") == "JPY"
    assert geo.currency_for("PT") == "EUR"
    assert geo.currency_for(None) is None


def test_lookup_failure_does_not_raise(monkeypatch):
    def boom(*a, **k):
        raise geo.httpx.ConnectTimeout("timeout")
    monkeypatch.setattr(geo.httpx, "get", boom)
    monkeypatch.setattr(geo, "_last_call", 0.0)
    assert geo.lookup_country_code("Atlantis-test") is None


def test_tiger_url_is_rewritten_for_sqlalchemy():
    assert sqlalchemy_url("postgres://u:p@h:1/db?sslmode=require") == "postgresql+psycopg://u:p@h:1/db?sslmode=require"
    assert sqlalchemy_url("postgresql://u@h/db") == "postgresql+psycopg://u@h/db"


def test_password_with_special_chars_is_encoded():
    assert normalise_db_url("postgres://u:p@ss:w/rd#1@h:5/db?sslmode=require") == \
        "postgres://u:p%40ss%3Aw%2Frd%231@h:5/db?sslmode=require"
    # already-encoded passwords are not double-encoded
    assert normalise_db_url("postgres://u:p%40ss@h/db") == "postgres://u:p%40ss@h/db"
