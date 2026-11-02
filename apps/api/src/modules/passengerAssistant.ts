import express, { Router } from "express";
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
  AiServicesError,
  type AiServicesClient
} from "../services/aiServicesClient.js";
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

// The voice body is the audio itself, so the chat it belongs to comes in the query string.
const voiceQuerySchema = z.object({
  locale: z.enum(["ar", "en"]).default("ar"),
  conversation_id: z.string().trim().min(1).max(128).optional()
});

/** Turns the model sees with a new message, as many as the text route accepts from the app. */
const VOICE_HISTORY_TURNS = 8;

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
  history: PassengerAssistantHistoryStore = createPrismaAssistantHistoryStore(),
  aiServices: AiServicesClient | null = null
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

  /** Runs one assistant exchange (shared by the text and voice routes) and returns the public body. */
  async function answerExchange(
    req: AuthenticatedRequest,
    input: { message: string; locale: "ar" | "en"; conversation_id?: string; history: { role: "user" | "assistant"; text: string }[] }
  ) {
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
      return { status: "request_review" as const, message: reply.message, extracted, intent, suggestions: [], conversation_id: conversationId };
    }
    if (reply.status === "clarification") {
      return { status: "clarification" as const, question: reply.message, suggestions: reply.suggestions, intent, conversation_id: conversationId };
    }
    return { status: "result" as const, answer: reply.message, suggestions: [], intent, conversation_id: conversationId };
  }

  router.post("/passenger/assistant/messages", async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = assistantMessageSchema.parse(req.body);
      res.json(await answerExchange(req, input));
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

  /**
   * Voice -> Whisper (ai_services) -> verified pipeline -> existing assistant.
   * Body: raw .wav/.mp3 bytes; query: `locale` (ar|en, default ar) and the chat's `conversation_id`,
   * so a voice message lands in the same saved chat as typed ones. Response = the normal assistant body plus
   * `transcript`, `ai_routing` and `frontend_ai_ui_directives` (contract v1).
   */
  router.post(
    "/passenger/assistant/voice",
    express.raw({ type: ["audio/wav", "audio/x-wav", "audio/wave", "audio/mpeg", "audio/mp3"], limit: "10mb" }),
    async (req: AuthenticatedRequest, res, next) => {
      try {
        if (!aiServices) throw new HttpError(503, "voice_unavailable");
        const query = voiceQuerySchema.parse(req.query);
        const audio = req.body;
        if (!Buffer.isBuffer(audio) || audio.length === 0) throw new HttpError(415, "unsupported_media_type");

        const analysis = await aiServices.analyzeVoice(audio, String(req.headers["content-type"] ?? ""));
        if (analysis.kind === "blocked") {
          req.operationalLog?.warn(
            { event: "voice_input_blocked", category: analysis.reason },
            "Voice transcript rejected by the AI firewall"
          );
          throw new HttpError(422, "voice_input_rejected");
        }

        const transcript = (analysis.transcript ?? "").trim().slice(0, 1_000);
        if (!transcript) throw new HttpError(422, "voice_input_rejected");

        // A voice message continues the chat on screen, exactly like a typed one: it is saved in the
        // same conversation (the store ignores an id the passenger does not own and starts a new one)
        // and the model sees that chat's recent turns, read from the database the app shows.
        const current = query.conversation_id ? await history.latest(req.user!.id) : null;
        const turns = (current && current.id === query.conversation_id ? current.messages : [])
          .filter((message) => message.text.trim().length > 0)
          .slice(-VOICE_HISTORY_TURNS)
          .map((message) => ({ role: message.role, text: message.text.trim().slice(0, 2_000) }));

        const body = await answerExchange(req, {
          message: transcript,
          locale: query.locale,
          conversation_id: query.conversation_id,
          history: turns
        });
        res.json({
          ...body,
          transcript,
          ai_routing: {
            routing_target: analysis.routing.routing_target,
            needs_review: analysis.routing.needs_review
          },
          frontend_ai_ui_directives: analysis.uiDirectives
        });
      } catch (error) {
        if (error instanceof AiServicesError) {
          req.operationalLog?.warn({ event: "ai_services_failure", category: error.category }, "ai_services request failed");
          const map = {
            invalid_audio: [400, "invalid_audio"],
            timeout: [504, "voice_timeout"],
            unavailable: [503, "voice_unavailable"],
            upstream: [502, "voice_provider_error"],
            invalid_response: [502, "voice_provider_error"]
          } as const;
          const [status, code] = map[error.category];
          next(new HttpError(status, code));
          return;
        }
        if (error instanceof PassengerAssistantProviderError) {
          next(new HttpError(error.category === "timeout" ? 504 : error.category === "upstream" ? 502 : 503, "assistant_unavailable"));
          return;
        }
        next(error);
      }
    }
  );

  return router;
}
