import { describe, expect, it } from "vitest";
import { createParser, normalizeRealResult } from "./adapters.js";
import { buildReport, compareCase, summarizeCase } from "./score.js";
import { loadDataset, runEval } from "./run.js";

const dataset = loadDataset();
const stopIds = new Set(dataset.stops.map((s) => s.id));

describe("ai eval dataset", () => {
  it("has at least 150 uniquely-identified cases covering the hard categories", () => {
    expect(dataset.cases.length).toBeGreaterThanOrEqual(150);
    expect(new Set(dataset.cases.map((c) => c.id)).size).toBe(dataset.cases.length);
    const cats = new Set(dataset.cases.map((c) => c.category));
    for (const c of ["typo", "missing_dest", "ambiguous", "negation", "multi_intent", "non_request", "arabizi", "english", "mixed", "parcel"]) {
      expect(cats.has(c)).toBe(true);
    }
  });

  it("labels only real stop ids or the documented sentinels", () => {
    for (const c of dataset.cases) {
      for (const p of [c.expected.pickup, c.expected.dropoff]) {
        if (p !== null && p !== "ambiguous" && p !== "unsupported") expect(stopIds.has(p)).toBe(true);
      }
      if (c.expected.type === "unknown") expect(c.expected).toMatchObject({ pickup: null, dropoff: null, time: null, seats: null, size: null });
      if (c.expected.type === "ride") expect(c.expected.size).toBeNull();
      if (c.expected.type === "parcel") expect(c.expected.seats).toBeNull();
    }
  });
});

describe("ai eval scoring", () => {
  it("scores fields and categories", () => {
    const [a, b] = dataset.cases;
    const wrong = { ...b.expected, dropoff: "nope" };
    expect(compareCase(b.expected, wrong)).toEqual(["dropoff"]);
    const report = buildReport([summarizeCase(a, a.expected), summarizeCase(b, wrong)]);
    expect(report.overallAccuracy).toBe(0.5);
    expect(report.fieldAccuracy.dropoff).toBe(0.5);
    expect(report.fieldAccuracy.type).toBe(1);
  });

  it("an oracle parser scores 100% and a parser that throws scores 0%", () => {
    expect(buildReport(dataset.cases.map((c) => summarizeCase(c, c.expected))).overallAccuracy).toBe(1);
    expect(buildReport(dataset.cases.map((c) => summarizeCase(c, c.expected, "boom"))).overallAccuracy).toBe(0);
  });

  it("baseline parser stays above a regression floor", async () => {
    const report = await runEval({ parser: "baseline" });
    expect(report.total).toBe(dataset.cases.length);
    expect(report.overallAccuracy).toBeGreaterThan(0.6);
  });
});

describe("ai eval adapters", () => {
  it("normalizes varied real-parser result shapes", () => {
    expect(
      normalizeRealResult({ request: { intent: "ride", pickup: { stopId: "demo-bab-al-zawiya" }, destination: "demo-bethlehem-center", seatCount: 2, when: "07:00" } })
    ).toEqual({ type: "ride", pickup: "demo-bab-al-zawiya", dropoff: "demo-bethlehem-center", time: "07:00", seats: 2, size: null });
  });

  it("refuses live providers without opt-in or in CI", async () => {
    await expect(createParser("groq", {})).rejects.toThrow(/AI_EVAL_LIVE=1/);
    await expect(createParser("gemini", { AI_EVAL_LIVE: "1", CI: "true" })).rejects.toThrow(/CI/);
    await expect(createParser("real", {})).rejects.toThrow(/AI_EVAL_PARSER_MODULE/);
  });
});
