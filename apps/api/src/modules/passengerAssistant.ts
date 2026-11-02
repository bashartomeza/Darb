import { randomUUID } from "node:crypto";
import express, { Router } from "express";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { HttpError } from "../middleware/error.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import {
  PassengerAssistantProviderError,
  createPassengerAssistantService,
  type PassengerAssistantReply,
  type PassengerAssistantService
} from "../services/passengerAssistant.js";
import {
  AiServicesError,
  type AiServicesClient
} from "../services/aiServicesClient.js";
import {
  prismaUncertainRequestRecorder,
  type UncertainRequestRecorder
} from "../services/uncertainRequests.js";

const messageSchema = z.object({
  message: z.string().trim().min(1).max(1_000),
  conversation_id: z.string().min(1).max(100).optional()
});

function publicIntent(reply: PassengerAssistantReply) {
  if (!reply.intent) return undefined;
  return {
    service_type: reply.intent.serviceType,
    pickup: reply.intent.pickup,
    destination: reply.intent.destination,
    preferred_time: reply.intent.preferredTime,
    passenger_count: reply.intent.passengerCount
  };
}

/** Public response body shared by the text and voice routes (keeps one data contract). */
export function assistantResponseBody(
  reply: PassengerAssistantReply,
  conversationId: string,
  intent: ReturnType<typeof publicIntent> | undefined
) {
  if (reply.status === "request_review") {
    return {
      status: "request_review" as const,
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
    };
  }
  if (reply.status === "clarification") {
    return {
      status: "clarification" as const,
      question: reply.message,
      suggestions: reply.suggestions,
      intent,
      conversation_id: conversationId
    };
  }
  return {
    status: "result" as const,
    answer: reply.message,
    suggestions: [],
    intent,
    conversation_id: conversationId
  };
}

export function createPassengerAssistantRouter(
  appConfig: AppConfig,
  service: PassengerAssistantService = createPassengerAssistantService(appConfig),
  recorder: UncertainRequestRecorder = prismaUncertainRequestRecorder,
  aiServices: AiServicesClient | null = null
) {
  const router = Router();
  router.use("/passenger/assistant", requireAuth, requireRole("passenger"));

  router.post("/passenger/assistant/messages", async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed = messageSchema.safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, "invalid_request");
      const reply = await service.answer({
        passengerId: req.user!.id,
        message: parsed.data.message,
        locale: "ar",
        history: []
      });
      const conversationId = parsed.data.conversation_id ?? randomUUID();
      const intent = reply.intent ? publicIntent(reply) : undefined;
      if (reply.uncertain && reply.intent) {
        try {
          await recorder.record({
            text: parsed.data.message,
            locale: "ar",
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

      res.json(assistantResponseBody(reply, conversationId, intent));
    } catch (error) {
      if (error instanceof PassengerAssistantProviderError) {
        req.operationalLog?.warn(
          { event: "assistant_provider_failure", category: error.category },
          "Passenger assistant provider failure"
        );
        next(new HttpError(error.category === "timeout" ? 504 : error.category === "upstream" ? 502 : 503, "assistant_unavailable"));
        return;
      }
      next(error);
    }
  });

  /**
   * Voice -> Whisper (ai_services) -> verified pipeline -> existing assistant.
   * Body: raw .wav/.mp3 bytes. Response = the normal assistant body plus
   * `transcript`, `ai_routing` and `frontend_ai_ui_directives` (contract v1).
   */
  router.post(
    "/passenger/assistant/voice",
    express.raw({ type: ["audio/wav", "audio/x-wav", "audio/wave", "audio/mpeg", "audio/mp3"], limit: "10mb" }),
    async (req: AuthenticatedRequest, res, next) => {
      try {
        if (!aiServices) throw new HttpError(503, "voice_unavailable");
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

        const reply = await service.answer({
          passengerId: req.user!.id,
          message: transcript,
          locale: "ar",
          history: []
        });
        const conversationId = randomUUID();
        const intent = reply.intent ? publicIntent(reply) : undefined;
        if (reply.uncertain && reply.intent) {
          try {
            await recorder.record({
              text: transcript,
              locale: "ar",
              intent: reply.intent,
              reason: reply.uncertain.reason,
              source: reply.uncertain.source
            });
          } catch {
            req.operationalLog?.warn({ event: "uncertain_ai_request_record_failed" }, "Could not record uncertain assistant request");
          }
        }
        res.json({
          ...assistantResponseBody(reply, conversationId, intent),
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
