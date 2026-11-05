"""Server hardening, NaN confidence, request deadline and route/place behaviour."""
import http.client
import json
import threading
import time

import pytest

from ai_services import llm_extractor, nlp_engine, provider_pool, service
from ai_services.api import index
from ai_services.pipeline import parse_dispatch_request

SECRET = "unit-test-shared-secret-1234"


@pytest.fixture(autouse=True)
def secret(monkeypatch):
    monkeypatch.setenv("AI_SERVICES_SHARED_SECRET", SECRET)


@pytest.fixture
def server():
    srv = index.BoundedServer(("127.0.0.1", 0), index.handler, max_workers=2)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    yield srv
    srv.shutdown()
    srv.server_close()


def request(srv, method, path, body=b"", headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=5)
    conn.putrequest(method, path)
    for key, value in (headers or {}).items():
        conn.putheader(key, value)
    conn.endheaders()
    if body:
        conn.send(body)
    resp = conn.getresponse()
    data = resp.read()
    conn.close()
    return resp.status, data


# ------------------------------------------------------------ content length
@pytest.mark.parametrize("value,expected", [("12", 12), (" 7 ", 7), ("-1", None), ("+5", None), ("0x10", None),
                                            ("", None), ("1e3", None), (None, None), ("9" * 20, None), ("١٢", None)])
def test_content_length_parsing_is_strict(value, expected):
    assert index.parse_content_length(value) == expected


def test_unauthenticated_request_is_refused_before_the_body_is_read(server):
    # Declares 10 MB but sends nothing: a server that read first would hang until the timeout.
    started = time.monotonic()
    status, _ = request(server, "POST", "/v1/voice", headers={"Content-Length": str(10 * 1024 * 1024),
                                                              "Content-Type": "audio/wav"})
    assert status == 401 and time.monotonic() - started < 2


def test_negative_oversized_and_missing_length_are_rejected_without_reading(server):
    auth = {"X-Internal-Secret": SECRET, "Content-Type": "application/json"}
    assert request(server, "POST", "/v1/analyze", headers={**auth, "Content-Length": "-5"})[0] == 400
    assert request(server, "POST", "/v1/analyze", headers=auth)[0] == 400
    assert request(server, "POST", "/v1/analyze", headers={**auth, "Content-Length": str(index.MAX_JSON_BYTES + 1)})[0] == 413
    audio = {"X-Internal-Secret": SECRET, "Content-Type": "audio/wav"}
    assert request(server, "POST", "/v1/voice", headers={**audio, "Content-Length": str(index.MAX_AUDIO_BYTES + 1)})[0] == 413
    assert request(server, "POST", "/v1/analyze", headers={**auth, "Transfer-Encoding": "chunked"})[0] == 400


def test_unknown_path_is_404_for_authenticated_callers_and_401_otherwise(server):
    assert request(server, "GET", "/nope")[0] == 401
    assert request(server, "GET", "/nope", headers={"X-Internal-Secret": f"  {SECRET}  "})[0] == 404


def test_secret_is_trimmed_like_the_node_client(server, monkeypatch):
    monkeypatch.setenv("AI_SERVICES_SHARED_SECRET", f"  {SECRET}\n")
    body = json.dumps({"text": "x"}).encode()
    status, _ = request(server, "POST", "/v1/analyze", body,
                        {"X-Internal-Secret": SECRET, "Content-Type": "application/json", "Content-Length": str(len(body))})
    assert status != 401


def test_a_valid_request_works_end_to_end_over_a_socket(server):
    body = json.dumps({"text": "بدي سيرفيس من بيت لحم للخليل الساعة 16:00"}, ensure_ascii=False).encode()
    status, raw = request(server, "POST", "/v1/analyze", body,
                          {"X-Internal-Secret": SECRET, "Content-Type": "application/json", "Content-Length": str(len(body))})
    assert status in (200, 422) and json.loads(raw)["dispatch"]["pickup_location"] == "بيت لحم"


def test_bounded_pool_answers_503_when_every_worker_is_busy(server):
    gate = threading.Event()
    original = index.handle_request
    entered = threading.Semaphore(0)
    index.handle_request = lambda *a, **k: (entered.release(), gate.wait(10), (200, {"ok": True}))[2]
    try:
        results = []
        body = b'{"text":"x"}'
        hdr = {"X-Internal-Secret": SECRET, "Content-Type": "application/json", "Content-Length": str(len(body))}
        threads = [threading.Thread(target=lambda: results.append(request(server, "POST", "/v1/analyze", body, hdr)[0]))
                   for _ in range(2)]
        for t in threads:
            t.start()
        assert entered.acquire(timeout=5) and entered.acquire(timeout=5)   # both workers parked
        busy_hdr = {**hdr, "Content-Length": "0"}      # the busy server never reads a body
        assert request(server, "POST", "/v1/analyze", b"", busy_hdr)[0] == 503
        gate.set()
        for t in threads:
            t.join(5)
        assert results == [200, 200]
    finally:
        index.handle_request = original
        gate.set()


def test_handler_has_a_socket_timeout():
    assert 0 < index.handler.timeout <= 30


# ------------------------------------------------------------ JSON edge cases
def post(body):
    return index.handle_request("POST", "/v1/analyze", {"X-Internal-Secret": SECRET}, body)


def test_nan_constant_in_request_json_is_invalid():
    assert post(b'{"text": "x", "n": NaN}') == (400, {"error": "invalid_json"})


def test_routes_in_the_request_are_validated():
    assert post(json.dumps({"text": "x", "routes": "bad"}).encode()) == (400, {"error": "invalid_routes"})
    assert post(json.dumps({"text": "x", "routes": [{"key": "A B", "origin_ar": "a", "destination_ar": "b"}]}).encode())[0] == 400
    ok = [{"key": "hebron-to-bethlehem", "origin_ar": "الخليل", "destination_ar": "بيت لحم"}]
    status, body = post(json.dumps({"text": "من الخليل الى بيت لحم", "routes": ok}, ensure_ascii=False).encode())
    assert status in (200, 422) and body["meta"]["route_hint"]["route_key"] == "hebron-to-bethlehem"


# ------------------------------------------------------------ NaN confidence
@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf"), "0.99", True, None])
def test_non_finite_or_non_numeric_confidence_is_zero(bad):
    assert llm_extractor._coerce({"confidence": bad})["confidence"] == 0.0


def test_nan_from_model_json_reaches_human_review_not_autonomous(monkeypatch):
    raw = '{"pickup_location":"أ","destination_location":"ب","vehicle_class":"Public","temporal_element":"x",' \
          '"capacity_requirements":1,"urgency_profile":"Low","confidence":NaN}'
    parsed = llm_extractor._loads_json_object(raw)
    monkeypatch.setattr(nlp_engine, "call_llm_extract", lambda text: {**llm_extractor._coerce(parsed), "_engine": "gemini"})
    result = service.analyze_text("من أ الى ب")
    assert result["routing"]["routing_target"] == "HUMAN_DISPATCHER_QUEUE_INTERFACE"
    assert result["dispatch"]["confidence"] == 0.0 and result["dispatch"]["needs_review"] is True


def test_pipeline_guards_a_custom_extractor_returning_nan():
    request_ = parse_dispatch_request("من أ الى ب", extractor=lambda t: {"confidence": float("nan")})
    assert request_.confidence == 0.0 and request_.needs_review is True


def test_decide_routing_sends_nan_to_a_human():
    routing = service.decide_routing({"urgency_profile": "Low", "confidence": float("nan"), "pickup_location": "a"})
    assert routing["routing_target"] == "HUMAN_DISPATCHER_QUEUE_INTERFACE"


# ------------------------------------------------------------ deadline
def test_budget_defaults_and_overrides(monkeypatch):
    assert provider_pool.text_budget_seconds() < provider_pool.voice_budget_seconds()
    monkeypatch.setenv("AI_SERVICES_TEXT_BUDGET_SECONDS", "7")
    monkeypatch.setenv("AI_SERVICES_VOICE_BUDGET_SECONDS", "garbage")
    assert provider_pool.text_budget_seconds() == 7.0 and provider_pool.voice_budget_seconds() == 45.0


def test_deadline_stops_failover_and_text_falls_back_to_the_heuristic(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEYS", "g1AAAAAAAAAAAAAAAA,g2AAAAAAAAAAAAAAAA,g3AAAAAAAAAAAAAAAA")
    calls = []

    def slow(url, headers, body, timeout=15.0):
        calls.append(timeout)
        time.sleep(0.4)
        return 500, b"{}"                                   # each key fails slowly

    monkeypatch.setattr(provider_pool, "http_post", slow)
    started = time.monotonic()
    result = service.analyze_text("من أ الى ب", budget_seconds=0.9)
    assert time.monotonic() - started < 2.0
    assert len(calls) < 3                                    # budget cut the key rotation short
    assert result["meta"]["engine"] == "heuristic"


def test_voice_budget_clamps_the_whisper_timeout(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-AAAAAAAAAAAAAAAAAAAA")
    seen = {}

    def fake(url, headers, body, timeout=15.0):
        seen["timeout"] = timeout
        return 200, json.dumps({"text": "بدي سيرفيس من بيت لحم للخليل"}).encode()

    monkeypatch.setattr(nlp_engine, "http_post", fake)
    wav = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 40
    service.analyze_voice(wav, "audio.wav", budget_seconds=30)
    assert seen["timeout"] == 60.0                           # transport clamps it against time_left()


def test_http_post_never_waits_longer_than_the_remaining_budget(monkeypatch):
    captured = {}

    class Resp:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b"{}"

    def fake_urlopen(req, timeout):
        captured["timeout"] = timeout
        return Resp()

    monkeypatch.setattr(provider_pool.urllib.request, "urlopen", fake_urlopen)
    with provider_pool.request_deadline(5.0):
        provider_pool.http_post("https://example.invalid", {}, b"", timeout=60.0)
    assert captured["timeout"] <= 5.0
    with provider_pool.request_deadline(0.0):
        with pytest.raises(provider_pool.ProviderError):
            provider_pool.http_post("https://example.invalid", {}, b"", timeout=60.0)


def test_deadline_exceeded_does_not_put_a_good_key_on_cooldown():
    pool = provider_pool.KeyPool("gemini", ["k1AAAAAAAAAAAAAAAA"])

    def call(_provider, _key):
        raise provider_pool.ProviderError("deadline_exceeded")

    with pytest.raises(provider_pool.AllProvidersExhausted):
        provider_pool.run_with_failover([pool], call)
    assert pool.candidates()                                  # still usable
