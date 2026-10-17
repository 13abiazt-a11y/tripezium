import datetime as dt
from decimal import Decimal
from types import SimpleNamespace

import pytest
from sqlalchemy import delete, insert

from app.db import _session_factory
from app.models import fx_rates
from app.services import fx
from tests.test_api import needs_db

MARKET = Decimal("0.004745")  # JPY -> GBP


def settings(source="wise", token="t"):
    return SimpleNamespace(fx_source=source, wise_api_token=token, wise_api_url="")


@pytest.fixture
def wise_mode(monkeypatch):
    monkeypatch.setattr(fx, "get_settings", lambda: settings("wise"))


def test_same_currency_is_one():
    assert fx.get_rate(None, "GBP", "GBP") == (Decimal(1), "same")


def test_public_mode_uses_market(monkeypatch):
    monkeypatch.setattr(fx, "get_settings", lambda: settings("public", token=""))
    monkeypatch.setattr(fx, "fetch_market", lambda b, q: MARKET)
    assert fx.live_rate("JPY", "GBP") == [(MARKET, "public")]


def test_wise_close_to_market_is_used(monkeypatch, wise_mode):
    monkeypatch.setattr(fx, "fetch_market", lambda b, q: MARKET)
    monkeypatch.setattr(fx, "fetch_wise", lambda b, q: MARKET * Decimal("1.01"))   # 1% off: fine
    rates = fx.live_rate("JPY", "GBP")
    assert rates[0] == (MARKET * Decimal("1.01"), "wise")
    assert rates[1] == (MARKET, "public")   # market rate kept too, for history


@pytest.mark.parametrize("factor", ["1.10", "0.90", "100"])
def test_wise_far_from_market_is_rejected(monkeypatch, wise_mode, caplog, factor):
    monkeypatch.setattr(fx, "fetch_market", lambda b, q: MARKET)
    monkeypatch.setattr(fx, "fetch_wise", lambda b, q: MARKET * Decimal(factor))
    assert fx.live_rate("JPY", "GBP") == [(MARKET, "public")]
    assert "REJECTED Wise" in caplog.text


def test_wise_down_falls_back_to_market(monkeypatch, wise_mode):
    monkeypatch.setattr(fx, "fetch_market", lambda b, q: MARKET)
    monkeypatch.setattr(fx, "fetch_wise", lambda b, q: None)
    assert fx.live_rate("JPY", "GBP") == [(MARKET, "public")]


def test_no_market_rate_checks_wise_against_fallback_table(monkeypatch, wise_mode):
    monkeypatch.setattr(fx, "fetch_market", lambda b, q: None)
    approx = fx.fallback_rate("JPY", "GBP")
    monkeypatch.setattr(fx, "fetch_wise", lambda b, q: approx * Decimal("1.05"))
    assert fx.live_rate("JPY", "GBP")[0][1] == "wise"           # 5%: within the looser 15%
    monkeypatch.setattr(fx, "fetch_wise", lambda b, q: approx * 2)
    assert fx.live_rate("JPY", "GBP") == []                      # 100% off: rejected


def test_everything_down_uses_fallback_table(monkeypatch, wise_mode, caplog):
    monkeypatch.setattr(fx, "_cached", lambda db, b, q: None)
    monkeypatch.setattr(fx, "fetch_market", lambda b, q: None)
    monkeypatch.setattr(fx, "fetch_wise", lambda b, q: None)
    rate, source = fx.get_rate(None, "JPY", "GBP")
    assert source == "fallback"
    assert rate == Decimal(1) / Decimal("210.72")
    assert "FALLBACK" in caplog.text


def test_unknown_currency_with_nothing_available(monkeypatch, wise_mode):
    monkeypatch.setattr(fx, "_cached", lambda db, b, q: None)
    monkeypatch.setattr(fx, "fetch_market", lambda b, q: None)
    monkeypatch.setattr(fx, "fetch_wise", lambda b, q: None)
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
def test_rates_are_stored_in_hypertable_and_cached(monkeypatch, wise_mode, test_pair):
    calls = []
    monkeypatch.setattr(fx, "fetch_market", lambda b, q: calls.append("m") or Decimal("0.1358"))
    monkeypatch.setattr(fx, "fetch_wise", lambda b, q: calls.append("w") or Decimal("0.1360"))
    with _session_factory()() as db:
        assert fx.get_rate(db, *test_pair) == (Decimal("0.1360"), "wise")
        assert fx.get_rate(db, *test_pair) == (Decimal("0.136"), "wise")   # 2nd time: from the DB
        assert calls == ["m", "w"]
        sources = sorted(r.source for r in db.execute(fx_rates.select().where(fx_rates.c.base == "ISK")))
        assert sources == ["public", "wise"]


@needs_db
def test_old_cache_rows_are_ignored(monkeypatch, wise_mode, test_pair):
    with _session_factory()() as db:
        db.execute(insert(fx_rates), [{"time": dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=7),
                                       "base": "ISK", "quote": "ZAR", "rate": 9.9, "source": "wise"}])
        db.commit()
        monkeypatch.setattr(fx, "fetch_market", lambda b, q: Decimal("0.1358"))
        monkeypatch.setattr(fx, "fetch_wise", lambda b, q: None)
        assert fx.get_rate(db, *test_pair) == (Decimal("0.1358"), "public")
