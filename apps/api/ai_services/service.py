"""Unified verified pipeline: text/voice -> parse -> fallback gate -> UI directives."""
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
from .schema import DispatchRequest


def decide_routing(request: dict) -> dict:
    """Autonomous dispatch only when BOTH gates pass.

    gate 1 (hard review): confidence < 0.5 or Emergency  -> check_confidence_fallback
    gate 2 (soft target): confidence < 0.85              -> gateway.evaluate_gateway
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


def analyze_text(text: str) -> dict:
    detailed = process_and_verify_request_detailed(text)
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


def analyze_voice(audio: bytes, filename: str = "audio.wav") -> dict:
    transcript = transcribe_audio_bytes(audio, filename)
    return {**analyze_text(transcript), "transcript": transcript}
