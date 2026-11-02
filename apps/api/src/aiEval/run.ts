import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createParser, PARSER_NAMES, type ParserName } from "./adapters.js";
import { buildReport, coerceParse, formatReport, summarizeCase, type CaseResult } from "./score.js";
import type { EvalDataset, ParseContext } from "./types.js";

export function loadDataset(file = new URL("./dataset.json", import.meta.url)): EvalDataset {
  return JSON.parse(readFileSync(file, "utf8")) as EvalDataset;
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv) {
  const opts = {
    parser: (env.AI_EVAL_PARSER ?? "baseline") as string,
    threshold: Number(env.AI_EVAL_THRESHOLD ?? 85),
    failures: 15,
    category: undefined as string | undefined
  };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split("=");
    const val = () => inline ?? argv[++i];
    if (flag === "--parser") opts.parser = val();
    else if (flag === "--threshold") opts.threshold = Number(val());
    else if (flag === "--failures") opts.failures = Number(val());
    else if (flag === "--category") opts.category = val();
    else throw new Error(`Unknown argument ${flag}`);
  }
  if (!(PARSER_NAMES as readonly string[]).includes(opts.parser)) throw new Error(`--parser must be one of ${PARSER_NAMES.join(", ")}`);
  if (!Number.isFinite(opts.threshold) || opts.threshold < 0 || opts.threshold > 100) throw new Error("threshold must be 0-100 (percent)");
  return { ...opts, parser: opts.parser as ParserName };
}

export async function runEval(opts: { parser: ParserName; category?: string }, dataset = loadDataset(), env = process.env) {
  const parse = await createParser(opts.parser, env);
  const context: ParseContext = { now: dataset.now, timezone: dataset.timezone, locale: "ar", stops: dataset.stops };
  const results: CaseResult[] = [];
  for (const c of dataset.cases.filter((x) => !opts.category || x.category === opts.category)) {
    try {
      results.push(summarizeCase(c, coerceParse(await parse(c.text, context))));
    } catch (error) {
      results.push(summarizeCase(c, coerceParse(null), error instanceof Error ? error.message : String(error)));
    }
  }
  return buildReport(results);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2), process.env);
  const report = await runEval(opts);
  console.log(formatReport(report, { parserName: opts.parser, threshold: opts.threshold / 100, showFailures: opts.failures }));
  const ok = report.overallAccuracy * 100 >= opts.threshold;
  console.log(`\n${ok ? "PASS" : "FAIL"}: ${(report.overallAccuracy * 100).toFixed(1)}% vs threshold ${opts.threshold}%`);
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  });
}
