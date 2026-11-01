import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";

/** Messages kept per conversation; older ones are deleted as new ones arrive. */
export const ASSISTANT_HISTORY_LIMIT = 100;

export type AssistantHistoryRole = "user" | "assistant";

export type AssistantHistoryMessage = {
  id: string;
  role: AssistantHistoryRole;
  text: string;
  payload: unknown;
  created_at: Date;
};

export type AssistantHistoryConversation = {
  id: string;
  saved_request_id: string | null;
  created_at: Date;
  updated_at: Date;
  messages: AssistantHistoryMessage[];
};

export type AppendAssistantExchangeInput = {
  passengerId: string;
  /** Client-held id. Ignored unless it belongs to the passenger. */
  conversationId?: string;
  userText: string;
  assistantText: string;
  assistantPayload: Prisma.InputJsonValue;
};

export type LinkSavedRequestResult = "linked" | "conversation_not_found" | "request_not_found";

export interface PassengerAssistantHistoryStore {
  /** Saves the passenger's message and the reply together; returns the conversation id. */
  appendExchange(input: AppendAssistantExchangeInput): Promise<string>;
  latest(passengerId: string): Promise<AssistantHistoryConversation | null>;
  /** Deletes every conversation of the passenger so the next message starts a new one. */
  clear(passengerId: string): Promise<void>;
  linkSavedRequest(passengerId: string, conversationId: string, requestId: string): Promise<LinkSavedRequestResult>;
}

export function createPrismaAssistantHistoryStore(
  db: PrismaClient = prisma
): PassengerAssistantHistoryStore {
  return {
    async appendExchange(input) {
      return db.$transaction(async (tx) => {
        // A supplied id that is unknown or someone else's starts a fresh chat;
        // its existence is never revealed. Without an id the passenger's
        // current chat continues, so a second device joins the same thread.
        const existing = input.conversationId
          ? await tx.passengerAssistantConversation.findFirst({
              where: { id: input.conversationId, passenger_id: input.passengerId },
              select: { id: true }
            })
          : await tx.passengerAssistantConversation.findFirst({
              where: { passenger_id: input.passengerId },
              orderBy: { updated_at: "desc" },
              select: { id: true }
            });
        const conversationId =
          existing?.id ??
          (await tx.passengerAssistantConversation.create({
            data: { passenger_id: input.passengerId },
            select: { id: true }
          })).id;
        // The row lock taken here orders concurrent writers to the same chat.
        const { next_sequence: next } = await tx.passengerAssistantConversation.update({
          where: { id: conversationId },
          data: { next_sequence: { increment: 2 } },
          select: { next_sequence: true }
        });
        await tx.passengerAssistantMessage.createMany({
          data: [
            { conversation_id: conversationId, sequence: next - 2, role: "user", text: input.userText },
            {
              conversation_id: conversationId,
              sequence: next - 1,
              role: "assistant",
              text: input.assistantText,
              payload: input.assistantPayload
            }
          ]
        });
        await tx.passengerAssistantMessage.deleteMany({
          where: { conversation_id: conversationId, sequence: { lt: next - ASSISTANT_HISTORY_LIMIT } }
        });
        return conversationId;
      });
    },

    async latest(passengerId) {
      const conversation = await db.passengerAssistantConversation.findFirst({
        where: { passenger_id: passengerId },
        orderBy: { updated_at: "desc" },
        select: {
          id: true,
          saved_request_id: true,
          created_at: true,
          updated_at: true,
          messages: {
            orderBy: { sequence: "desc" },
            take: ASSISTANT_HISTORY_LIMIT,
            select: { id: true, role: true, text: true, payload: true, created_at: true }
          }
        }
      });
      if (!conversation) return null;
      return { ...conversation, messages: conversation.messages.reverse() };
    },

    async clear(passengerId) {
      await db.$transaction(async (tx) => {
        const owned = await tx.passengerAssistantConversation.findMany({
          where: { passenger_id: passengerId },
          select: { id: true }
        });
        const ids = owned.map((conversation) => conversation.id);
        if (ids.length === 0) return;
        await tx.passengerAssistantMessage.deleteMany({ where: { conversation_id: { in: ids } } });
        await tx.passengerAssistantConversation.deleteMany({ where: { id: { in: ids } } });
      });
    },

    async linkSavedRequest(passengerId, conversationId, requestId) {
      return db.$transaction(async (tx) => {
        const conversation = await tx.passengerAssistantConversation.findFirst({
          where: { id: conversationId, passenger_id: passengerId },
          select: { id: true }
        });
        if (!conversation) return "conversation_not_found";
        const request = await tx.passengerRequest.findFirst({
          where: { id: requestId, passenger_id: passengerId },
          select: { id: true }
        });
        if (!request) return "request_not_found";
        await tx.passengerAssistantConversation.update({
          where: { id: conversation.id },
          data: { saved_request_id: request.id }
        });
        return "linked";
      });
    }
  };
}
