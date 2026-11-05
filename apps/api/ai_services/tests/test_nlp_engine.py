import pytest

from ai_services import nlp_engine, spatial
from ai_services.nlp_engine import (
    check_confidence_fallback,
    process_and_verify_request,
    process_and_verify_request_detailed,
    scan_token_firewall,
)
from ai_services.schema import DispatchRequest

SIX_KEYS = {"pickup_location", "destination_location", "vehicle_class", "temporal_element",
            "capacity_requirements", "urgency_profile"}
LANDMARKS = ["دوار المنارة", "دوار الساعة", "مكتب البريد المركزي", "باب الزاوية"]


@pytest.fixture(autouse=True)
def offline_landmarks(monkeypatch):
    monkeypatch.setattr(nlp_engine, "default_landmarks", lambda: list(LANDMARKS))


# ------------------------------------------------------------- firewall
@pytest.mark.parametrize("text", ["2+2", "5 * 3 = 15", "كم ١٠ + ٥ ؟", "100 / 4", "(2+3)*4", "7 = 7", "2^8", "9 - 3"])
def test_math_expressions_are_dropped_before_the_llm(text, monkeypatch):
    def llm_must_not_run(_):
        raise AssertionError("LLM was called for a blocked expression")
    result = process_and_verify_request_detailed(text, extractor=llm_must_not_run)
    assert result["validation_status"] == "SECURITY_VIOLATION_BLOCKED" and result["llm_called"] is False


@pytest.mark.parametrize("text", ["بدي سيرفيس الساعة 16:00", "رقمي 0599-123-456 بدي تكسي", "بدنا 3 كراتين", "من بيت لحم للخليل"])
def test_legitimate_numbers_pass_the_firewall(text):
    assert scan_token_firewall(text) is None


def test_plain_entrypoint_returns_violation_block():
    assert process_and_verify_request("3*3")["validation_status"] == "SECURITY_VIOLATION_BLOCKED"


# ------------------------------------------------------------- contract
def test_success_output_has_six_contract_keys_and_validates_against_schema():
    result = process_and_verify_request("بدي سيرفيس من بيت لحم للخليل الساعة 16:00")
    assert SIX_KEYS <= set(result)
    DispatchRequest(**result)                       # no contract break
    assert result["temporal_element"] == "16:00" and result["vehicle_class"] == "Public"


def test_typed_places_are_kept_verbatim_and_landmarks_are_only_a_hint():
    detailed = process_and_verify_request_detailed(
        "بدنا تكتك قوام يسحب كرتونتين كبار من عند دوار المناررة وننزلهم بمكتب البريد المركزي والوضع مستعجل")
    assert detailed["request"]["pickup_location"] == "دوار المناررة"      # exactly as typed, never overwritten
    hint = detailed["meta"]["landmark_hints"]["pickup_location"]
    assert hint["suggested"] == "دوار المنارة" and hint["original"] == "دوار المناررة"
    assert "spatial_corrections" not in detailed["meta"]


def test_no_landmark_list_by_default_means_no_hint_and_no_network(monkeypatch):
    monkeypatch.delenv("AI_SERVICES_LANDMARK_HINTS", raising=False)
    assert spatial.default_landmarks() == []
    assert not hasattr(spatial, "SEED_LANDMARKS")


def test_route_hint_uses_caller_supplied_routes_and_never_rewrites_text():
    routes = [{"key": "hebron-to-bethlehem", "origin_ar": "الخليل", "destination_ar": "بيت لحم"},
              {"key": "ramallah-to-nablus", "origin_ar": "رام الله", "destination_ar": "نابلس"}]
    detailed = process_and_verify_request_detailed("بدي سيرفيس من الخليل الى بيت لحم الساعة 16:00", routes=routes)
    assert detailed["meta"]["route_hint"]["route_key"] == "hebron-to-bethlehem"
    assert detailed["request"]["pickup_location"] == "الخليل"
    none = process_and_verify_request_detailed("بدي سيرفيس من الخليل الى نابلس", routes=routes)
    assert none["meta"]["route_hint"] is None
    assert process_and_verify_request_detailed("بدي سيرفيس من الخليل الى بيت لحم")["meta"]["route_hint"] is None


def test_levenshtein_reference_values():
    assert spatial.levenshtein("kitten", "sitting") == 3
    assert spatial.levenshtein("", "abc") == 3 and spatial.levenshtein("المنارة", "المناررة") == 1


def test_overpass_loop_falls_through_mirrors_then_caches(tmp_path):
    calls = []
    payload = '{"elements":[{"tags":{"name:ar":"دوار الجامعة","name":"University"}}]}'.encode("utf-8")

    def fetch(url):
        calls.append(url)
        if len(calls) < 3:
            raise spatial.ProviderError("transport:URLError")
        return payload

    provider = spatial.LandmarkProvider(fetch=fetch, cache_path=tmp_path / "c.json")
    assert "دوار الجامعة" in provider.get() and provider.source == "overpass" and len(calls) == 3
    second = spatial.LandmarkProvider(fetch=lambda u: (_ for _ in ()).throw(AssertionError("cache miss")), cache_path=tmp_path / "c.json")
    assert "دوار الجامعة" in second.get() and second.source == "cache"


def test_overpass_outage_gives_no_names_and_backs_off(tmp_path):
    calls = []
    provider = spatial.LandmarkProvider(fetch=lambda u: calls.append(u) or (_ for _ in ()).throw(spatial.ProviderError("x")),
                                        cache_path=tmp_path / "none.json")
    assert provider.get() == []
    n = len(calls)
    provider.get()
    assert len(calls) == n                           # failure back-off: no retry storm


# ------------------------------------------------------------- module 02
def test_below_threshold_goes_to_human_queue_with_full_payload():
    state = {"pickup_location": "x", "urgency_profile": "Low", "confidence": 0.49}
    out = check_confidence_fallback(state)
    assert out["needs_review"] and out["routing_target"] == "HUMAN_DISPATCHER_QUEUE_INTERFACE"
    assert out["halt_autonomous_allocation"] and out["human_queue_payload"] == state


def test_exact_threshold_is_accepted():
    assert check_confidence_fallback({"urgency_profile": "Low", "confidence": 0.5})["routing_target"] == "AUTONOMOUS_DISPATCH_PIPELINE"


def test_emergency_bypasses_threshold_even_at_high_confidence_or_missing_confidence():
    assert check_confidence_fallback({"urgency_profile": "Emergency", "confidence": 0.99})["fallback_verdict"] == "EMERGENCY_OVERRIDE_HUMAN_CONFIRMATION"
    assert check_confidence_fallback({"urgency_profile": "Emergency"})["routing_target"] == "HUMAN_DISPATCHER_QUEUE_INTERFACE"


@pytest.mark.parametrize("bad", [None, "str", [], {}, {"urgency_profile": "Low"}, {"urgency_profile": "Low", "confidence": "high"},
                                 {"urgency_profile": "Low", "confidence": True}, {"urgency_profile": "Low", "confidence": float("nan")},
                                 {"urgency_profile": "Nope", "confidence": 0.9}])
def test_structural_faults_fail_safe_to_human(bad):
    out = check_confidence_fallback(bad)
    assert out["fallback_verdict"] == "STRUCTURAL_FAULT_TRIGGERED" and out["routing_target"] == "HUMAN_DISPATCHER_QUEUE_INTERFACE"
    assert "STRUCTURAL_FAULT_TRIGGERED" in out["reason"]


def test_human_queue_sink_receives_routed_payload_and_failure_is_contained():
    seen = []
    nlp_engine.set_human_queue_sink(seen.append)
    check_confidence_fallback({"urgency_profile": "Low", "confidence": 0.1})
    nlp_engine.set_human_queue_sink(lambda r: 1 / 0)
    out = check_confidence_fallback({"urgency_profile": "Low", "confidence": 0.1})
    nlp_engine.set_human_queue_sink(None)
    assert len(seen) == 1 and out["human_queue_delivery"] == "SINK_FAILED"
