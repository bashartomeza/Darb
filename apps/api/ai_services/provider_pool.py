"""Multi-provider, multi-key failover layer (stdlib only).

Keys are read from the environment, never hard-coded:

    GEMINI_API_KEYS=k1,k2,...   (or GEMINI_API_KEY=k)
    GROQ_API_KEYS=k1,k2,...     (or GROQ_API_KEY=k)
    OPENAI_API_KEYS=k1,k2,...   (or OPENAI_API_KEY=k)   # Whisper + agent

Behaviour: on a rate-limit (HTTP 429 / RESOURCE_EXHAUSTED) the current key is
put on a short cooldown and traffic slides to the next key. When a pool is
fully drained the caller moves on to the next pool (Gemini -> Groq).

Key values are never logged, never returned, never put in exception text.
"""
from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Callable, Mapping, Sequence, TypeVar

T = TypeVar("T")

KEY_COOLDOWN_SECONDS = 60.0
DEFAULT_TIMEOUT_SECONDS = 15.0


class ResourceExhausted(Exception):
    """Provider rate limit / quota exhausted for the current key."""


class ProviderError(Exception):
    """Non rate-limit provider failure (auth, 5xx, timeout, bad payload)."""


class AllProvidersExhausted(Exception):
    """Every key of every pool failed; caller must use an offline fallback."""


def _split_keys(raw: str | None) -> list[str]:
    if not raw:
        return []
    seen: list[str] = []
    for item in raw.split(","):
        key = item.strip()
        if key and key not in seen:
            seen.append(key)
    return seen


@dataclass
class KeyPool:
    provider: str
    keys: list[str]
    _cursor: int = 0
    _cooldown_until: dict[int, float] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def __repr__(self) -> str:  # never leak key material
        return f"KeyPool(provider={self.provider!r}, keys={len(self.keys)})"

    def __len__(self) -> int:
        return len(self.keys)

    def candidates(self, now: float | None = None) -> list[tuple[int, str]]:
        """Keys to try, starting at the sticky cursor, skipping cooled-down ones."""
        now = time.monotonic() if now is None else now
        with self._lock:
            order = [(self._cursor + i) % len(self.keys) for i in range(len(self.keys))] if self.keys else []
            return [(i, self.keys[i]) for i in order if self._cooldown_until.get(i, 0.0) <= now]

    def mark_exhausted(self, index: int, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        with self._lock:
            self._cooldown_until[index] = now + KEY_COOLDOWN_SECONDS
            self._cursor = (index + 1) % max(len(self.keys), 1)

    def mark_ok(self, index: int) -> None:
        with self._lock:
            self._cursor = index


_POOL_CACHE: dict[str, KeyPool] = {}
_POOL_LOCK = threading.Lock()


def load_pool(provider: str, env: Mapping[str, str] | None = None) -> KeyPool:
    """Pool for 'gemini' | 'groq' | 'openai'. Cached per process (env=None)."""
    env_is_process = env is None
    env = os.environ if env is None else env
    prefix = provider.upper()
    keys = _split_keys(env.get(f"{prefix}_API_KEYS")) or _split_keys(env.get(f"{prefix}_API_KEY"))
    if env_is_process:
        with _POOL_LOCK:
            cached = _POOL_CACHE.get(provider)
            if cached is not None and cached.keys == keys:
                return cached
            pool = KeyPool(provider, keys)
            _POOL_CACHE[provider] = pool
            return pool
    return KeyPool(provider, keys)


def reset_pool_cache() -> None:
    with _POOL_LOCK:
        _POOL_CACHE.clear()


def pool_status(env: Mapping[str, str] | None = None) -> dict[str, int]:
    """Key *counts* only (safe for /health)."""
    return {p: len(load_pool(p, env)) for p in ("gemini", "groq", "openai")}


# --------------------------------------------------------------------------
# HTTP transport (single seam: tests monkeypatch `http_post`).
# --------------------------------------------------------------------------
def http_post(url: str, headers: Mapping[str, str], body: bytes,
              timeout: float = DEFAULT_TIMEOUT_SECONDS) -> tuple[int, bytes]:
    request = urllib.request.Request(url, data=body, headers=dict(headers), method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 (fixed https hosts)
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read() if exc.fp else b""
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ProviderError(f"transport:{type(exc).__name__}") from None


def http_get(url: str, timeout: float = 8.0) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "darb-ai-services/1"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
            return response.read()
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ProviderError(f"transport:{type(exc).__name__}") from None


def classify_status(status: int, body: bytes) -> None:
    """Raise ResourceExhausted / ProviderError for non-2xx responses."""
    if 200 <= status < 300:
        return
    marker = body[:2000].decode("utf-8", "ignore").lower()
    if status == 429 or "resource_exhausted" in marker or "resourceexhausted" in marker or "rate limit" in marker:
        raise ResourceExhausted(f"http_{status}")
    raise ProviderError(f"http_{status}")


def post_json(url: str, headers: Mapping[str, str], payload: dict,
              timeout: float = DEFAULT_TIMEOUT_SECONDS) -> dict:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    status, raw = http_post(url, {"Content-Type": "application/json", **headers}, body, timeout)
    classify_status(status, raw)
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ProviderError("invalid_json") from None
    if not isinstance(parsed, dict):
        raise ProviderError("invalid_json")
    return parsed


def run_with_failover(pools: Sequence[KeyPool], call: Callable[[str, str], T]) -> tuple[T, str, int]:
    """Try each pool in order, each key in rotation.

    `call(provider, key)` must raise ResourceExhausted on rate limits.
    Returns (result, provider, key_index). Raises AllProvidersExhausted.
    """
    for pool in pools:
        for index, key in pool.candidates():
            try:
                result = call(pool.provider, key)
            except ResourceExhausted:
                pool.mark_exhausted(index)  # slide to key N+1
                continue
            except ProviderError:
                # Bad key / 5xx / timeout: skip this key without a long cooldown.
                pool.mark_exhausted(index)
                continue
            pool.mark_ok(index)
            return result, pool.provider, index
    raise AllProvidersExhausted("no provider key could serve the request")
