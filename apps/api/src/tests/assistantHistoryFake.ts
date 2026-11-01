/**
 * In-memory stand-in for the Prisma calls the assistant history store makes,
 * so ownership and ordering rules run against real store code.
 */

type Conversation = {
  id: string;
  passenger_id: string;
  saved_request_id: string | null;
  next_sequence: number;
  created_at: Date;
  updated_at: Date;
};

type Message = {
  id: string;
  conversation_id: string;
  sequence: number;
  role: "user" | "assistant";
  text: string;
  payload: unknown;
  created_at: Date;
};

type Where = Record<string, unknown>;

export function createAssistantHistoryDb() {
  const state = {
    conversations: [] as Conversation[],
    messages: [] as Message[],
    requests: [] as { id: string; passenger_id: string }[]
  };
  let clock = Date.parse("2026-11-01T08:00:00.000Z");
  let ids = 0;
  const tick = () => new Date((clock += 1_000));

  const matches = (row: Record<string, unknown>, where: Where = {}) =>
    Object.entries(where).every(([key, condition]) => {
      if (condition && typeof condition === "object" && "in" in condition) {
        return (condition.in as unknown[]).includes(row[key]);
      }
      if (condition && typeof condition === "object" && "lt" in condition) {
        return (row[key] as number) < (condition.lt as number);
      }
      return row[key] === condition;
    });

  const withMessages = (conversation: Conversation, take: number) => ({
    ...conversation,
    messages: state.messages
      .filter((message) => message.conversation_id === conversation.id)
      .sort((a, b) => b.sequence - a.sequence)
      .slice(0, take)
      .map(({ id, role, text, payload, created_at }) => ({ id, role, text, payload, created_at }))
  });

  const models = {
    passengerAssistantConversation: {
      async findFirst(args: { where: Where; orderBy?: unknown; select?: { messages?: { take: number } } }) {
        const found = state.conversations
          .filter((row) => matches(row, args.where))
          .sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime())[0];
        if (!found) return null;
        return args.select?.messages ? withMessages(found, args.select.messages.take) : { ...found };
      },
      async findMany(args: { where: Where }) {
        return state.conversations.filter((row) => matches(row, args.where)).map((row) => ({ ...row }));
      },
      async create(args: { data: { passenger_id: string } }) {
        const now = tick();
        const row: Conversation = {
          id: `conversation_${++ids}`,
          passenger_id: args.data.passenger_id,
          saved_request_id: null,
          next_sequence: 1,
          created_at: now,
          updated_at: now
        };
        state.conversations.push(row);
        return { ...row };
      },
      async update(args: { where: { id: string }; data: { next_sequence?: { increment: number }; saved_request_id?: string } }) {
        const row = state.conversations.find((conversation) => conversation.id === args.where.id);
        if (!row) throw new Error("record not found");
        if (args.data.next_sequence) row.next_sequence += args.data.next_sequence.increment;
        if (args.data.saved_request_id !== undefined) row.saved_request_id = args.data.saved_request_id;
        row.updated_at = tick();
        return { ...row };
      },
      async deleteMany(args: { where: Where }) {
        const before = state.conversations.length;
        state.conversations = state.conversations.filter((row) => !matches(row, args.where));
        return { count: before - state.conversations.length };
      }
    },
    passengerAssistantMessage: {
      async createMany(args: { data: Omit<Message, "id" | "created_at">[] }) {
        for (const data of args.data) {
          if (state.messages.some((row) => row.conversation_id === data.conversation_id && row.sequence === data.sequence)) {
            throw new Error("unique constraint failed");
          }
          state.messages.push({ ...data, payload: data.payload ?? null, id: `message_${++ids}`, created_at: new Date(clock) });
        }
        return { count: args.data.length };
      },
      async deleteMany(args: { where: Where }) {
        const before = state.messages.length;
        state.messages = state.messages.filter((row) => !matches(row, args.where));
        return { count: before - state.messages.length };
      }
    },
    passengerRequest: {
      async findFirst(args: { where: Where }) {
        const found = state.requests.find((row) => matches(row, args.where));
        return found ? { id: found.id } : null;
      }
    }
  };
  const db = {
    ...models,
    async $transaction<T>(callback: (tx: typeof models) => Promise<T>): Promise<T> {
      return callback(models);
    }
  };

  return { db, state };
}
