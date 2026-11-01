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
  createPrismaAssistantHistoryStore,
  type AssistantHistoryConversation,
  type PassengerAssistantHistoryStore
} from "../services/passengerAssistantHistory.js";
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

const savedRequestLinkSchema = z.object({
  conversation_id: z.string().trim().min(1).max(128),
  saved_request_id: z.string().trim().min(1).max(191)
}).strict();

function publicConversation(conversation: AssistantHistoryConversation) {
  return {
    id: conversation.id,
    saved_request_id: conversation.saved_request_id,
    created_at: conversation.created_at.toISOString(),
    updated_at: conversation.updated_at.toISOString(),
    messages: conversation.messages.map((message) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      payload: message.payload ?? null,
      created_at: message.created_at.toISOString()
    }))
  };
}

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
  recorder: UncertainRequestRecorder = prismaUncertainRequestRecorder,
  history: PassengerAssistantHistoryStore = createPrismaAssistantHistoryStore()
) {
  const router = Router();
  router.use("/passenger/assistant", requireAuth, requireRole("passenger"));

  router.get("/passenger/assistant/conversation", async (req: AuthenticatedRequest, res, next) => {
    try {
      const conversation = await history.latest(req.user!.id);
      res.json({ conversation: conversation ? publicConversation(conversation) : null });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/passenger/assistant/conversation", async (req: AuthenticatedRequest, res, next) => {
    try {
      await history.clear(req.user!.id);
      res.json({ deleted: true });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/passenger/assistant/conversation", async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = savedRequestLinkSchema.parse(req.body);
      const result = await history.linkSavedRequest(req.user!.id, input.conversation_id, input.saved_request_id);
      if (result === "conversation_not_found") throw new HttpError(404, "assistant_conversation_not_found");
      if (result === "request_not_found") throw new HttpError(404, "passenger_request_not_found");
      res.json({ conversation_id: input.conversation_id, saved_request_id: input.saved_request_id });
    } catch (error) {
      next(error);
    }
  });

  router.post("/passenger/assistant/messages", async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = assistantMessageSchema.parse(req.body);
      const reply = await service.answer({
        passengerId: req.user!.id,
        message: input.message,
        locale: input.locale,
        history: input.history
      });
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

      const extracted = reply.status === "request_review"
        ? {
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
          }
        : undefined;
      // Both sides are saved only once there is a reply, so a failed attempt the
      // app retries is not stored twice. Only what the app shows is kept; the
      // JSON round trip drops absent fields, which a JSON column cannot hold.
      const conversationId = await history.appendExchange({
        passengerId: req.user!.id,
        conversationId: input.conversation_id,
        userText: input.message,
        assistantText: reply.message.slice(0, 2_000),
        assistantPayload: JSON.parse(JSON.stringify({
          status: reply.status,
          suggestions: reply.status === "clarification" ? reply.suggestions : [],
          extracted
        }))
      });

      if (reply.status === "request_review") {
        res.json({
          status: "request_review",
          message: reply.message,
          extracted,
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
