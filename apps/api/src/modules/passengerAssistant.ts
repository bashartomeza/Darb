import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { HttpError } from "../middleware/error.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import {
  createPassengerAssistantService,
  PassengerAssistantProviderError,
  type PassengerAssistantReply,
  type PassengerAssistantService
} from "../services/passengerAssistant.js";
import {
  prismaUncertainRequestRecorder,
  type UncertainRequestRecorder
} from "../services/uncertainAiRequests.js";

const assistantMessageSchema = z.object({
  message: z.string().trim().min(1).max(1_000),
  locale: z.enum(["ar", "en"]).default("ar"),
  conversation_id: z.string().trim().min(1).max(128).optional(),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    text: z.string().trim().min(1).max(2_000)
  }).strict()).max(8).default([])
}).strict();

/** Structured intent as returned to the app (snake_case, no internal fields). */
function publicIntent(reply: PassengerAssistantReply) {
  const intent = reply.intent!;
  const place = (value: typeof intent.pickup) =>
    value ? { key: value.key, label_ar: value.label_ar, label_en: value.label_en } : null;
  return {
    type: intent.type,
    pickup: place(intent.pickup),
    dropoff: place(intent.dropoff),
    time: intent.time,
    seats: intent.seats,
    size: intent.size,
    confidence: intent.confidence,
    source: intent.source
  };
}

export function createPassengerAssistantRouter(
  appConfig: AppConfig,
  service: PassengerAssistantService = createPassengerAssistantService(appConfig),
  recorder: UncertainRequestRecorder = prismaUncertainRequestRecorder
) {
  const router = Router();
  router.use("/passenger/assistant", requireAuth, requireRole("passenger"));

  router.post("/passenger/assistant/messages", async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = assistantMessageSchema.parse(req.body);
      const reply = await service.answer({
        passengerId: req.user!.id,
        message: input.message,
        locale: input.locale,
        history: input.history
      });
      const conversationId = input.conversation_id ?? randomUUID();
      const intent = reply.intent ? publicIntent(reply) : undefined;

      if (reply.degraded && reply.degraded !== "unavailable") {
        req.operationalLog?.warn(
          { event: "passenger_assistant_fallback_used", category: reply.degraded },
          "Passenger assistant used the rule-based fallback"
        );
      }
      if (reply.uncertain && reply.intent) {
        // Best effort: the review queue must never break the passenger's reply.
        try {
          await recorder.record({
            text: input.message,
            locale: input.locale,
            intent: reply.intent,
            reason: reply.uncertain.reason,
            source: reply.uncertain.source
          });
        } catch {
          req.operationalLog?.warn(
            { event: "uncertain_ai_request_record_failed" },
            "Could not record uncertain assistant request"
          );
        }
      }

      if (reply.status === "request_review") {
        res.json({
          status: "request_review",
          message: reply.message,
          extracted: {
            pickup_key: reply.request!.pickupKey,
            pickup_label: reply.request!.pickupLabel,
            destination_key: reply.request!.destinationKey,
            destination_label: reply.request!.destinationLabel,
            preferred_time: reply.request!.preferredTime,
            passenger_count: reply.request!.passengerCount,
            pickup_lat: reply.request!.pickupLat,
            pickup_lng: reply.request!.pickupLng,
            destination_lat: reply.request!.destinationLat,
            destination_lng: reply.request!.destinationLng
          },
          intent,
          suggestions: [],
          conversation_id: conversationId
        });
        return;
      }

      if (reply.status === "clarification") {
        res.json({
          status: "clarification",
          question: reply.message,
          suggestions: reply.suggestions,
          intent,
          conversation_id: conversationId
        });
        return;
      }

      res.json({
        status: "result",
        answer: reply.message,
        suggestions: [],
        intent,
        conversation_id: conversationId
      });
    } catch (error) {
      if (error instanceof PassengerAssistantProviderError) {
        req.operationalLog?.warn(
          { event: "passenger_assistant_provider_failure", category: error.category },
          "Passenger assistant request failed"
        );
        const statusCode = error.category === "timeout" ? 504 : error.category === "upstream" ? 502 : 503;
        const errorCode = error.category === "timeout"
          ? "assistant_timeout"
          : error.category === "upstream"
            ? "assistant_provider_error"
            : "assistant_unavailable";
        next(new HttpError(statusCode, errorCode));
        return;
      }
      next(error);
    }
  });

  return router;
}
