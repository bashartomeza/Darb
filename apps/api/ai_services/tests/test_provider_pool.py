import json

import pytest

from ai_services import llm_extractor, provider_pool
from ai_services.provider_pool import KeyPool, ResourceExhausted, run_with_failover


def _gemini_ok(payload: dict) -> bytes:
    return json.dumps({"candidates": [{"content": {"parts": [{"text": json.dumps(payload)}]}}]}).encode()


GOOD = {"pickup_location": "بيت لحم", "destination_location": "الخليل", "vehicle_class": "Public",
        "temporal_element": "Unspecified", "capacity_requirements": 1, "urgency_profile": "Low", "confidence": 0.9}


def test_key_n_rate_limited_slides_to_key_n_plus_1(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEYS", "gem-key-AAAAAAAAAAAAAAAA,gem-key-BBBBBBBBBBBBBBBB")
    used = []

    def fake_post(url, headers, body, timeout=15.0):
        used.append(headers["x-goog-api-key"])
        return (429, b"{}") if len(used) == 1 else (200, _gemini_ok(GOOD))

    monkeypatch.setattr(provider_pool, "http_post", fake_post)
    result = llm_extractor.llm_extract("بدي سيرفيس")
    assert used == ["gem-key-AAAAAAAAAAAAAAAA", "gem-key-BBBBBBBBBBBBBBBB"]
    assert result["_engine"] == "gemini" and result["confidence"] == 0.9


def test_gemini_pool_drained_swaps_to_groq(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEYS", "gem-key-AAAAAAAAAAAAAAAA,gem-key-BBBBBBBBBBBBBBBB")
    monkeypatch.setenv("GROQ_API_KEYS", "groq-key-CCCCCCCCCCCCCCC")
    hosts = []

    def fake_post(url, headers, body, timeout=15.0):
        hosts.append(url.split("/")[2])
        if "googleapis" in url:
            return 429, b'{"error":{"status":"RESOURCE_EXHAUSTED"}}'
        return 200, json.dumps({"choices": [{"message": {"content": json.dumps(GOOD)}}]}).encode()

    monkeypatch.setattr(provider_pool, "http_post", fake_post)
    result = llm_extractor.llm_extract("x")
    assert hosts == ["generativelanguage.googleapis.com"] * 2 + ["api.groq.com"]
    assert result["_engine"] == "groq"


def test_everything_exhausted_falls_back_to_offline_heuristic(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "gem-key-AAAAAAAAAAAAAAAA")
    monkeypatch.setenv("GROQ_API_KEY", "groq-key-CCCCCCCCCCCCCCC")
    monkeypatch.setattr(provider_pool, "http_post", lambda *a, **k: (429, b"{}"))
    result = llm_extractor.call_llm_extract("بدي سيرفيس من بيت لحم للخليل")
    assert result["_engine"] == "heuristic"


def test_no_keys_means_offline_without_network(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("network must not be touched without keys")
    monkeypatch.setattr(provider_pool, "http_post", boom)
    assert llm_extractor.call_llm_extract("بدي سيرفيس")["_engine"] == "heuristic"


def test_malicious_model_output_is_clamped(monkeypatch):
    evil = {**GOOD, "urgency_profile": "<script>", "vehicle_class": "Spaceship", "capacity_requirements": -5, "confidence": 7}
    monkeypatch.setenv("GROQ_API_KEY", "groq-key-CCCCCCCCCCCCCCC")
    monkeypatch.setattr(provider_pool, "http_post", lambda *a, **k: (
        200, json.dumps({"choices": [{"message": {"content": json.dumps(evil)}}]}).encode()))
    r = llm_extractor.llm_extract("x")
    assert (r["urgency_profile"], r["vehicle_class"], r["capacity_requirements"], r["confidence"]) == ("Low", "Unspecified", 1, 1.0)


def test_keys_never_appear_in_repr_or_errors():
    pool = KeyPool("gemini", ["super-secret-key-1234567890"])
    assert "super-secret" not in repr(pool)

    def call(provider, key):
        raise ResourceExhausted("http_429")
    with pytest.raises(provider_pool.AllProvidersExhausted) as info:
        run_with_failover([pool], call)
    assert "super-secret" not in str(info.value)


def test_cooldown_skips_drained_key_then_recovers():
    pool = KeyPool("groq", ["a", "b"])
    pool.mark_exhausted(0, now=100.0)
    assert [i for i, _ in pool.candidates(now=101.0)] == [1]
    assert [i for i, _ in pool.candidates(now=100.0 + provider_pool.KEY_COOLDOWN_SECONDS + 1)] == [1, 0]
