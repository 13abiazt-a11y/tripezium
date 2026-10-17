import datetime as dt
from decimal import Decimal

import pytest
from sqlalchemy import delete, insert

from app.db import _session_factory
from app.models import fx_rates
from app.services import fx
from tests.test_api import needs_db


def test_same_currency_is_one():
    assert fx.get_rate(None, "GBP", "GBP") == (Decimal(1), "same")


def test_market_rate_is_derived_from_eur_rates(monkeypatch):
    class Resp:
        def raise_for_status(self): pass
        def json(self): return {"rates": {"GBP": 0.84385, "JPY": 177.82}}
    seen = {}
    def fake_get(url, params, timeout):
        seen.update(params)
        return Resp()
    monkeypatch.setattr(fx.httpx, "get", fake_get)
    assert fx.fetch_market("JPY", "GBP") == Decimal("0.84385") / Decimal("177.82")
    assert seen == {"base": "EUR", "symbols": "GBP,JPY"}


def test_market_failure_returns_none(monkeypatch):
    def boom(*a, **k):
        raise fx.httpx.ConnectTimeout("timeout")
    monkeypatch.setattr(fx.httpx, "get", boom)
    assert fx.fetch_market("JPY", "GBP") is None


def test_everything_down_uses_fallback_table(monkeypatch, caplog):
    monkeypatch.setattr(fx, "_cached", lambda db, b, q: None)
    monkeypatch.setattr(fx, "fetch_market", lambda b, q: None)
    rate, source = fx.get_rate(None, "JPY", "GBP")
    assert source == "fallback"
    assert rate == Decimal(1) / Decimal("210.72")
    assert "FALLBACK" in caplog.text


def test_unknown_currency_with_nothing_available(monkeypatch):
    monkeypatch.setattr(fx, "_cached", lambda db, b, q: None)
    monkeypatch.setattr(fx, "fetch_market", lambda b, q: None)
    assert fx.get_rate(None, "XYZ", "GBP") == (None, "none")


def test_fallback_cross_rate():
    # EUR -> JPY derived from the GBP table: 210.72 / 1.185
    assert fx.fallback_rate("EUR", "JPY") == Decimal("210.72") / Decimal("1.185")


@pytest.fixture
def test_pair():
    yield ("ISK", "ZAR")
    with _session_factory()() as db:
        db.execute(delete(fx_rates).where(fx_rates.c.base == "ISK", fx_rates.c.quote == "ZAR"))
        db.commit()


@needs_db
def test_rates_are_stored_in_hypertable_and_cached(monkeypatch, test_pair):
    calls = []
    monkeypatch.setattr(fx, "fetch_market", lambda b, q: calls.append(1) or Decimal("0.1358"))
    with _session_factory()() as db:
        assert fx.get_rate(db, *test_pair) == (Decimal("0.1358"), "public")
        assert fx.get_rate(db, *test_pair) == (Decimal("0.1358"), "public")   # 2nd time: from the DB
        assert len(calls) == 1
        rows = db.execute(fx_rates.select().where(fx_rates.c.base == "ISK")).fetchall()
        assert [(r.rate, r.source) for r in rows] == [(0.1358, "public")]


@needs_db
def test_old_cache_rows_are_ignored(monkeypatch, test_pair):
    with _session_factory()() as db:
        db.execute(insert(fx_rates), [{"time": dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=7),
                                       "base": "ISK", "quote": "ZAR", "rate": 9.9, "source": "public"}])
        db.commit()
        monkeypatch.setattr(fx, "fetch_market", lambda b, q: Decimal("0.1358"))
        assert fx.get_rate(db, *test_pair) == (Decimal("0.1358"), "public")
