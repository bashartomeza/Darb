"""Module 01 (dialect parsing), Module 02 (fallback gateway), voice STT and
dynamic UI directives.

Public API
    process_and_verify_request(raw_input_text) -> dict
    process_and_verify_request_detailed(raw_input_text) -> dict   (adds meta)
    check_confidence_fallback(state) -> dict
    process_voice_intent_to_text(audio_file_path) -> str
    transcribe_audio_bytes(data, filename) -> str
    generate_dynamic_ai_ui_payload(extracted_payload) -> dict
"""
from __future__ import annotations

import copy
import json
import math
import os
import re
import uuid
from pathlib import Path
from typing import Any, Callable

from .llm_extractor import call_llm_extract
from .logistics_math import simulated_savings_percentage
from .pipeline import CONFIDENCE_REVIEW_THRESHOLD, parse_dispatch_request
from .provider_pool import (
    AllProvidersExhausted,
    ProviderError,
    classify_status,
    http_post,
    load_pool,
    run_with_failover,
)
from .spatial import Correction, correct_location, default_landmarks

__all__ = [
    "CONFIDENCE_REVIEW_THRESHOLD", "HUMAN_DISPATCHER_QUEUE_INTERFACE", "UI_DIRECTIVES_SCHEMA_VERSION",
    "check_confidence_fallback", "generate_dynamic_ai_ui_payload", "process_and_verify_request",
    "process_and_verify_request_detailed", "process_voice_intent_to_text", "scan_token_firewall",
    "set_human_queue_sink", "transcribe_audio_bytes", "VoiceInputError",
]

HUMAN_DISPATCHER_QUEUE_INTERFACE = "HUMAN_DISPATCHER_QUEUE_INTERFACE"
AUTONOMOUS_DISPATCH_PIPELINE = "AUTONOMOUS_DISPATCH_PIPELINE"
MAX_INPUT_CHARS = 1000

# =============================================================================
# Deterministic token firewall
# =============================================================================
_ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩٫", "0123456789.")
_MATH_PATTERNS = (
    re.compile(r"\d[\d.,]*\s*[+*×÷^=]\s*[\d(]"),     # 2+3, 4*5, 7=7
    re.compile(r"\d[\d.,]*\s+[-/]\s+\d"),            # 9 - 3, 8 / 2   (spaced; avoids phone-number dashes)
    re.compile(r"[=]\s*\??\s*\d|\d\s*=\s*\??"),      # "= 5", "5 ="
    re.compile(r"\(\s*\d[\d.,]*\s*[-+*/]\s*\d[\d.,]*\s*\)\s*[-+*/×÷]"),  # (2+3)*4
    re.compile(r"\b\d+\s*(?:\^|\*\*)\s*\d+\b"),      # 2^8, 2**8
)


def scan_token_firewall(text: str) -> str | None:
    """Return the violated rule id, or None when the text is clean."""
    normalized = text.translate(_ARABIC_DIGITS)
    for index, pattern in enumerate(_MATH_PATTERNS, start=1):
        if pattern.search(normalized):
            return f"MATH_EXPRESSION_RULE_{index}"
    return None


def _violation_block(raw: str, rule: str) -> dict:
    return {
        "validation_status": "SECURITY_VIOLATION_BLOCKED",
        "violation_rule": rule,
        "violation_reason": "Mathematical expressions are not valid dispatch requests.",
        "llm_called": False,
        "needs_review": True,
        "raw_text": raw[:MAX_INPUT_CHARS],
    }


# =============================================================================
# Module 01 - verified dialect parsing
# =============================================================================
def _apply_spatial_correction(request: dict, landmarks: list[str]) -> dict[str, Correction]:
    corrections: dict[str, Correction] = {}
    for field in ("pickup_location", "destination_location"):
        result = correct_location(request[field], landmarks)
        corrections[field] = result
        if result.applied:
            request[field] = result.corrected
    return corrections


def process_and_verify_request_detailed(
    raw_input_text: str,
    *,
    extractor: Callable[[str], dict] | None = None,
    landmarks: list[str] | None = None,
) -> dict:
    """Full result: {"status", "request", "meta"} or a security-violation block."""
    if not isinstance(raw_input_text, str) or not raw_input_text.strip():
        return {**_violation_block("" if not isinstance(raw_input_text, str) else raw_input_text, "EMPTY_OR_NON_TEXT_INPUT"),
                "validation_status": "REJECTED_INVALID_INPUT"}
    text = raw_input_text.strip()
    if len(text) > MAX_INPUT_CHARS:
        return {**_violation_block(text, "INPUT_TOO_LONG"), "validation_status": "REJECTED_INVALID_INPUT"}
    rule = scan_token_firewall(text)
    if rule:
        return _violation_block(text, rule)          # dropped BEFORE any token reaches an LLM

    engine = {"name": "heuristic"}

    def tracking_extractor(value: str) -> dict:
        result = (extractor or call_llm_extract)(value)
        engine["name"] = result.get("_engine", "custom")
        return result

    dispatch = parse_dispatch_request(text, extractor=tracking_extractor)
    request = dispatch.model_dump()

    try:
        names = landmarks if landmarks is not None else default_landmarks()
    except Exception:  # landmark source must never break dispatching
        names = []
    corrections = _apply_spatial_correction(request, names)

    return {
        "status": "OK",
        "request": request,
        "meta": {
            "engine": engine["name"],
            "spatial_corrections": {k: v.as_dict() for k, v in corrections.items()},
            "confidence_review_threshold": CONFIDENCE_REVIEW_THRESHOLD,
        },
    }


def process_and_verify_request(raw_input_text: str) -> dict:
    """Schema-compliant dict (DispatchRequest fields) or a violation block.

    Contains the six contract keys (pickup_location, destination_location,
    vehicle_class, temporal_element, capacity_requirements, urgency_profile)
    plus the governance fields the schema already requires (confidence,
    raw_text, needs_review) so `DispatchRequest(**result)` always validates.
    """
    detailed = process_and_verify_request_detailed(raw_input_text)
    return detailed["request"] if detailed.get("status") == "OK" else detailed


# =============================================================================
# Module 02 - fallback routing gateway
# =============================================================================
_URGENCIES = {"Low", "Medium", "High", "Emergency"}
_human_queue_sink: Callable[[dict], None] | None = None


def set_human_queue_sink(sink: Callable[[dict], None] | None) -> None:
    """Register the HUMAN_DISPATCHER_QUEUE_INTERFACE consumer (e.g. the Node bridge)."""
    global _human_queue_sink
    _human_queue_sink = sink


def _json_safe(value: Any) -> Any:
    try:
        return json.loads(json.dumps(value, default=str))
    except (TypeError, ValueError):
        return {"unserialisable_payload": str(type(value))}


def _route_to_human(state: Any, verdict: str, reason: str, *, needs_review: bool = True) -> dict:
    payload = _json_safe(copy.deepcopy(state))
    result = {
        "fallback_verdict": verdict,
        "routing_target": HUMAN_DISPATCHER_QUEUE_INTERFACE,
        "needs_review": needs_review,
        "halt_autonomous_allocation": True,
        "reason": reason,
        "human_queue_payload": payload,
    }
    if _human_queue_sink is not None:
        try:
            _human_queue_sink(result)
        except Exception:                       # queue outage must not hide the routing decision
            result["human_queue_delivery"] = "SINK_FAILED"
    return result


def check_confidence_fallback(state: dict) -> dict:
    try:
        if not isinstance(state, dict):
            raise TypeError("state must be a dict")
        urgency = state["urgency_profile"]
        if urgency not in _URGENCIES:
            raise ValueError("unknown urgency_profile")

        # Emergency override: the threshold is bypassed entirely.
        if urgency == "Emergency":
            return _route_to_human(state, "EMERGENCY_OVERRIDE_HUMAN_CONFIRMATION",
                                   "Emergency urgency requires immediate human confirmation.")

        confidence = state["confidence"]
        if isinstance(confidence, bool) or not isinstance(confidence, (int, float)) \
                or not math.isfinite(confidence) or not 0.0 <= float(confidence) <= 1.0:
            raise ValueError("confidence must be a finite number in [0, 1]")

        if float(confidence) < CONFIDENCE_REVIEW_THRESHOLD:
            return _route_to_human(state, "CONFIDENCE_BELOW_THRESHOLD",
                                   f"confidence {float(confidence):.2f} < {CONFIDENCE_REVIEW_THRESHOLD}")
        return {
            "fallback_verdict": "CONFIDENCE_ACCEPTED",
            "routing_target": AUTONOMOUS_DISPATCH_PIPELINE,
            "needs_review": bool(state.get("needs_review", False)),
            "halt_autonomous_allocation": False,
            "reason": "confidence at or above threshold",
            "human_queue_payload": None,
        }
    except Exception as exc:                    # corrupt / missing fields -> fail SAFE to a human
        return _route_to_human(state, "STRUCTURAL_FAULT_TRIGGERED",
                               f"STRUCTURAL_FAULT_TRIGGERED: {type(exc).__name__}")


# =============================================================================
# Voice: Whisper speech-to-text (Arabic)
# =============================================================================
WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions"
WHISPER_MODEL = "whisper-1"
WHISPER_LANGUAGE = "ar"
MAX_AUDIO_BYTES = 25 * 1024 * 1024            # Whisper API limit
ALLOWED_AUDIO_EXTENSIONS = {".wav", ".mp3"}


class VoiceInputError(ValueError):
    """Bad audio input (type, size, empty). Safe to show to the caller."""


class VoiceUnavailable(RuntimeError):
    """No Whisper key available or every key exhausted."""


def _sniff_audio(data: bytes) -> str | None:
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return ".wav"
    if data[:3] == b"ID3" or (len(data) > 1 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0):
        return ".mp3"
    return None


def _multipart(fields: dict[str, str], filename: str, content_type: str, data: bytes) -> tuple[bytes, str]:
    boundary = f"----masari{uuid.uuid4().hex}"
    parts: list[bytes] = []
    for name, value in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    parts.append((f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
                  f"Content-Type: {content_type}\r\n\r\n").encode() + data + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), boundary


def transcribe_audio_bytes(data: bytes, filename: str = "audio.wav") -> str:
    """Raw audio bytes (.wav/.mp3) -> Arabic transcript. Audio is never written to disk."""
    if not data:
        raise VoiceInputError("empty audio payload")
    if len(data) > MAX_AUDIO_BYTES:
        raise VoiceInputError("audio payload exceeds 25 MB")
    kind = _sniff_audio(data)
    declared = Path(filename).suffix.lower()
    if kind is None or declared not in ALLOWED_AUDIO_EXTENSIONS:
        raise VoiceInputError("only .wav and .mp3 audio is accepted")
    content_type = "audio/wav" if kind == ".wav" else "audio/mpeg"
    safe_name = f"audio{kind}"

    body, boundary = _multipart({"model": WHISPER_MODEL, "language": WHISPER_LANGUAGE, "response_format": "json",
                                 "temperature": "0"}, safe_name, content_type, data)

    def call(_provider: str, key: str) -> str:
        status, raw = http_post(WHISPER_URL, {"Authorization": f"Bearer {key}",
                                              "Content-Type": f"multipart/form-data; boundary={boundary}"},
                                body, timeout=60.0)
        classify_status(status, raw)
        try:
            text = json.loads(raw.decode("utf-8"))["text"]
        except (KeyError, ValueError, UnicodeDecodeError):
            raise ProviderError("unexpected_whisper_shape") from None
        if not isinstance(text, str):
            raise ProviderError("unexpected_whisper_shape")
        return text.strip()

    pool = load_pool("openai")
    if not len(pool):
        raise VoiceUnavailable("voice transcription is not configured")
    try:
        transcript, _provider, _index = run_with_failover([pool], call)
    except AllProvidersExhausted:
        raise VoiceUnavailable("voice transcription is temporarily unavailable") from None
    return transcript


def process_voice_intent_to_text(audio_file_path: str) -> str:
    path = Path(audio_file_path)
    if path.suffix.lower() not in ALLOWED_AUDIO_EXTENSIONS:
        raise VoiceInputError("only .wav and .mp3 audio is accepted")
    try:
        size = path.stat().st_size
        if size > MAX_AUDIO_BYTES:
            raise VoiceInputError("audio payload exceeds 25 MB")
        data = path.read_bytes()
    except OSError:
        raise VoiceInputError("audio file could not be read") from None
    return transcribe_audio_bytes(data, path.name)


# =============================================================================
# Contextual UI directives (contract v1; mirrored in TypeScript and Dart)
# =============================================================================
UI_DIRECTIVES_SCHEMA_VERSION = 1
EMERGENCY_HEX = "#DC2626"
LOGISTICS_HEX = "#0F766E"
STANDARD_HEX = "#1D4ED8"
_DEFAULT_EMERGENCY_NUMBERS = (
    # Verify against the official Palestinian emergency numbers before launch;
    # override per deployment with AI_SERVICES_EMERGENCY_NUMBERS="101,100,102".
    ("101", "الإسعاف", "Ambulance"),
    ("100", "الشرطة", "Police"),
    ("102", "الدفاع المدني", "Civil Defense"),
)


def _emergency_actions() -> list[dict]:
    override = os.environ.get("AI_SERVICES_EMERGENCY_NUMBERS", "").strip()
    numbers = [n.strip() for n in override.split(",") if re.fullmatch(r"\+?\d{2,15}", n.strip())] if override else []
    table = {n: (ar, en) for n, ar, en in _DEFAULT_EMERGENCY_NUMBERS}
    entries = ([(n, *table.get(n, ("اتصال طوارئ", "Emergency call"))) for n in numbers]
               if numbers else list(_DEFAULT_EMERGENCY_NUMBERS))
    return [{"id": f"dial_{number}", "label_ar": ar, "label_en": en, "dial_uri": f"tel:{number}"}
            for number, ar, en in entries]


def _logistics_progress(payload: dict) -> dict:
    parcels = max(int(payload.get("capacity_requirements") or 1), 1)
    savings = simulated_savings_percentage(parcels, max(parcels, 10))
    series = [{"step": i, "trips_without_batching": i, "trips_with_batching": 1} for i in range(1, parcels + 1)][:20]
    return {
        "parcels_total": parcels,
        "trips_saved": max(parcels - 1, 0),
        "fuel_savings_index": round(savings / 100.0, 4),
        "fuel_savings_percentage": savings,
        "series": series,
        "is_simulation": True,
    }


def generate_dynamic_ai_ui_payload(extracted_payload: dict) -> dict:
    """Return a copy of the payload with `frontend_ai_ui_directives` added."""
    payload = dict(extracted_payload)
    urgency = payload.get("urgency_profile")
    vehicle = payload.get("vehicle_class")
    emergency = urgency == "Emergency"
    logistics = vehicle == "Logistics"

    directives = {
        "schema_version": UI_DIRECTIVES_SCHEMA_VERSION,
        "mode": "emergency" if emergency else ("logistics" if logistics else "standard"),
        "theme": {
            "primary_color_hex": EMERGENCY_HEX if emergency else (LOGISTICS_HEX if logistics else STANDARD_HEX),
            "flashing": emergency,
            "flash_interval_ms": 800 if emergency else 0,
            "respect_reduce_motion": True,
        },
        "haptics": {
            "vibrate": emergency,
            "pattern_ms": [0, 500, 200, 500, 200, 800] if emergency else [],
        },
        "emergency_actions": _emergency_actions() if emergency else [],
        "logistics_progress": _logistics_progress(payload) if logistics else None,
        "requires_human_confirmation": bool(emergency or payload.get("needs_review")),
    }
    payload["frontend_ai_ui_directives"] = directives
    return payload
