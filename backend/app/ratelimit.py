"""Tiny in-memory, per-IP sliding-window rate limiter, used as a FastAPI dependency.

In-memory is enough: the server runs a single Uvicorn process (see deploy/iku-api.service).
Behind Caddy, request.client.host is the real client IP because Uvicorn runs with --proxy-headers.
"""
import threading
import time
from collections import defaultdict, deque

from fastapi import Request

from .errors import ApiError

_all: list["RateLimit"] = []


class RateLimit:
    def __init__(self, name: str, limit: int, window_s: float = 60.0):
        self.name, self.limit, self.window_s = name, limit, window_s
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()
        _all.append(self)

    def __call__(self, request: Request) -> None:
        ip = request.client.host if request.client else "unknown"
        now = time.monotonic()
        with self._lock:
            hits = self._hits[ip]
            while hits and now - hits[0] >= self.window_s:
                hits.popleft()
            if len(hits) >= self.limit:
                wait = int(self.window_s - (now - hits[0])) + 1
                raise ApiError(429, "rate_limited", f"Too many requests. Please try again in {wait}s.")
            hits.append(now)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


def reset_all() -> None:
    for limiter in _all:
        limiter.reset()


# Itinerary generation calls Gemini (slow, quota-limited): ~10/min per IP, as per the spec.
generate_limit = RateLimit("itinerary", limit=10)
# Writes that are cheap but shouldn't be hammered. Reads are not limited.
write_limit = RateLimit("writes", limit=60)
