import { z } from "zod";

/**
 * Client for the internal Python `ai_services` HTTP service.
 *
 * Contract v1 is mirrored in apps/api/ai_services/contracts/ui_directives.v1.json
 * (parsed by Python, vitest and Flutter tests). The response is validated
 * strictly: the mobile app only ever receives directives that passed this
 * schema, so a compromised/buggy AI service cannot push arbitrary URIs
 * (dial_uri is restricted to `tel:`) or colours to the UI.
 */

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const uiDirectivesSchema = z
  .object({
    schema_version: z.literal(1),
    mode: z.enum(["emergency", "logistics", "standard"]),
    theme: z
      .object({
        primary_color_hex: hexColor,
        flashing: z.boolean(),
        flash_interval_ms: z.number().int().min(0).max(5_000),
        respect_reduce_motion: z.boolean()
      })
      .strict(),
    haptics: z
      .object({
        vibrate: z.boolean(),
        pattern_ms: z.array(z.number().int().min(0).max(3_000)).max(12)
      })
      .strict(),
    emergency_actions: z
      .array(
        z
          .object({
            id: z.string().min(1).max(40),
            label_ar: z.string().min(1).max(60),
            label_en: z.string().min(1).max(60),
            dial_uri: z.string().regex(/^tel:\+?\d{2,15}$/)
          })
          .strict()
      )
      .max(5),
    logistics_progress: z
      .object({
        parcels_total: z.number().int().min(1).max(10_000),
        trips_saved: z.number().int().min(0).max(10_000),
        fuel_savings_index: z.number().min(0).max(1),
        fuel_savings_percentage: z.number().min(0).max(100),
        series: z
          .array(
            z
              .object({
                step: z.number().int(),
                trips_without_batching: z.number().int(),
                trips_with_batching: z.number().int()
              })
              .strict()
          )
          .max(20),
        is_simulation: z.boolean()
      })
      .strict()
      .nullable(),
    requires_human_confirmation: z.boolean()
  })
  .strict();

export type AiUiDirectives = z.infer<typeof uiDirectivesSchema>;

const routingSchema = z
  .object({
    routing_target: z.enum(["AUTONOMOUS_DISPATCH_PIPELINE", "HUMAN_DISPATCHER_QUEUE_INTERFACE"]),
    needs_review: z.boolean()
  })
  .passthrough();

const okSchema = z
  .object({
    status: z.literal("OK"),
    transcript: z.string().max(2_000).optional(),
    dispatch: z.record(z.string(), z.unknown()),
    routing: routingSchema,
    frontend_ai_ui_directives: uiDirectivesSchema
  })
  .passthrough();

const blockedSchema = z
  .object({
    status: z.enum(["SECURITY_VIOLATION_BLOCKED", "REJECTED_INVALID_INPUT"]),
    transcript: z.string().max(2_000).optional()
  })
  .passthrough();

export type AiAnalysis =
  | {
      kind: "ok";
      transcript?: string;
      dispatch: Record<string, unknown>;
      routing: z.infer<typeof routingSchema>;
      uiDirectives: AiUiDirectives;
    }
  | { kind: "blocked"; transcript?: string; reason: "security_violation" | "invalid_input" };

export type AiServicesErrorCategory =
  | "unavailable"
  | "timeout"
  | "upstream"
  | "invalid_response"
  | "invalid_audio";

export class AiServicesError extends Error {
  constructor(public readonly category: AiServicesErrorCategory) {
    super(`ai_services_${category}`);
    this.name = "AiServicesError";
  }
}

export interface AiServicesClient {
  analyzeText(text: string, routes?: AiRouteHint[]): Promise<AiAnalysis>;
  analyzeVoice(audio: Buffer, contentType: string): Promise<AiAnalysis>;
}

/**
 * The Python service enforces its own total budget per request (text 12 s, voice 45 s by default,
 * AI_SERVICES_TEXT_BUDGET_SECONDS / AI_SERVICES_VOICE_BUDGET_SECONDS) and then answers from its
 * offline fallback. These client timeouts are deliberately larger so the Node side never gives up
 * first. If you raise a Python budget, raise the matching timeout above it.
 */
export const DEFAULT_TEXT_TIMEOUT_MS = 20_000;
export const DEFAULT_VOICE_TIMEOUT_MS = 55_000;

/** One predefined operating route (GET /api/v1/operating-routes), reduced to what the hint needs. */
export type AiRouteHint = { key: string; origin_ar: string; destination_ar: string };

export type AiServicesClientOptions = {
  baseUrl: string;
  sharedSecret: string;
  /** Text budget. Must stay above Python AI_SERVICES_TEXT_BUDGET_SECONDS (default 12 s). */
  timeoutMs?: number;
  /** Voice budget. Must stay above Python AI_SERVICES_VOICE_BUDGET_SECONDS (default 45 s). */
  voiceTimeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export function createAiServicesClient(options: AiServicesClientOptions): AiServicesClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const textTimeoutMs = options.timeoutMs ?? DEFAULT_TEXT_TIMEOUT_MS;
  const voiceTimeoutMs = options.voiceTimeoutMs ?? DEFAULT_VOICE_TIMEOUT_MS;
  const base = options.baseUrl.replace(/\/+$/, "");

  async function call(path: string, body: BodyInit, contentType: string, timeoutMs: number): Promise<AiAnalysis> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": contentType, "X-Internal-Secret": options.sharedSecret },
        body,
        signal: controller.signal
      });
    } catch (error) {
      throw new AiServicesError((error as Error)?.name === "AbortError" ? "timeout" : "unavailable");
    } finally {
      clearTimeout(timer);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new AiServicesError("invalid_response");
    }

    if (response.status === 200) {
      const parsed = okSchema.safeParse(json);
      if (!parsed.success) throw new AiServicesError("invalid_response");
      return {
        kind: "ok",
        transcript: parsed.data.transcript,
        dispatch: parsed.data.dispatch,
        routing: parsed.data.routing,
        uiDirectives: parsed.data.frontend_ai_ui_directives
      };
    }
    if (response.status === 422) {
      const parsed = blockedSchema.safeParse(json);
      if (!parsed.success) throw new AiServicesError("invalid_response");
      return {
        kind: "blocked",
        transcript: parsed.data.transcript,
        reason: parsed.data.status === "SECURITY_VIOLATION_BLOCKED" ? "security_violation" : "invalid_input"
      };
    }
    if (response.status === 400 || response.status === 415 || response.status === 413) {
      throw new AiServicesError("invalid_audio");
    }
    if (response.status === 503) throw new AiServicesError("unavailable");
    throw new AiServicesError("upstream"); // includes 401: shared secret mismatch
  }

  return {
    analyzeText: (text, routes) =>
      call(
        "/v1/analyze",
        JSON.stringify(routes && routes.length > 0 ? { text, routes } : { text }),
        "application/json",
        textTimeoutMs
      ),
    analyzeVoice: (audio, contentType) =>
      call("/v1/voice", new Uint8Array(audio) as unknown as BodyInit, contentType, voiceTimeoutMs)
  };
}

/** Returns null (feature off) unless both URL and a >=16 char secret are configured. */
export function createAiServicesClientFromEnv(
  env: Record<string, string | undefined> = process.env
): AiServicesClient | null {
  const url = env.AI_SERVICES_URL?.trim();
  const secret = env.AI_SERVICES_SHARED_SECRET?.trim();
  if (!url || !secret || secret.length < 16) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return createAiServicesClient({
    baseUrl: url,
    sharedSecret: secret,
    timeoutMs: readTimeout(env.AI_SERVICES_TIMEOUT_MS, DEFAULT_TEXT_TIMEOUT_MS),
    voiceTimeoutMs: readTimeout(env.AI_SERVICES_VOICE_TIMEOUT_MS, DEFAULT_VOICE_TIMEOUT_MS)
  });
}

function readTimeout(raw: string | undefined, fallback: number) {
  const value = Number(raw);
  return raw?.trim() && Number.isFinite(value) && value >= 1_000 && value <= 120_000 ? value : fallback;
}
