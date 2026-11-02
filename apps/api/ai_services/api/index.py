"""Internal HTTP surface of ai_services (consumed ONLY by the Node API).

    GET  /health                -> liveness + key COUNTS (never keys)
    POST /v1/analyze            -> JSON {"text": "..."}
    POST /v1/voice              -> raw .wav/.mp3 bytes (Content-Type audio/*)

Auth: `X-Internal-Secret` must equal AI_SERVICES_SHARED_SECRET (fail closed
when unset). Payloads that carry raw GPS keys are refused (privacy rule).
Run locally:  python -m ai_services.api.index   (127.0.0.1:8765)
Vercel-style: this module exposes `handler(BaseHTTPRequestHandler)`.
"""
from __future__ import annotations

import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Mapping

from ..logistics_math import assert_no_raw_gps
from ..nlp_engine import VoiceInputError, VoiceUnavailable
from ..provider_pool import pool_status
from ..service import analyze_text, analyze_voice

MAX_JSON_BYTES = 8 * 1024
MAX_AUDIO_BYTES = 25 * 1024 * 1024
AUDIO_TYPES = {"audio/wav", "audio/x-wav", "audio/wave", "audio/mpeg", "audio/mp3"}


def _authorised(headers: Mapping[str, str]) -> bool:
    secret = os.environ.get("AI_SERVICES_SHARED_SECRET", "")
    if len(secret) < 16:                       # fail closed: unset/weak secret accepts nothing
        return False
    supplied = headers.get("x-internal-secret", "")
    return hmac.compare_digest(supplied.encode(), secret.encode())


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
            data = json.loads(body.decode("utf-8"))
            assert_no_raw_gps(data)
            text = data["text"]
        except ValueError as exc:
            return 400, {"error": "raw_gps_streaming_banned" if str(exc) == "RAW_GPS_STREAMING_BANNED" else "invalid_json"}
        except (KeyError, TypeError):
            return 400, {"error": "text_required"}
        result = analyze_text(text)
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


class handler(BaseHTTPRequestHandler):
    server_version = "masari-ai/1"

    def _serve(self, method: str) -> None:
        declared = int(self.headers.get("Content-Length") or 0)
        if declared > MAX_AUDIO_BYTES:
            status, payload = 413, {"error": "payload_too_large"}
        else:
            body = self.rfile.read(declared) if declared else b""
            status, payload = handle_request(method, self.path.split("?")[0], dict(self.headers.items()), body)
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:  # noqa: N802
        self._serve("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._serve("POST")

    def log_message(self, format: str, *args) -> None:  # noqa: A002 - never log bodies/headers
        return


def main() -> None:
    from ..spatial import default_landmarks
    default_landmarks()          # warm the Overpass cache in the background
    host = os.environ.get("AI_SERVICES_HOST", "127.0.0.1")
    port = int(os.environ.get("AI_SERVICES_PORT", "8765"))
    ThreadingHTTPServer((host, port), handler).serve_forever()


if __name__ == "__main__":
    main()
