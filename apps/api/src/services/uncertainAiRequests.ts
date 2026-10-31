import { prisma } from "../lib/prisma.js";
import type { ParsedIntent } from "./assistantParser.js";

/** Uncertain requests are deleted this long after they were recorded. */
export const UNCERTAIN_AI_RETENTION_DAYS = 30;
const MAX_STORED_TEXT = 300;

/**
 * Keeps only what a reviewer needs to improve the parser: strips contact
 * details, long digit runs (ids, cards) and links, then truncates.
 */
export function redactAssistantText(input: string): string {
  return input
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]")
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[number]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_STORED_TEXT);
}

export type UncertainRecordInput = {
  text: string;
  locale: "ar" | "en";
  intent: ParsedIntent;
  reason: string;
  source: "rules" | "provider";
};

export interface UncertainRequestRecorder {
  record(input: UncertainRecordInput): Promise<void>;
}

let lastPurge = 0;

export async function purgeExpiredUncertainRequests(now = new Date()) {
  await prisma.uncertainAiRequest.deleteMany({ where: { expires_at: { lte: now } } });
  lastPurge = now.getTime();
}

export const prismaUncertainRequestRecorder: UncertainRequestRecorder = {
  async record(input) {
    const now = new Date();
    await prisma.uncertainAiRequest.create({
      data: {
        locale: input.locale,
        text: redactAssistantText(input.text),
        intent_type: input.intent.type,
        confidence: input.intent.confidence,
        source: input.source,
        reason: input.reason.slice(0, 40),
        pickup_key: input.intent.pickup?.key.slice(0, 80) ?? null,
        dropoff_key: input.intent.dropoff?.key.slice(0, 80) ?? null,
        expires_at: new Date(now.getTime() + UNCERTAIN_AI_RETENTION_DAYS * 86_400_000)
      }
    });
    // Opportunistic retention: at most once an hour per process.
    if (now.getTime() - lastPurge > 3_600_000) await purgeExpiredUncertainRequests(now);
  }
};
