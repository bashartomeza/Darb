"""Unified verified pipeline: text/voice -> parse -> fallback gate -> UI directives.

Every request runs inside one total time budget (see provider_pool.request_deadline)
so provider failover can never outlive the Node client's timeout. When the budget
runs out the text path answers from the offline heuristic with low confidence
(which routes to a human); the voice path reports "voice unavailable".
"""
from __future__ import annotations

from .gateway import evaluate_gateway
from .nlp_engine import (
    AUTONOMOUS_DISPATCH_PIPELINE,
    HUMAN_DISPATCHER_QUEUE_INTERFACE,
    check_confidence_fallback,
    generate_dynamic_ai_ui_payload,
    process_and_verify_request_detailed,
    transcribe_audio_bytes,
)
from .provider_pool import request_deadline, text_budget_seconds, voice_budget_seconds
from .schema import DispatchRequest


def decide_routing(request: dict) -> dict:
    """Autonomous dispatch only when BOTH gates pass.

    gate 1 (hard review): confidence < 0.5 or Emergency  -> check_confidence_fallback
    gate 2 (soft target): confidence < 0.85              -> gateway.evaluate_gateway
    Any malformed request (including NaN/inf confidence) goes to a human.
    """
    hard = check_confidence_fallback(request)
    try:
        soft = evaluate_gateway(DispatchRequest(**request))
        soft_target, soft_verdict = soft.routing_target, soft.gateway_verdict
    except Exception:
        soft_target, soft_verdict = HUMAN_DISPATCHER_QUEUE_INTERFACE, "STRUCTURAL_FAULT_TRIGGERED"
    autonomous = (hard["routing_target"] == AUTONOMOUS_DISPATCH_PIPELINE
                  and soft_target == "AUTONOMOUS_DISPATCH_PIPELINE")
    return {
        "routing_target": AUTONOMOUS_DISPATCH_PIPELINE if autonomous else HUMAN_DISPATCHER_QUEUE_INTERFACE,
        "needs_review": not autonomous or bool(request.get("needs_review")),
        "hard_gate": {"verdict": hard["fallback_verdict"], "reason": hard["reason"]},
        "soft_gate": {"verdict": soft_verdict},
    }


def _analyze_text(text: str, routes: list[dict] | None) -> dict:
    detailed = process_and_verify_request_detailed(text, routes=routes)
    if detailed.get("status") != "OK":
        return {"status": detailed["validation_status"], "block": detailed,
                "routing": {"routing_target": HUMAN_DISPATCHER_QUEUE_INTERFACE, "needs_review": True},
                "frontend_ai_ui_directives": None}
    request = detailed["request"]
    routing = decide_routing(request)
    directives = generate_dynamic_ai_ui_payload(request)["frontend_ai_ui_directives"]
    if routing["routing_target"] == HUMAN_DISPATCHER_QUEUE_INTERFACE:
        directives["requires_human_confirmation"] = True
    return {"status": "OK", "dispatch": request, "routing": routing, "meta": detailed["meta"],
            "frontend_ai_ui_directives": directives}


def analyze_text(text: str, routes: list[dict] | None = None, *, budget_seconds: float | None = None) -> dict:
    with request_deadline(text_budget_seconds() if budget_seconds is None else budget_seconds):
        return _analyze_text(text, routes)


def analyze_voice(audio: bytes, filename: str = "audio.wav", *, budget_seconds: float | None = None) -> dict:
    with request_deadline(voice_budget_seconds() if budget_seconds is None else budget_seconds):
        transcript = transcribe_audio_bytes(audio, filename)
        return {**_analyze_text(transcript, None), "transcript": transcript}
