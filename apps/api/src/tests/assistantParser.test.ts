import { describe, expect, it } from "vitest";
import {
  buildClarification,
  normalizeText,
  parseRequest,
  CONFIDENCE_PREFILL,
  type AssistantPlace,
  type ParseContext
} from "../services/assistantParser.js";
import { fixturePlaces, fixtureRoutes } from "./assistantFixtures.js";

const places = fixturePlaces;
const routes = fixtureRoutes;
// 10:00 local on Wednesday 2026-10-28.
const now = new Date("2026-10-28T08:00:00Z");
const ctx = (extra: Partial<ParseContext> = {}): ParseContext => ({ now, places, routes, ...extra });
const localTime = (iso: string | null) => iso?.slice(0, 16);

describe("normalizeText", () => {
  it("folds alef/ya/ta-marbuta, diacritics, digits and the article", () => {
    expect(normalizeText("الخَلِيل")).toBe("خليل");
    expect(normalizeText("إلى")).toBe("الي");
    expect(normalizeText("الساعة ٣:٣٠")).toBe("ساعه 3:30");
    expect(normalizeText("Bab Al-Zawiya")).toBe("bab zawiya");
  });
});

describe("parseRequest: Palestinian dialect and English rides", () => {
  const rides: Array<[string, string, string, string | null, number]> = [
    ["بدي أروح من الخليل لبيت لحم بكرا الساعة 8 الصبح لشخصين", "hebron-center", "bethlehem-center", "2026-10-29T08:00", 2],
    ["بدي سيارة من باب الزاوية إلى بيت لحم اليوم الساعة 3 العصر", "bab-al-zawiya", "bethlehem-center", "2026-10-28T15:00", 1],
    ["وصلني من البوليتكنك لبيت لحم بعد ساعة", "ppu-main-gate", "bethlehem-center", "2026-10-28T11:00", 1],
    ["I need a ride from Hebron to Bethlehem tomorrow at 3pm for 2 people", "hebron-center", "bethlehem-center", "2026-10-29T15:00", 2],
    ["ride from PPU to Bethlehem at 4:30 pm", "ppu-main-gate", "bethlehem-center", "2026-10-28T16:30", 1],
    ["بدي اروح على بيت لحم من باب الزاويه الساعة اربعة ونص العصر", "bab-al-zawiya", "bethlehem-center", "2026-10-28T16:30", 1],
    ["من بوابة الجامعة الى بيت لحم بكرا ١٠ صباحا", "ppu-main-gate", "bethlehem-center", "2026-10-29T10:00", 1],
    ["take me to Bethlehem from Bab Al Zawiya tomorrow 7 am alone", "bab-al-zawiya", "bethlehem-center", "2026-10-29T07:00", 1],
    ["بدنا نروح من الخليل ع بيت لحم بعد بكرا الساعة 9 الصبح 3 اشخاص", "hebron-center", "bethlehem-center", "2026-10-30T09:00", 3],
    ["بدي سيارة من باب الزاوبه لبيت لحم بكرا الساعة 8 صباحا", "bab-al-zawiya", "bethlehem-center", "2026-10-29T08:00", 1]
  ];

  it.each(rides)("reads %s", (text, pickup, dropoff, time, seats) => {
    const intent = parseRequest(text, ctx());
    expect(intent.type).toBe("ride");
    expect(intent.pickup?.key).toBe(pickup);
    expect(intent.dropoff?.key).toBe(dropoff);
    expect(localTime(intent.time)).toBe(time);
    expect(intent.seats).toBe(seats);
    expect(intent.confidence).toBeGreaterThanOrEqual(CONFIDENCE_PREFILL);
    expect(intent.time).toMatch(/[+-]\d{2}:\d{2}$/);
    expect(intent.source).toBe("rules");
  });

  it("is driven by the supplied stops, not built-in places", () => {
    const custom: AssistantPlace[] = [
      { key: "a", name_ar: "حلحول", name_en: "Halhul" },
      { key: "b", name_ar: "يطا", name_en: "Yatta" }
    ];
    const intent = parseRequest("بدي اروح من حلحول ليطا الساعة 5 مساء", { now, places: custom });
    expect([intent.pickup?.key, intent.dropoff?.key]).toEqual(["a", "b"]);
    const none = parseRequest("بدي اروح من الخليل لبيت لحم الساعة 5 مساء", { now, places: custom });
    expect(none.pickup).toBeNull();
    expect(none.confidence).toBeLessThan(CONFIDENCE_PREFILL);
  });

  it("keeps a lone place low confidence and asks", () => {
    const intent = parseRequest("بيت لحم", ctx());
    expect(intent.dropoff?.key).toBe("bethlehem-center");
    expect(intent.confidence).toBeLessThan(CONFIDENCE_PREFILL);
  });

  it("fills the missing slot from the previous turn", () => {
    const intent = parseRequest("بيت لحم", ctx({ priorTurns: ["بدي سيارة من الخليل بكرا الساعة 9 الصبح"] }));
    expect(intent.type).toBe("ride");
    expect(intent.pickup?.key).toBe("hebron-center");
    expect(intent.dropoff?.key).toBe("bethlehem-center");
    expect(intent.missing).toEqual([]);
    expect(intent.confidence).toBeGreaterThanOrEqual(CONFIDENCE_PREFILL);
  });

  it("lets a later correction override the earlier pickup", () => {
    const intent = parseRequest("لا من باب الزاوية", ctx({ priorTurns: ["من الخليل لبيت لحم بكرا الساعة 8 صباحا"] }));
    expect(intent.pickup?.key).toBe("bab-al-zawiya");
    expect(intent.dropoff?.key).toBe("bethlehem-center");
  });

  it("flags a pair no route serves in that direction", () => {
    const intent = parseRequest("من بيت لحم إلى الخليل بكرا الساعة 8 صباحا", ctx());
    expect(intent.missing).toContain("route");
    expect(intent.confidence).toBeLessThan(CONFIDENCE_PREFILL);
    const clarification = buildClarification(intent, ctx(), "en");
    expect(clarification.reason).toBe("route_mismatch");
  });

  it("flags too many seats", () => {
    const intent = parseRequest("ride from Hebron to Bethlehem tomorrow at 8 am for 6 people", ctx());
    expect(intent.seats).toBe(6);
    expect(intent.missing).toContain("seats");
  });

  it("reports a known city that no stop serves", () => {
    const intent = parseRequest("بدي اروح لنابلس", ctx());
    expect(intent.unsupported_place).toBe(true);
    expect(buildClarification(intent, ctx(), "ar").reason).toBe("unsupported_place");
  });

  it("is deterministic and never reads the clock", () => {
    const a = parseRequest("ride from Hebron to PPU in 2 hours", ctx());
    const b = parseRequest("ride from Hebron to PPU in 2 hours", ctx());
    expect(a).toEqual(b);
    expect(localTime(a.time)).toBe("2026-10-28T12:00");
  });
});

describe("parseRequest: parcels and unknown", () => {
  it("returns a parcel intent with a size and no seats", () => {
    const intent = parseRequest("بدي ابعت طرد صغير من الخليل لبيت لحم بكرا", ctx());
    expect(intent.type).toBe("parcel");
    expect(intent.size).toBe("small");
    expect(intent.seats).toBeNull();
    expect(intent.pickup?.key).toBe("hebron-center");
    expect(intent.dropoff?.key).toBe("bethlehem-center");
    const english = parseRequest("send a large package from PPU to Bethlehem", ctx());
    expect(english.type).toBe("parcel");
    expect(english.size).toBe("large");
  });

  it("treats questions and noise as unknown", () => {
    expect(parseRequest("هل رحلتي بكرا مؤكدة؟", ctx()).type).toBe("unknown");
    expect(parseRequest("hello", ctx()).type).toBe("unknown");
    expect(parseRequest("", ctx()).confidence).toBe(0);
  });
});

describe("buildClarification", () => {
  it("asks for the missing field in both languages with route-aware suggestions", () => {
    const intent = parseRequest("بدي سيارة من الخليل بكرا الساعة 8 صباحا", ctx());
    const ar = buildClarification(intent, ctx(), "ar");
    const en = buildClarification(intent, ctx(), "en");
    expect(ar.reason).toBe("missing_dropoff");
    expect(ar.message).toContain("إلى أين");
    expect(en.message).toContain("Where would you like to go");
    // Hebron Center can only reach stops that follow it and allow drop-off.
    expect(en.suggestions).toEqual(["Bab Al-Zawiya", "PPU Main Gate", "Bethlehem Center"]);
  });

  it("says so when there are no routes at all", () => {
    const intent = parseRequest("hello", { now, places: [] });
    expect(buildClarification(intent, { places: [] }, "en").reason).toBe("no_places");
  });
});
