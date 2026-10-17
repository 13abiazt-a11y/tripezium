import pytest

from app import ratelimit
from app.services import gemini


@pytest.fixture(autouse=True, scope="session")
def _delete_test_trips():
    """Every trip a test creates is named "pytest-..."; remove them all after the run (any test file)."""
    yield
    from sqlalchemy import delete

    from app.config import get_settings
    from app.db import _session_factory, check_db
    from app.models import TripRow
    url = get_settings().database_url
    if url and "<password>" not in url and check_db() == "ok":
        with _session_factory()() as db:
            db.execute(delete(TripRow).where(TripRow.destination.like("pytest-%")))
            db.commit()


@pytest.fixture(autouse=True)
def _fresh_limits():
    """Rate-limit counters and Gemini's quota memory are process-wide; start every test clean."""
    ratelimit.reset_all()
    gemini._quota_hit_at.clear()
    yield
    ratelimit.reset_all()
    gemini._quota_hit_at.clear()
