import path from "node:path";
import { pathToFileURL } from "node:url";
import { baselineParse } from "./baselineParser.js";
import { coerceParse } from "./score.js";
import type { EvalParser, NormalizedParse, ParseContext } from "./types.js";

export const PARSER_NAMES = ["baseline", "real", "groq", "gemini"] as const;
export type ParserName = (typeof PARSER_NAMES)[number];

const pick = (o: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined) return o[k];
  return undefined;
};

const place = (v: unknown): unknown => {
  if (v && typeof v === "object") return pick(v as Record<string, unknown>, "stopId", "stop_id", "id", "key");
  return v;
};

/**
 * Maps whatever the real parseRequest returns onto NormalizedParse. Tolerant by design:
 * the harness is written against the signature parseRequest(text, context), not a result shape.
 * Edit this one function if the real result shape differs from the guesses below.
 */
export function normalizeRealResult(raw: unknown): NormalizedParse {
  let o = (raw ?? {}) as Record<string, unknown>;
  for (const wrap of ["request", "result", "data", "parsed"]) {
    if (o[wrap] && typeof o[wrap] === "object") o = o[wrap] as Record<string, unknown>;
  }
  return coerceParse({
    type: pick(o, "type", "intent", "kind"),
    pickup: place(pick(o, "pickup", "pickupStopId", "pickup_stop_id", "origin")),
    dropoff: place(pick(o, "dropoff", "dropoffStopId", "dropoff_stop_id", "destination")),
    time: pick(o, "time", "when", "preferredTime"),
    seats: pick(o, "seats", "seatCount", "seat_count", "passengerCount"),
    size: pick(o, "size", "parcelSize", "parcel_size")
  });
}

type ParseRequestFn = (text: string, context: ParseContext) => unknown;

async function loadRealParseRequest(env: NodeJS.ProcessEnv): Promise<ParseRequestFn> {
  const spec = env.AI_EVAL_PARSER_MODULE;
  if (!spec) {
    throw new Error(
      "Set AI_EVAL_PARSER_MODULE to the module exporting parseRequest(text, context), e.g. AI_EVAL_PARSER_MODULE=src/services/aiParser.ts (path relative to apps/api)."
    );
  }
  const mod = (await import(pathToFileURL(path.resolve(process.cwd(), spec)).href)) as { parseRequest?: ParseRequestFn };
  if (typeof mod.parseRequest !== "function") throw new Error(`${spec} does not export a parseRequest function.`);
  return mod.parseRequest;
}

export async function createParser(name: ParserName, env: NodeJS.ProcessEnv = process.env): Promise<EvalParser> {
  if (name === "baseline") return (text, ctx) => baselineParse(text, ctx);

  if (name === "groq" || name === "gemini") {
    // Live providers make network calls and cost money: explicit opt-in, never in CI.
    if (env.AI_EVAL_LIVE !== "1") throw new Error(`Parser "${name}" calls a live provider. Set AI_EVAL_LIVE=1 to opt in.`);
    if (env.CI) throw new Error("Live provider evaluation is disabled when CI is set.");
    const keyVar = name === "groq" ? "GROQ_API_KEY" : "GEMINI_API_KEY";
    if (!env[keyVar]) throw new Error(`${keyVar} is not set.`);
    const real = await loadRealParseRequest(env);
    return async (text, ctx) => normalizeRealResult(await real(text, { ...ctx, provider: name }));
  }

  const real = await loadRealParseRequest(env);
  return async (text, ctx) => normalizeRealResult(await real(text, ctx));
}
