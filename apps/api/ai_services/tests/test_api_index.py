import json
from pathlib import Path

import pytest

from ai_services import nlp_engine, provider_pool
from ai_services.api.index import handle_request

SECRET = "unit-test-shared-secret-1234"
AUTH = {"X-Internal-Secret": SECRET}
WAV = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 40
CONTRACT_DIR = Path(__file__).resolve().parent.parent / "contracts"


@pytest.fixture(autouse=True)
def secret(monkeypatch):
    monkeypatch.setenv("AI_SERVICES_SHARED_SECRET", SECRET)
    monkeypatch.setattr(nlp_engine, "default_landmarks", lambda: ["دوار المنارة", "مكتب البريد المركزي"])


def post(path, body, headers=AUTH, ctype="application/json"):
    raw = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
    return handle_request("POST", path, {**headers, "Content-Type": ctype}, raw)


def test_health_is_public_and_leaks_only_counts(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "groq-key-secret-ZZZZZZZZZZZ")
    status, body = handle_request("GET", "/health", {}, b"")
    assert status == 200 and body["provider_keys"]["groq"] == 1 and "secret" not in json.dumps(body)


@pytest.mark.parametrize("headers", [{}, {"X-Internal-Secret": "wrong"}])
def test_requests_without_valid_secret_are_refused(headers):
    assert post("/v1/analyze", {"text": "x"}, headers)[0] == 401


def test_unset_or_weak_secret_fails_closed(monkeypatch):
    monkeypatch.setenv("AI_SERVICES_SHARED_SECRET", "short")
    assert post("/v1/analyze", {"text": "x"}, {"X-Internal-Secret": "short"})[0] == 401
    monkeypatch.delenv("AI_SERVICES_SHARED_SECRET")
    assert post("/v1/analyze", {"text": "x"}, {"X-Internal-Secret": ""})[0] == 401


def test_analyze_emergency_routes_to_human_with_red_directives():
    status, body = post("/v1/analyze", {"text": "في واحد مجروح عند الشفاا بدنا اسعاف قوام"})
    d = body["frontend_ai_ui_directives"]
    assert status == 200 and body["dispatch"]["urgency_profile"] == "Emergency"
    assert body["routing"]["routing_target"] == "HUMAN_DISPATCHER_QUEUE_INTERFACE"
    assert d["theme"]["primary_color_hex"] == "#DC2626" and d["haptics"]["vibrate"] and d["requires_human_confirmation"]


def test_analyze_logistics_end_to_end_with_spatial_correction():
    status, body = post("/v1/analyze", {"text": "بدنا تكتك قوام يسحب كرتونتين كبار من عند دوار المناررة وننزلهم بمكتب البريد المركزي والوضع مستعجل"})
    assert status == 200 and body["dispatch"]["pickup_location"] == "دوار المنارة"
    assert body["frontend_ai_ui_directives"]["logistics_progress"]["parcels_total"] == 2
    # heuristic confidence 0.55 passes the 0.5 hard gate but not the 0.85 soft target -> human
    assert body["routing"]["hard_gate"]["verdict"] == "CONFIDENCE_ACCEPTED"
    assert body["routing"]["routing_target"] == "HUMAN_DISPATCHER_QUEUE_INTERFACE"


def test_math_prompt_is_422_and_never_reaches_a_provider(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "gem-key-AAAAAAAAAAAAAAAA")
    monkeypatch.setattr(provider_pool, "http_post", lambda *a, **k: pytest.fail("provider called"))
    status, body = post("/v1/analyze", {"text": "what is 12345 * 6789 ?"})
    assert status == 422 and body["status"] == "SECURITY_VIOLATION_BLOCKED"


def test_raw_gps_in_payload_is_banned_and_bad_json_is_400():
    assert post("/v1/analyze", {"text": "x", "driver": {"latitude": 31.9, "longitude": 35.2}}) == (400, {"error": "raw_gps_streaming_banned"})
    assert post("/v1/analyze", b"{not json")[1] == {"error": "invalid_json"}
    assert post("/v1/analyze", {"nope": 1})[1] == {"error": "text_required"}
    assert post("/v1/analyze", b"x" * 9000)[0] == 413


def test_voice_pipeline_audio_to_transcript_to_verified_dispatch(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-AAAAAAAAAAAAAAAAAAAA")
    monkeypatch.setattr(nlp_engine, "http_post",
                        lambda *a, **k: (200, json.dumps({"text": "بدي سيرفيس من بيت لحم للخليل الساعة 16:00"}).encode()))
    status, body = post("/v1/voice", WAV, ctype="audio/wav")
    assert status == 200 and body["transcript"].startswith("بدي سيرفيس")
    assert body["dispatch"]["temporal_element"] == "16:00" and body["frontend_ai_ui_directives"]["mode"] == "standard"


def test_voice_edge_cases(monkeypatch):
    assert post("/v1/voice", WAV, ctype="application/json")[0] == 415
    assert post("/v1/voice", b"garbage", ctype="audio/wav")[0] == 400
    assert post("/v1/voice", WAV, ctype="audio/wav")[0] == 503                       # no key configured


def test_voice_transcript_that_is_math_is_blocked_after_stt(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-AAAAAAAAAAAAAAAAAAAA")
    monkeypatch.setattr(nlp_engine, "http_post", lambda *a, **k: (200, '{"text":"اثنين زائد 2+2=4"}'.encode("utf-8")))
    status, body = post("/v1/voice", WAV, ctype="audio/wav")
    assert status == 422 and body["status"] == "SECURITY_VIOLATION_BLOCKED"


def test_shared_contract_fixture_matches_live_output():
    """The same JSON is parsed by the Node (vitest) and Flutter tests."""
    fixture = json.loads((CONTRACT_DIR / "ui_directives.v1.json").read_text(encoding="utf-8"))
    live = {
        "emergency": nlp_engine.generate_dynamic_ai_ui_payload({"urgency_profile": "Emergency", "vehicle_class": "Public"})["frontend_ai_ui_directives"],
        "logistics": nlp_engine.generate_dynamic_ai_ui_payload({"urgency_profile": "High", "vehicle_class": "Logistics", "capacity_requirements": 4})["frontend_ai_ui_directives"],
        "standard": nlp_engine.generate_dynamic_ai_ui_payload({"urgency_profile": "Low", "vehicle_class": "Public"})["frontend_ai_ui_directives"],
    }
    assert fixture == live, "contracts/ui_directives.v1.json is stale - regenerate with `python -m ai_services.contracts_dump`"
