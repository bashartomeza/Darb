import pytest

from ai_services import provider_pool


@pytest.fixture(autouse=True)
def clean_env(monkeypatch, tmp_path):
    for var in ("GEMINI_API_KEY", "GEMINI_API_KEYS", "GROQ_API_KEY", "GROQ_API_KEYS",
                "OPENAI_API_KEY", "OPENAI_API_KEYS", "AI_SERVICES_SHARED_SECRET",
                "AI_SERVICES_EMERGENCY_NUMBERS"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("AI_SERVICES_LANDMARK_CACHE", str(tmp_path / "landmarks.json"))
    provider_pool.reset_pool_cache()
    yield
    provider_pool.reset_pool_cache()
