import { describe, expect, it, vi } from "vitest";
import { createConfig } from "../config.js";
import { createPassengerAssistantService } from "../services/passengerAssistant.js";
import { detectKnowledgeTopic } from "../services/assistantKnowledge.js";
import { parseRequest } from "../services/assistantParser.js";
import { fixturePlaceData, fixturePlaces, fixtureRoutes } from "./assistantFixtures.js";

const environment = {
  APP_ENV: "local",
  DATABASE_URL: "mysql://test:test@localhost:3306/darb_test",
  JWT_SECRET: "test-only-jwt-secret-with-at-least-thirty-two-characters",
  CORS_ORIGINS: "http://localhost:5173",
  LOG_LEVEL: "silent"
};
// 10:00 local on Wednesday 2026-10-28. No provider key: the deterministic path only, and any fetch fails the test.
const now = () => new Date("2026-10-28T08:00:00Z");
const makeService = () => {
  const fetchImpl = vi.fn();
  const service = createPassengerAssistantService(createConfig(environment), {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    contextLoader: async () => ({ passenger_requests: [] }),
    placesLoader: async () => fixturePlaceData,
    now
  });
  return { service, fetchImpl };
};
const ask = (message: string, locale: "ar" | "en" = "ar", history: Array<{ role: "user" | "assistant"; text: string }> = []) =>
  makeService().service.answer({ passengerId: "p1", locale, message, history });

describe("dialect ride sentences read by the rule parser", () => {
  const cases: Array<[string, string, string]> = [
    ["بدي سيارة من الخليل ع بيت لحم بكرا الساعة 9 الصبح", "hebron-center", "bethlehem-center"],
    ["طالع من الخليل لعند بيت لحم بكرا الساعة 10 الصبح", "hebron-center", "bethlehem-center"],
    ["ودني من البوليتكنك لبيتلحم بكرا الساعة 7 الصبح", "ppu-main-gate", "bethlehem-center"],
    ["بدنا نروح من باب الزاويه على بيت لحم اليوم الساعة 5 المسا", "bab-al-zawiya", "bethlehem-center"],
    ["I want to go from khalil to Bethlehem tomorrow at 6 pm", "hebron-center", "bethlehem-center"],
    ["ride from Hebron to beit lahem tomorrow 8am", "hebron-center", "bethlehem-center"],
    ["وصلني من الخليل لبيت لحم بعد ساعتين", "hebron-center", "bethlehem-center"],
    ["بدي اروح بيت لحم من الخليل هلق", "hebron-center", "bethlehem-center"]
  ];
  it.each(cases)("%s", (text, from, to) => {
    const intent = parseRequest(text, { now: now(), places: fixturePlaces, routes: fixtureRoutes });
    expect(intent.type).toBe("ride");
    expect(intent.pickup?.key).toBe(from);
    expect(intent.dropoff?.key).toBe(to);
  });
});

describe("small talk and app help are answered from product facts without a provider call", () => {
  const cases: Array<[string, "ar" | "en", string, RegExp]> = [
    ["مرحبا", "ar", "greeting", /مساعد درب/],
    ["هلا والله", "ar", "greeting", /مساعد درب/],
    ["hello", "en", "greeting", /Darb assistant/],
    ["شو الاخبار", "ar", "how_are_you", /تمام/],
    ["شكرا يسلمو", "ar", "thanks", /الرحب/],
    ["thank you so much", "en", "thanks", /welcome/i],
    ["كيف بلغي حجزي", "ar", "cancel", /رحلاتي/],
    ["how do I cancel my request", "en", "cancel", /My trips/],
    ["بدي الغي الطلب", "ar", "cancel", /إلغاء الطلب/],
    ["كم الاجره", "ar", "payment", /ما بتم داخل التطبيق/],
    ["how much does it cost", "en", "payment", /pay the driver directly/],
    ["وين بشوف الحواجز", "ar", "checkpoints", /الحواجز/],
    ["is the road closed, any checkpoints?", "en", "checkpoints", /Barriers/],
    ["كيف اتواصل مع الدعم", "ar", "support", /المساعدة والدعم/],
    ["I want to talk to a person, contact support", "en", "support", /Help & Support/],
    ["كيف احجز", "ar", "how_to_book", /من وين لوين/],
    ["what can you do", "en", "capabilities", /never book without your confirmation/],
    ["شو بتعرف تعمل", "ar", "capabilities", /بقدر/]
  ];
  it.each(cases)("%s", async (text, locale, topic, pattern) => {
    expect(detectKnowledgeTopic(text)?.topic).toBe(topic);
    const { service, fetchImpl } = makeService();
    const reply = await service.answer({ passengerId: "p1", locale, message: text, history: [] });
    expect(reply.status).toBe("result");
    expect(reply.message).toMatch(pattern);
    expect(reply.uncertain).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("offers a tap-to-send ride example built from a real route", async () => {
    const reply = await ask("hello", "en");
    expect(reply.suggestions[0]).toBe("From Hebron Center to Bethlehem Center");
  });

  it("does not let a greeting swallow a real ride request", async () => {
    const reply = await ask("مرحبا بدي سيارة من الخليل لبيت لحم بكرا الساعة 8 صباحا");
    expect(reply.status).toBe("request_review");
  });

  it("answers thanks after a ride was discussed, not as a continuation of it", async () => {
    const reply = await ask("شكرا", "ar", [
      { role: "user", text: "من الخليل لبيت لحم بكرا الساعة 8 صباحا" },
      { role: "assistant", text: "راجع المعلومات" }
    ]);
    expect(reply.status).toBe("result");
    expect(reply.message).toMatch(/الرحب/);
  });
});

describe("unclear requests get a specific clarifying answer, never a dead end", () => {
  it("explains what is needed, shows a real example and offers buttons (Arabic)", async () => {
    const reply = await ask("ايش رايك بالجو");
    expect(reply.status).toBe("clarification");
    expect(reply.message).toContain("من وين، لوين، ومتى");
    expect(reply.message).toContain("من وسط الخليل إلى وسط بيت لحم");
    expect(reply.suggestions).toContain("من وسط الخليل إلى وسط بيت لحم");
    expect(reply.suggestions.length).toBeGreaterThanOrEqual(2);
    expect(reply.uncertain).toEqual({ reason: "not_understood", source: "rules" });
  });

  it("explains what is needed, shows a real example and offers buttons (English)", async () => {
    const reply = await ask("blorp", "en");
    expect(reply.status).toBe("clarification");
    expect(reply.message).toContain("where from, where to and when");
    expect(reply.suggestions).toContain("From Hebron Center to Bethlehem Center");
    expect(reply.uncertain?.reason).toBe("not_understood");
  });

  it("hands off to a concrete next step on the second dead end in a row, and still logs it", async () => {
    const reply = await ask("برضو مش فاهم", "ar", [
      { role: "user", text: "ايش رايك بالجو" },
      { role: "assistant", text: "ما فهمت طلبك تماماً" }
    ]);
    expect(reply.status).toBe("clarification");
    expect(reply.message).toContain("المساعدة والدعم");
    expect(reply.uncertain?.reason).toBe("not_understood");
  });

  it("says what it understood when only the destination is missing", async () => {
    const reply = await ask("بدي سيارة من الخليل بكرا الساعة 8 صباحا");
    expect(reply.status).toBe("clarification");
    expect(reply.message).toContain("فهمت: من وسط الخليل");
    expect(reply.message).toContain("إلى أين");
    expect(reply.suggestions.length).toBeGreaterThan(0);
  });

  it("says what it understood when only the time is missing, with time suggestions", async () => {
    const reply = await ask("ride from Hebron to Bethlehem", "en");
    expect(reply.message).toContain("So far: from Hebron Center to Bethlehem Center");
    expect(reply.message).toContain("When would you like to leave");
    expect(reply.suggestions).toContain("In an hour");
    expect(reply.uncertain).toBeUndefined();
  });

  it("suggests routes that exist when the requested pair has no route", async () => {
    const reply = await ask("from Bethlehem to Hebron tomorrow at 8 am", "en");
    expect(reply.status).toBe("clarification");
    expect(reply.message).toContain("no route");
    expect(reply.suggestions.length).toBeGreaterThan(0);
  });

  it("names a real example when the place is not served", async () => {
    const reply = await ask("بدي سيارة من الخليل لنابلس بكرا الساعة 8 صباحا");
    expect(reply.status).toBe("clarification");
    expect(reply.message).toContain("غير مدعوم");
    expect(reply.message).toContain("جرّب مثلاً");
  });
});

describe("the stops and routes are reused between messages", () => {
  it("loads places once inside the cache window", async () => {
    const placesLoader = vi.fn(async () => fixturePlaceData);
    const service = createPassengerAssistantService(createConfig(environment), {
      fetchImpl: vi.fn() as unknown as typeof fetch,
      contextLoader: async () => ({}),
      placesLoader,
      now
    });
    await service.answer({ passengerId: "p1", locale: "en", message: "hello", history: [] });
    await service.answer({ passengerId: "p1", locale: "en", message: "thanks", history: [] });
    expect(placesLoader).toHaveBeenCalledTimes(1);
  });
});
