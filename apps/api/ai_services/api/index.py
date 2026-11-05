"""Internal HTTP surface of ai_services (consumed ONLY by the Node API).

    GET  /health                -> liveness + key COUNTS (never keys)
    POST /v1/analyze            -> JSON {"text": "...", "routes": [optional]}
    POST /v1/voice              -> raw .wav/.mp3 bytes (Content-Type audio/*)

Auth: `X-Internal-Secret` must equal AI_SERVICES_SHARED_SECRET (fail closed
when unset; both sides are trimmed like the Node client does). Authentication
happens BEFORE any request body is read. Payloads that carry raw GPS keys are
refused (privacy rule).

Hardening: strict Content-Length (digits only, per-route cap, no chunked
bodies), socket timeout, an overall body-read deadline, and a bounded worker
pool that answers 503 when full instead of spawning unlimited threads.

Run locally:  python -m ai_services.api.index   (127.0.0.1:8765)
"""
from __future__ import annotations

import hmac
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Mapping

from ..logistics_math import assert_no_raw_gps
from ..nlp_engine import VoiceInputError, VoiceUnavailable
from ..provider_pool import pool_status
from ..route_hints import validate_routes
from ..service import analyze_text, analyze_voice

MAX_JSON_BYTES = 32 * 1024                    # text <= 1000 chars + up to 100 routes
MAX_AUDIO_BYTES = 10 * 1024 * 1024            # same cap as the Node route (express.raw limit 10mb)
AUDIO_TYPES = {"audio/wav", "audio/x-wav", "audio/wave", "audio/mpeg", "audio/mp3"}
SOCKET_TIMEOUT_SECONDS = 15.0                 # per socket operation (slow-loris guard)
BODY_READ_DEADLINE_SECONDS = 60.0             # whole body must arrive within this
DEFAULT_MAX_WORKERS = 8


def _secret() -> str:
    return os.environ.get("AI_SERVICES_SHARED_SECRET", "").strip()


def _authorised(headers: Mapping[str, str]) -> bool:
    secret = _secret()
    if len(secret) < 16:                       # fail closed: unset/weak secret accepts nothing
        return False
    supplied = headers.get("x-internal-secret", "").strip()
    return hmac.compare_digest(supplied.encode(), secret.encode())


def parse_content_length(value: str | None) -> int | None:
    """Digits only. None means missing/invalid (negative, signed, hex, huge, blank)."""
    if value is None:
        return None
    value = value.strip()
    if not value.isascii() or not value.isdigit() or len(value) > 12:
        return None
    return int(value)


def body_limit(method: str, path: str) -> int | None:
    if method == "POST" and path == "/v1/analyze":
        return MAX_JSON_BYTES
    if method == "POST" and path == "/v1/voice":
        return MAX_AUDIO_BYTES
    return None


def _reject_constant(name: str):
    raise ValueError(f"non-finite JSON constant {name}")


def handle_request(method: str, path: str, headers: Mapping[str, str], body: bytes) -> tuple[int, dict]:
    headers = {k.lower(): v for k, v in headers.items()}
    if method == "GET" and path == "/health":
        return 200, {"status": "ok", "provider_keys": pool_status()}
    if not _authorised(headers):
        return 401, {"error": "unauthorized"}

    if method == "POST" and path == "/v1/analyze":
        if len(body) > MAX_JSON_BYTES:
            return 413, {"error": "payload_too_large"}
        try:
            data = json.loads(body.decode("utf-8"), parse_constant=_reject_constant)
            assert_no_raw_gps(data)
            text = data["text"]
            routes = None
            if data.get("routes") is not None:
                routes = validate_routes(data["routes"])
                if routes is None:
                    return 400, {"error": "invalid_routes"}
        except ValueError as exc:
            return 400, {"error": "raw_gps_streaming_banned" if str(exc) == "RAW_GPS_STREAMING_BANNED" else "invalid_json"}
        except (KeyError, TypeError, AttributeError):
            return 400, {"error": "text_required"}
        result = analyze_text(text, routes)
        return (422 if result["status"] != "OK" else 200), result

    if method == "POST" and path == "/v1/voice":
        content_type = headers.get("content-type", "").split(";")[0].strip().lower()
        if content_type not in AUDIO_TYPES:
            return 415, {"error": "unsupported_media_type"}
        if len(body) > MAX_AUDIO_BYTES:
            return 413, {"error": "payload_too_large"}
        extension = ".mp3" if "mpeg" in content_type or "mp3" in content_type else ".wav"
        try:
            result = analyze_voice(body, f"audio{extension}")
        except VoiceInputError as exc:
            return 400, {"error": "invalid_audio", "detail": str(exc)}
        except VoiceUnavailable:
            return 503, {"error": "voice_unavailable"}
        return (422 if result["status"] != "OK" else 200), result

    return 404, {"error": "not_found"}


def _read_body(rfile, length: int, deadline_seconds: float = BODY_READ_DEADLINE_SECONDS) -> bytes | None:
    """Read exactly `length` bytes within an overall deadline; None on timeout/short read."""
    deadline = time.monotonic() + deadline_seconds
    chunks: list[bytes] = []
    remaining = length
    while remaining > 0:
        if time.monotonic() > deadline:
            return None
        try:
            chunk = rfile.read(min(65536, remaining))
        except (TimeoutError, OSError):
            return None
        if not chunk:
            return None
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


class handler(BaseHTTPRequestHandler):
    server_version = "darb-ai/1"
    timeout = SOCKET_TIMEOUT_SECONDS           # applied to the connection socket by StreamRequestHandler

    def _reply(self, status: int, payload: dict, *, close: bool = False) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        if close:
            self.close_connection = True
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        if close:
            self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(raw)

    def _serve(self, method: str) -> None:
        path = self.path.split("?")[0]
        headers = {k.lower(): v for k, v in self.headers.items()}

        if method == "GET" and path == "/health":
            status, payload = handle_request(method, path, headers, b"")
            self._reply(status, payload, close=True)
            return

        # 1. authenticate before touching the body
        if not _authorised(headers):
            self._reply(401, {"error": "unauthorized"}, close=True)
            return
        # 2. route + body limits, still without reading anything
        limit = body_limit(method, path)
        if limit is None:
            self._reply(404, {"error": "not_found"}, close=True)
            return
        if "transfer-encoding" in headers:
            self._reply(400, {"error": "chunked_not_supported"}, close=True)
            return
        length = parse_content_length(headers.get("content-length"))
        if length is None:
            self._reply(400, {"error": "invalid_content_length"}, close=True)
            return
        if length > limit:
            self._reply(413, {"error": "payload_too_large"}, close=True)
            return
        # 3. only now read the (bounded) body
        body = _read_body(self.rfile, length)
        if body is None:
            self._reply(408, {"error": "request_timeout"}, close=True)
            return
        status, payload = handle_request(method, path, headers, body)
        self._reply(status, payload, close=True)

    def do_GET(self) -> None:  # noqa: N802
        self._serve("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._serve("POST")

    def log_message(self, format: str, *args) -> None:  # noqa: A002 - never log bodies/headers
        return


class BoundedServer(HTTPServer):
    """HTTP server with a fixed worker pool. When every worker is busy a new
    connection is answered 503 immediately instead of queueing or spawning threads."""

    daemon_threads = True

    def __init__(self, address, request_handler, max_workers: int = DEFAULT_MAX_WORKERS) -> None:
        super().__init__(address, request_handler)
        self._pool = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="darb-ai")
        self._slots = threading.BoundedSemaphore(max_workers)

    def process_request(self, request, client_address) -> None:
        if not self._slots.acquire(blocking=False):
            try:
                request.settimeout(2.0)
                request.sendall(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            except OSError:
                pass
            self.shutdown_request(request)
            return
        try:
            self._pool.submit(self._run, request, client_address)
        except RuntimeError:
            self._slots.release()
            self.shutdown_request(request)

    def _run(self, request, client_address) -> None:
        try:
            self.finish_request(request, client_address)
        except Exception:                      # never let one request kill a worker
            self.handle_error(request, client_address)
        finally:
            self.shutdown_request(request)
            self._slots.release()

    def server_close(self) -> None:
        super().server_close()
        self._pool.shutdown(wait=False, cancel_futures=True)


def _max_workers() -> int:
    try:
        value = int(os.environ.get("AI_SERVICES_MAX_WORKERS", ""))
    except ValueError:
        return DEFAULT_MAX_WORKERS
    return value if 1 <= value <= 64 else DEFAULT_MAX_WORKERS


def main() -> None:
    from ..spatial import default_landmarks
    default_landmarks()          # warms the optional Overpass hint cache (no-op unless enabled)
    host = os.environ.get("AI_SERVICES_HOST", "127.0.0.1")
    port = int(os.environ.get("AI_SERVICES_PORT", "8765"))
    BoundedServer((host, port), handler, _max_workers()).serve_forever()


if __name__ == "__main__":
    main()
