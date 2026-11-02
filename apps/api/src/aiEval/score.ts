import { SCORED_FIELDS, type EvalCase, type NormalizedParse, type ScoredField } from "./types.js";

export type CaseResult = {
  id: string;
  category: string;
  text: string;
  expected: NormalizedParse;
  actual: NormalizedParse;
  failedFields: ScoredField[];
  error?: string;
};

export type CategoryRow = { category: string; total: number; passed: number; failedByField: Record<ScoredField, number> };

export type EvalReport = {
  total: number;
  passed: number;
  overallAccuracy: number;
  fieldAccuracy: Record<ScoredField, number>;
  /** Micro-average over every (case, field) pair. */
  fieldMicroAverage: number;
  categories: CategoryRow[];
  typeConfusion: Record<string, Record<string, number>>;
  failures: CaseResult[];
};

const blank = (): NormalizedParse => ({ type: "unknown", pickup: null, dropoff: null, time: null, seats: null, size: null });

/** Coerce arbitrary parser output into the scored shape; anything unusable becomes an empty "unknown" parse. */
export function coerceParse(value: unknown): NormalizedParse {
  const v = (value ?? {}) as Record<string, unknown>;
  const type = v.type === "ride" || v.type === "parcel" ? v.type : "unknown";
  const str = (x: unknown) => (typeof x === "string" && x.trim() !== "" ? x.trim() : null);
  const size = v.size === "small" || v.size === "medium" || v.size === "large" ? v.size : null;
  return {
    ...blank(),
    type,
    pickup: str(v.pickup),
    dropoff: str(v.dropoff),
    time: str(v.time),
    seats: typeof v.seats === "number" && Number.isFinite(v.seats) ? v.seats : null,
    size
  };
}

export function compareCase(expected: NormalizedParse, actual: NormalizedParse): ScoredField[] {
  return SCORED_FIELDS.filter((f) => expected[f] !== actual[f]);
}

export function buildReport(results: CaseResult[]): EvalReport {
  const total = results.length;
  const passed = results.filter((r) => r.failedFields.length === 0 && !r.error).length;
  const fieldAccuracy = Object.fromEntries(
    SCORED_FIELDS.map((f) => [f, total === 0 ? 0 : results.filter((r) => !r.failedFields.includes(f)).length / total])
  ) as Record<ScoredField, number>;
  const fieldMicroAverage = total === 0 ? 0 : results.reduce((n, r) => n + (SCORED_FIELDS.length - r.failedFields.length), 0) / (total * SCORED_FIELDS.length);

  const byCat = new Map<string, CategoryRow>();
  const typeConfusion: Record<string, Record<string, number>> = {};
  for (const r of results) {
    let row = byCat.get(r.category);
    if (!row) {
      row = { category: r.category, total: 0, passed: 0, failedByField: Object.fromEntries(SCORED_FIELDS.map((f) => [f, 0])) as Record<ScoredField, number> };
      byCat.set(r.category, row);
    }
    row.total += 1;
    if (r.failedFields.length === 0 && !r.error) row.passed += 1;
    for (const f of r.failedFields) row.failedByField[f] += 1;
    typeConfusion[r.expected.type] ??= {};
    typeConfusion[r.expected.type][r.actual.type] = (typeConfusion[r.expected.type][r.actual.type] ?? 0) + 1;
  }
  return {
    total,
    passed,
    overallAccuracy: total === 0 ? 0 : passed / total,
    fieldAccuracy,
    fieldMicroAverage,
    categories: [...byCat.values()].sort((a, b) => a.category.localeCompare(b.category)),
    typeConfusion,
    failures: results.filter((r) => r.failedFields.length > 0 || r.error)
  };
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function formatReport(report: EvalReport, opts: { parserName: string; threshold: number; showFailures: number }): string {
  const lines: string[] = [];
  lines.push(`Parser: ${opts.parserName}   cases: ${report.total}`);
  lines.push(`Overall (all fields correct): ${report.passed}/${report.total} = ${pct(report.overallAccuracy)}   threshold ${pct(opts.threshold)}`);
  lines.push(`Field micro-average: ${pct(report.fieldMicroAverage)}`);
  lines.push("", "Per-field accuracy");
  for (const f of SCORED_FIELDS) lines.push(`  ${f.padEnd(8)} ${pct(report.fieldAccuracy[f]).padStart(7)}`);
  lines.push("", "Failures by category (columns = failing field counts)");
  lines.push(["category".padEnd(15), "n".padStart(4), "pass".padStart(5), "acc".padStart(7), ...SCORED_FIELDS.map((f) => f.padStart(8))].join(" "));
  for (const c of report.categories) {
    lines.push([c.category.padEnd(15), String(c.total).padStart(4), String(c.passed).padStart(5), pct(c.passed / c.total).padStart(7), ...SCORED_FIELDS.map((f) => String(c.failedByField[f]).padStart(8))].join(" "));
  }
  const types = ["ride", "parcel", "unknown"];
  lines.push("", "Type confusion (rows expected, columns predicted)");
  lines.push(["".padEnd(10), ...types.map((t) => t.padStart(8))].join(" "));
  for (const e of types) lines.push([e.padEnd(10), ...types.map((a) => String(report.typeConfusion[e]?.[a] ?? 0).padStart(8))].join(" "));
  if (opts.showFailures > 0 && report.failures.length > 0) {
    lines.push("", `First ${Math.min(opts.showFailures, report.failures.length)} failures`);
    for (const f of report.failures.slice(0, opts.showFailures)) {
      lines.push(`  ${f.id} [${f.category}] ${JSON.stringify(f.text)} wrong: ${f.failedFields.join(",") || "-"}${f.error ? ` error: ${f.error}` : ""}`);
    }
  }
  return lines.join("\n");
}

export function summarizeCase(c: EvalCase, actual: NormalizedParse, error?: string): CaseResult {
  return { id: c.id, category: c.category, text: c.text, expected: c.expected, actual, failedFields: error ? [...SCORED_FIELDS] : compareCase(c.expected, actual), error };
}
