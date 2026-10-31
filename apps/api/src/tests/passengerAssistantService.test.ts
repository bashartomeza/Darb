import { describe, expect, it, vi } from "vitest";
import { createConfig } from "../config.js";
import { createPassengerAssistantService } from "../services/passengerAssistant.js";
import { fixturePlaceData } from "./assistantFixtures.js";

const environment = {
  APP_ENV: "local",
  DATABASE_URL: "mysql://test:test@localhost:3306/masari_test",
  JWT_SECRET: "test-only-jwt-secret-with-at-least-thirty-two-characters",
  CORS_ORIGINS: "http://localhost:5173",
  LOG_LEVEL: "silent",
  XAI_API_KEY: "xai-test-key-that-is-long-enough",
  XAI_MODEL: "grok-4.6",
  XAI_TIMEOUT_MS: "5000",
  ASSISTANT_PROVIDER: "xai"
};
const groqEnvironment = {
  ...environment,
  ASSISTANT_PROVIDER: "groq",
  GROQ_API_KEY: "gsk_test_key_that_is_long_enough",
  GROQ_MODEL: "openai/gpt-oss-20b"
};
const noKeyEnvironment = { ...environment, XAI_API_KEY: undefined };

// 10:00 local on 2026-10-28; the provider is always a mock (no network).
const now = () => new Date("2026-10-28T08:00:00Z");
const base = {
  contextLoader: async () => ({ passenger_requests: [] }),
  placesLoader: async () => fixturePlaceData,
  now
};

const intent = (overrides: Record<string, unknown> = {}) => ({
  type: "ride",
  pickup_key: "hebron-center",
  dropoff_key: "bethlehem-center",
  preferred_time: "2026-10-29T08:00:00+02:00",
  passenger_count: 1,
  parcel_size: "none",
  confidence: 0.95,
  ...overrides
});
const providerBody = (status: string, message: string, intentValue?: unknown, suggestions: string[] = []) => ({
  status, message, suggestions, ...(intentValue ? { intent: intentValue } : {})
});
const xaiResponse = (value: unknown) =>
  new Response(JSON.stringify({ output_text: JSON.stringify(value) }), { status: 200 });
const groqResponse = (value: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: JSON.stringify(value) } }] }), { status: 200 });

const ask = (service: ReturnType<typeof createPassengerAssistantService>, message: string, extra = {}) =>
  service.answer({ passengerId: "passenger_1", locale: "en", message, history: [], ...extra });

describe("provider path (mocked)", () => {
  it("returns a validated, prefilled request with coordinates from the real stop", async () => {
    const service = createPassengerAssistantService(createConfig(environment), {
      ...base,
      fetchImpl: (async () => xaiResponse(providerBody("request_review", "Review your ride", intent()))) as typeof fetch
    });
    const reply = await ask(service, "ride from Hebron to Bethlehem tomorrow at 8 am");
    expect(reply.status).toBe("request_review");
    expect(reply.request).toMatchObject({
      pickupKey: "hebron-center",
      pickupLabel: "Hebron Center",
      destinationKey: "bethlehem-center",
      destinationLabel: "Bethlehem Center",
      preferredTime: "2026-10-29T08:00:00+02:00",
      passengerCount: 1,
      pickupLat: 31.53,
      destinationLng: 35.2024
    });
    expect(reply.intent).toMatchObject({ type: "ride", source: "provider", confidence: 0.95 });
    expect(reply.uncertain).toBeUndefined();
    expect(reply.degraded).toBeUndefined();
  });

  it("sends the real stops and routes, never the passenger id", async () => {
    const fetchImpl = vi.fn(async () => xaiResponse(providerBody("result", "No confirmed trip tomorrow.")));
    const service = createPassengerAssistantService(createConfig(environment), { ...base, fetchImpl: fetchImpl as unknown as typeof fetch });
    const reply = await ask(service, "is my trip tomorrow confirmed?");
    expect(reply).toEqual({ status: "result", message: "No confirmed trip tomorrow.", suggestions: [] });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.x.ai/v1/responses");
    const body = JSON.parse(String(init.body));
    expect(body.text.format.strict).toBe(true);
    expect(body.input[1].content).toContain("bethlehem-center");
    expect(body.input[1].content).toContain("وسط بيت لحم");
    expect(body.input[1].content).not.toContain("passenger_1");
  });

  it("asks and queues when the provider is not confident", async () => {
    const service = createPassengerAssistantService(createConfig(environment), {
      ...base,
      fetchImpl: (async () => xaiResponse(providerBody("request_review", "ok", intent({ confidence: 0.4 })))) as typeof fetch
    });
    const reply = await ask(service, "maybe Hebron to Bethlehem sometime tomorrow at 8 am");
    expect(reply.status).toBe("clarification");
    expect(reply.uncertain).toEqual({ reason: "low_confidence", source: "provider" });
    expect(reply.request).toBeUndefined();
  });

  it("asks instead of prefilling when the provider and the rules disagree on a place", async () => {
    const service = createPassengerAssistantService(createConfig(environment), {
      ...base,
      fetchImpl: (async () => xaiResponse(providerBody("request_review", "ok", intent({ pickup_key: "ppu-main-gate" })))) as typeof fetch
    });
    const reply = await ask(service, "ride from Hebron to Bethlehem tomorrow at 8 am");
    expect(reply.status).toBe("clarification");
    expect(reply.uncertain?.source).toBe("provider");
  });

  it("returns a parcel intent without creating anything", async () => {
    const service = createPassengerAssistantService(createConfig(environment), {
      ...base,
      fetchImpl: (async () => xaiResponse(providerBody("result", "parcel", intent({ type: "parcel", passenger_count: 0, parcel_size: "small" })))) as typeof fetch
    });
    const reply = await ask(service, "send a small parcel from Hebron to Bethlehem");
    expect(reply.status).toBe("result");
    expect(reply.intent).toMatchObject({ type: "parcel", size: "small", seats: null });
    expect(reply.request).toBeUndefined();
  });

  it("asks for a new time when the provider returns a past departure (en/ar)", async () => {
    for (const locale of ["en", "ar"] as const) {
      const service = createPassengerAssistantService(createConfig(environment), {
        ...base,
        now: () => new Date("2026-10-28T14:00:00Z"),
        fetchImpl: (async () => xaiResponse(providerBody("request_review", "Review", intent({ preferred_time: "2026-10-28T15:00:00+03:00" })))) as typeof fetch
      });
      const reply = await ask(service, "ride from Hebron to Bethlehem today at 3 PM", { locale });
      expect(reply.status).toBe("clarification");
      expect(reply.message).toContain(locale === "ar" ? "الوقت المطلوب مضى" : "already passed");
      expect(reply.uncertain).toBeUndefined();
    }
  });

  it("preserves the requested wall-clock hour when the provider shifts it", async () => {
    const service = createPassengerAssistantService(createConfig(groqEnvironment), {
      ...base,
      fetchImpl: (async () => groqResponse(providerBody("request_review", "ok", intent({ preferred_time: "2026-10-29T12:00:00+00:00" })))) as typeof fetch
    });
    const reply = await ask(service, "ابحث لي من الخليل إلى بيت لحم بكرا الساعة 3 مساءً لشخص", { locale: "ar" });
    expect(reply.request?.preferredTime).toBe("2026-10-29T15:00:00+02:00");
    expect(reply.request?.pickupLabel).toBe("وسط الخليل");
  });
});

describe("fallback when the provider cannot be used", () => {
  const sentence = "بدي أروح من الخليل لبيت لحم بكرا الساعة 8 الصبح لشخصين";
  const expectFallbackRide = (reply: Awaited<ReturnType<typeof ask>>) => {
    expect(reply.status).toBe("request_review");
    expect(reply.request).toMatchObject({
      pickupKey: "hebron-center",
      destinationKey: "bethlehem-center",
      preferredTime: "2026-10-29T08:00:00+02:00",
      passengerCount: 2
    });
    expect(reply.intent?.source).toBe("rules");
  };

  it("works with no AI key configured", async () => {
    const fetchImpl = vi.fn();
    const service = createPassengerAssistantService(createConfig(noKeyEnvironment), { ...base, fetchImpl: fetchImpl as unknown as typeof fetch });
    const reply = await ask(service, sentence, { locale: "ar" });
    expectFallbackRide(reply);
    expect(reply.degraded).toBe("unavailable");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["an upstream error", async () => new Response("{}", { status: 500 }), "upstream"],
    ["a network failure", async () => { throw new TypeError("fetch failed"); }, "upstream"],
    ["a timeout", async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }, "timeout"],
    ["invalid JSON", async () => new Response(JSON.stringify({ output_text: "not json" }), { status: 200 }), "upstream"],
    ["a schema violation", async () => xaiResponse({ status: "result", message: "no structure" , extra: true }), "upstream"]
  ])("falls back to the rule parser after %s", async (_name, fetchImpl, category) => {
    const service = createPassengerAssistantService(createConfig(environment), { ...base, fetchImpl: fetchImpl as unknown as typeof fetch });
    const reply = await ask(service, sentence, { locale: "ar" });
    expectFallbackRide(reply);
    expect(reply.degraded).toBe(category);
  });

  it("falls back when the provider invents a place that is not a stop", async () => {
    const service = createPassengerAssistantService(createConfig(environment), {
      ...base,
      fetchImpl: (async () => xaiResponse(providerBody("request_review", "ok", intent({ pickup_key: "made-up" })))) as typeof fetch
    });
    const reply = await ask(service, sentence, { locale: "ar" });
    expectFallbackRide(reply);
    expect(reply.degraded).toBe("invalid");
  });

  it("asks, and queues, when the fallback cannot read the request", async () => {
    const service = createPassengerAssistantService(createConfig(noKeyEnvironment), { ...base, fetchImpl: vi.fn() as unknown as typeof fetch });
    const reply = await ask(service, "shu akhbarak", { locale: "en" });
    expect(reply.status).toBe("clarification");
    expect(reply.uncertain).toEqual({ reason: "not_understood", source: "rules" });
    expect(reply.intent?.type).toBe("unknown");
  });

  it("asks for one missing detail without queueing a confident reading", async () => {
    const service = createPassengerAssistantService(createConfig(noKeyEnvironment), { ...base, fetchImpl: vi.fn() as unknown as typeof fetch });
    const reply = await ask(service, "I need a ride from Hebron to Bethlehem", { locale: "en" });
    expect(reply.status).toBe("clarification");
    expect(reply.message).toContain("When would you like to leave");
    expect(reply.uncertain).toBeUndefined();
  });

  it("stops repeating destination questions for an unsupported city, without the provider", async () => {
    const fetchImpl = vi.fn();
    const contextLoader = vi.fn();
    const service = createPassengerAssistantService(createConfig(environment), {
      ...base,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      contextLoader
    });
    const reply = await ask(service, "نابلس", { locale: "ar", history: [{ role: "assistant", text: "ما هي الوجهة المطلوبة؟" }] });
    expect(reply.status).toBe("clarification");
    expect(reply.message).toContain("غير مدعوم");
    expect(reply.message).toContain("وسط بيت لحم");
    expect(reply.uncertain?.reason).toBe("unsupported_place");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(contextLoader).not.toHaveBeenCalled();
  });

  it("returns a parcel intent from the rules alone", async () => {
    const service = createPassengerAssistantService(createConfig(noKeyEnvironment), { ...base, fetchImpl: vi.fn() as unknown as typeof fetch });
    const reply = await ask(service, "send a large package from PPU to Bethlehem tomorrow");
    expect(reply.status).toBe("result");
    expect(reply.intent).toMatchObject({ type: "parcel", size: "large" });
    expect(reply.message).toContain("isn't available yet");
  });
});

describe("provider request shapes", () => {
  it("uses Gemini structured output without exposing the key in the URL", async () => {
    let requestUrl: string | URL | Request | undefined;
    let requestInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requestUrl = url;
      requestInit = init;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(providerBody("clarification", "Which day?", undefined, ["Today", "Tomorrow"])) }] } }]
      }), { status: 200 });
    });
    const service = createPassengerAssistantService(createConfig({
      ...environment,
      ASSISTANT_PROVIDER: "gemini",
      GEMINI_API_KEY: "gemini-test-key-that-is-long-enough",
      GEMINI_MODEL: "gemini-2.5-flash-lite"
    }), { ...base, fetchImpl: fetchImpl as unknown as typeof fetch });
    const reply = await ask(service, "when is my trip?");
    expect(reply.status).toBe("clarification");
    expect(reply.message).toBe("Which day?");
    expect(reply.uncertain?.source).toBe("provider");
    expect(String(requestUrl)).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent");
    expect(String(requestUrl)).not.toContain("gemini-test-key");
    expect(requestInit?.headers).toEqual(expect.objectContaining({ "x-goog-api-key": "gemini-test-key-that-is-long-enough" }));
    const body = JSON.parse(String(requestInit?.body));
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseJsonSchema.required).toEqual(["status", "message", "suggestions", "intent"]);
  });

  it("uses strict structured output with Groq", async () => {
    let requestInit: RequestInit | undefined;
    let requestUrl: string | URL | Request | undefined;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requestUrl = url;
      requestInit = init;
      return groqResponse(providerBody("result", "No confirmed trip right now."));
    });
    const service = createPassengerAssistantService(createConfig(groqEnvironment), { ...base, fetchImpl: fetchImpl as unknown as typeof fetch });
    const reply = await ask(service, "do I have a trip?");
    expect(reply.status).toBe("result");
    expect(requestUrl).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(requestInit?.headers).toEqual(expect.objectContaining({ Authorization: "Bearer gsk_test_key_that_is_long_enough" }));
    const body = JSON.parse(String(requestInit?.body));
    expect(body.model).toBe("openai/gpt-oss-20b");
    expect(body.response_format).toEqual(expect.objectContaining({
      type: "json_schema",
      json_schema: expect.objectContaining({ strict: true })
    }));
  });
});
