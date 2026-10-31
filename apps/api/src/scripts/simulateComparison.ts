import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { METHOD_KEYS, runComparisonSimulation, type MethodMetrics, type SimParams } from "../services/matchingComparison.js";

// Usage: npm run simulate:compare -w @masari/api -- [--seed=N] [--delay=MIN] [--out=path.json]
const args = new Map(
  process.argv.slice(2).map((argument) => {
    const [key, value = "true"] = argument.replace(/^--/, "").split("=", 2);
    return [key, value];
  })
);

const overrides: Partial<SimParams> = {};
if (args.has("seed")) {
  const seed = Number(args.get("seed"));
  if (!Number.isInteger(seed) || seed < 0) throw new Error("seed_must_be_a_non_negative_integer");
  overrides.seed = seed;
}
if (args.has("delay")) {
  const delay = Number(args.get("delay"));
  if (!(delay > 0)) throw new Error("delay_must_be_positive_minutes");
  overrides.manualResponseDelayMin = delay;
}

const result = runComparisonSimulation(overrides);
const out = resolve(args.get("out") ?? "comparison-simulation.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(result, null, 2)}
`);

const labels: Record<string, string> = { manual: "Manual (WhatsApp)", nearest: "Nearest driver", masari: "Masari" };
const columns: Array<[string, (m: MethodMetrics) => string]> = [
  ["wait avg", (m) => m.waitingMin.avg.toFixed(1)],
  ["wait p50", (m) => m.waitingMin.median.toFixed(1)],
  ["wait p90", (m) => m.waitingMin.p90.toFixed(1)],
  ["match avg", (m) => m.matchingMin.avg.toFixed(1)],
  ["extra km", (m) => m.routeDeviationKm.toFixed(1)],
  ["seat %", (m) => m.seatUtilisationPct.toFixed(1)],
  ["vehicle %", (m) => m.vehicleUtilisationPct.toFixed(1)],
  ["unmatched %", (m) => m.unmatchedPct.toFixed(1)]
];

function printTable(title: string, rows: Record<string, MethodMetrics>) {
  console.log(`
${title}`);
  console.table(
    Object.fromEntries(
      METHOD_KEYS.map((key) => [labels[key], Object.fromEntries(columns.map(([name, read]) => [name, read(rows[key]!)]))])
    )
  );
}

console.log(`SIMULATED comparison (seed ${result.params.seed}, manual reply delay ${result.params.manualResponseDelayMin} min). Not real trips.`);
printTable("All scenarios (pooled)", result.aggregate);
for (const scenario of result.scenarios) printTable(`${scenario.label} (${scenario.requests} requests, ${scenario.drivers} drivers)`, scenario.methods);
console.log(`
JSON written to ${out}`);
