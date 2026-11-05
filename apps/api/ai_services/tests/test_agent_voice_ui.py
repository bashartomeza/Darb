import json

import pytest

from ai_services import nlp_engine, provider_pool

WAV = b"RIFF" + b"\x24\x00\x00\x00" + b"WAVE" + b"fmt " + b"\x00" * 40
MP3 = b"ID3" + b"\x00" * 50


# ------------------------------------------------------------------ voice
def test_whisper_request_is_whisper_1_arabic_multipart(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-AAAAAAAAAAAAAAAAAAAA")
    captured = {}

    def fake(url, headers, body, timeout=15.0):
        captured.update(url=url, headers=headers, body=body)
        return 200, json.dumps({"text": "  بدي سيرفيس من بيت لحم للخليل  "}).encode()

    monkeypatch.setattr(nlp_engine, "http_post", fake)
    assert nlp_engine.transcribe_audio_bytes(WAV, "x.wav") == "بدي سيرفيس من بيت لحم للخليل"
    body = captured["body"]
    assert captured["url"].endswith("/audio/transcriptions")
    assert b'name="model"\r\n\r\nwhisper-1' in body and b'name="language"\r\n\r\nar' in body and WAV in body
    assert captured["headers"]["Content-Type"].startswith("multipart/form-data; boundary=")


@pytest.mark.parametrize("data,name", [(b"", "a.wav"), (b"not audio at all", "a.wav"), (WAV, "a.ogg"), (MP3, "a.wav.exe")])
def test_bad_audio_rejected_before_any_network(data, name, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-AAAAAAAAAAAAAAAAAAAA")
    monkeypatch.setattr(nlp_engine, "http_post", lambda *a, **k: pytest.fail("network used"))
    with pytest.raises(nlp_engine.VoiceInputError):
        nlp_engine.transcribe_audio_bytes(data, name)


def test_voice_without_keys_or_when_exhausted_is_unavailable(monkeypatch):
    with pytest.raises(nlp_engine.VoiceUnavailable):
        nlp_engine.transcribe_audio_bytes(WAV, "a.wav")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-AAAAAAAAAAAAAAAAAAAA")
    monkeypatch.setattr(nlp_engine, "http_post", lambda *a, **k: (429, b"{}"))
    with pytest.raises(nlp_engine.VoiceUnavailable):
        nlp_engine.transcribe_audio_bytes(WAV, "a.wav")


def test_file_path_entrypoint(tmp_path, monkeypatch):
    f = tmp_path / "rec.mp3"
    f.write_bytes(MP3)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-AAAAAAAAAAAAAAAAAAAA")
    monkeypatch.setattr(nlp_engine, "http_post", lambda *a, **k: (200, '{"text":"مرحبا"}'.encode("utf-8")))
    assert nlp_engine.process_voice_intent_to_text(str(f)) == "مرحبا"
    with pytest.raises(nlp_engine.VoiceInputError):
        nlp_engine.process_voice_intent_to_text(str(tmp_path / "missing.wav"))


# ------------------------------------------------------------------ UI directives
def test_emergency_directives_hex_haptics_and_dial_buttons():
    d = nlp_engine.generate_dynamic_ai_ui_payload({"urgency_profile": "Emergency", "vehicle_class": "Unspecified"})["frontend_ai_ui_directives"]
    assert d["mode"] == "emergency" and d["theme"]["primary_color_hex"] == "#DC2626" and d["theme"]["flashing"]
    assert d["haptics"]["vibrate"] and d["haptics"]["pattern_ms"] and d["requires_human_confirmation"]
    assert all(a["dial_uri"].startswith("tel:") for a in d["emergency_actions"]) and len(d["emergency_actions"]) == 3
    assert d["theme"]["respect_reduce_motion"] is True and d["logistics_progress"] is None


def test_logistics_directives_chart_series_and_savings_bounds():
    d = nlp_engine.generate_dynamic_ai_ui_payload({"urgency_profile": "High", "vehicle_class": "Logistics", "capacity_requirements": 4})["frontend_ai_ui_directives"]
    p = d["logistics_progress"]
    assert d["mode"] == "logistics" and not d["haptics"]["vibrate"] and d["emergency_actions"] == []
    assert p["parcels_total"] == 4 and len(p["series"]) == 4 and p["is_simulation"]
    assert 0.2 <= p["fuel_savings_index"] <= 0.4 and p["trips_saved"] == 3


def test_standard_directives_and_emergency_number_override(monkeypatch):
    d = nlp_engine.generate_dynamic_ai_ui_payload({"urgency_profile": "Low", "vehicle_class": "Public"})["frontend_ai_ui_directives"]
    assert d["mode"] == "standard" and not d["theme"]["flashing"]
    monkeypatch.setenv("AI_SERVICES_EMERGENCY_NUMBERS", "101,+97012345,evil;rm")
    e = nlp_engine.generate_dynamic_ai_ui_payload({"urgency_profile": "Emergency"})["frontend_ai_ui_directives"]
    assert [a["dial_uri"] for a in e["emergency_actions"]] == ["tel:101", "tel:+97012345"]
