import pytest

from app import ratelimit
from app.services import gemini


@pytest.fixture(autouse=True)
def _fresh_limits():
    """Rate-limit counters and Gemini's quota memory are process-wide; start every test clean."""
    ratelimit.reset_all()
    gemini._quota_hit_at.clear()
    yield
    ratelimit.reset_all()
    gemini._quota_hit_at.clear()
