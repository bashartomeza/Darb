"""Orchestration of the two NLP layers (LLM extraction + deterministic safety)."""
from __future__ import annotations

import math
from typing import Callable

from pydantic import ValidationError

from .lexicons import (
    apply_safety_layer,
    detect_immediate_time,
    detect_vehicle_class,
    extract_capacity,
    extract_clock_time,
)
from .llm_extractor import call_llm_extract
from .schema import DispatchRequest

# Single source of truth for the review threshold (shared with nlp_engine and
# gateway). Below this confidence a human must double-check the request.
CONFIDENCE_REVIEW_THRESHOLD = 0.5


def parse_dispatch_request(
    raw_text: str,
    extractor: Callable[[str], dict] = call_llm_extract,
) -> DispatchRequest:
    llm_result = extractor(raw_text)

    # Deterministic layer may only RAISE urgency, never lower it.
    final_urgency = apply_safety_layer(raw_text, llm_result.get("urgency_profile", "Low"))

    vehicle_class = detect_vehicle_class(raw_text)
    if vehicle_class == "Unspecified":
        vehicle_class = llm_result.get("vehicle_class", "Unspecified")

    temporal_element = "Immediate" if detect_immediate_time(raw_text) else llm_result.get("temporal_element", "Unspecified")
    if temporal_element == "Unspecified":
        clock_time = extract_clock_time(raw_text)
        if clock_time:
            temporal_element = clock_time

    capacity = extract_capacity(raw_text)
    raw_confidence = llm_result.get("confidence", 0.5)
    if isinstance(raw_confidence, bool) or not isinstance(raw_confidence, (int, float)) \
            or not math.isfinite(raw_confidence):
        confidence = 0.0                      # NaN/inf/non-numeric: invalid, so a human reviews it
    else:
        confidence = max(0.0, min(1.0, float(raw_confidence)))
    needs_review = confidence < CONFIDENCE_REVIEW_THRESHOLD
    if final_urgency == "Emergency":
        needs_review = True

    payload = {
        "pickup_location": llm_result.get("pickup_location", "Unspecified"),
        "destination_location": llm_result.get("destination_location", "Unspecified"),
        "vehicle_class": vehicle_class,
        "temporal_element": temporal_element,
        "capacity_requirements": capacity,
        "urgency_profile": final_urgency,
        "confidence": confidence,
        "raw_text": raw_text,
        "needs_review": needs_review,
    }
    try:
        return DispatchRequest(**payload)
    except ValidationError:
        return DispatchRequest(
            pickup_location=payload.get("pickup_location") or "Unspecified",
            destination_location=payload.get("destination_location") or "Unspecified",
            vehicle_class="Unspecified",
            temporal_element="Unspecified",
            capacity_requirements=1,
            urgency_profile=final_urgency,
            confidence=0.0,
            raw_text=raw_text,
            needs_review=True,
        )
