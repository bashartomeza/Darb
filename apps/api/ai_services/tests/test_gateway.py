from ai_services.gateway import (
    CONFIDENCE_THRESHOLD_TARGET,
    evaluate_gateway,
    evaluate_gateway_from_raw,
)
from ai_services.pipeline import parse_dispatch_request


def test_high_confidence_routes_autonomous():
    result = parse_dispatch_request("بدي سيرفيس عادي")
    result = result.model_copy(update={"confidence": 0.95, "urgency_profile": "Low"})
    decision = evaluate_gateway(result)
    assert decision.gateway_verdict == "CONFIDENCE_PASSED"
    assert decision.routing_target == "AUTONOMOUS_DISPATCH_PIPELINE"
    assert decision.current_confidence_percentage == "95.00%"


def test_low_confidence_routes_human():
    result = parse_dispatch_request("بدي سيرفيس عادي")
    result = result.model_copy(update={"confidence": 0.60, "urgency_profile": "Low"})
    decision = evaluate_gateway(result)
    assert decision.gateway_verdict == "CONFIDENCE_BREACHED_WARNING"
    assert decision.routing_target == "HUMAN_DISPATCHER_QUEUE_INTERFACE"


def test_emergency_forces_human_review_even_at_high_confidence():
    # A high confidence score must NOT bypass human review for an emergency.
    result = parse_dispatch_request("في واحد مجروح بدنا اسعاف قوام")
    result = result.model_copy(update={"confidence": 0.99})
    decision = evaluate_gateway(result)
    assert decision.gateway_verdict == "CONFIDENCE_BREACHED_WARNING"
    assert decision.routing_target == "HUMAN_DISPATCHER_QUEUE_INTERFACE"


def test_threshold_boundary_at_exactly_target():
    result = parse_dispatch_request("بدي سيرفيس عادي")
    result = result.model_copy(update={"confidence": CONFIDENCE_THRESHOLD_TARGET, "urgency_profile": "Low"})
    decision = evaluate_gateway(result)
    assert decision.gateway_verdict == "CONFIDENCE_PASSED"


def test_raw_entrypoint_handles_valid_payload():
    raw = {
        "confidence_score": 0.92,
        "initial_payload": {
            "pickup_location": "دوار المنارة",
            "destination_location": "مستشفى الشفاء",
            "vehicle_class": "Public",
            "temporal_element": "Immediate",
            "capacity_requirements": 1,
            "urgency_profile": "High",
        },
    }
    decision = evaluate_gateway_from_raw(raw)
    assert decision.gateway_verdict == "CONFIDENCE_PASSED"


def test_raw_entrypoint_handles_missing_confidence_score():
    raw = {"initial_payload": {"pickup_location": "X", "destination_location": "Y"}}
    decision = evaluate_gateway_from_raw(raw)
    assert decision.gateway_verdict == "STRUCTURAL_FAULT_TRIGGERED"
    assert decision.routing_target == "HUMAN_DISPATCHER_QUEUE_INTERFACE"


def test_raw_entrypoint_handles_out_of_range_confidence():
    raw = {"confidence_score": 1.5, "initial_payload": {"pickup_location": "X", "destination_location": "Y"}}
    decision = evaluate_gateway_from_raw(raw)
    assert decision.gateway_verdict == "STRUCTURAL_FAULT_TRIGGERED"


def test_raw_entrypoint_handles_wrong_type_confidence():
    raw = {"confidence_score": "high", "initial_payload": {"pickup_location": "X", "destination_location": "Y"}}
    decision = evaluate_gateway_from_raw(raw)
    assert decision.gateway_verdict == "STRUCTURAL_FAULT_TRIGGERED"
