import { z } from "zod";
import { HttpError } from "../middleware/error.js";

/**
 * Keyset pagination for the app's own lists (newest first). The default page is generous so
 * current app builds, which read one page and ignore next_cursor, keep seeing what they saw
 * before for any realistic account; a client that wants smaller pages passes limit and follows
 * next_cursor.
 */
export const LIST_DEFAULT_LIMIT = 200;
export const LIST_MAX_LIMIT = 500;

export const listPageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(LIST_MAX_LIMIT).default(LIST_DEFAULT_LIMIT),
  cursor: z.string().min(1).max(512).optional()
});

export type ListPage = { limit: number; cursor?: { createdAt: Date; id: string } };

export function parseListPage(query: unknown): ListPage {
  const parsed = listPageQuerySchema.safeParse({
    limit: (query as Record<string, unknown> | undefined)?.limit,
    cursor: (query as Record<string, unknown> | undefined)?.cursor
  });
  if (!parsed.success) throw new HttpError(400, "invalid_pagination");
  return { limit: parsed.data.limit, cursor: parsed.data.cursor ? decodeListCursor(parsed.data.cursor) : undefined };
}

export function encodeListCursor(value: { created_at: Date; id: string }) {
  return Buffer.from(JSON.stringify({ v: 1, created_at: value.created_at.toISOString(), id: value.id }), "utf8").toString("base64url");
}

export function decodeListCursor(value: string) {
  try {
    if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid");
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (
      Object.keys(parsed).length !== 3 ||
      parsed.v !== 1 ||
      typeof parsed.created_at !== "string" ||
      typeof parsed.id !== "string" ||
      parsed.id.length < 1 ||
      parsed.id.length > 191
    ) throw new Error("invalid");
    const createdAt = new Date(parsed.created_at);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== parsed.created_at) throw new Error("invalid");
    return { createdAt, id: parsed.id };
  } catch {
    throw new HttpError(400, "invalid_cursor");
  }
}

/**
 * The list's own filter, narrowed to rows strictly after the cursor in (created_at desc, id desc)
 * order. Without a cursor the filter is returned unchanged.
 */
export function pagedWhere<W extends object>(where: W, page: ListPage): W | { AND: [W, object] } {
  if (!page.cursor) return where;
  return {
    AND: [
      where,
      {
        OR: [
          { created_at: { lt: page.cursor.createdAt } },
          { created_at: page.cursor.createdAt, id: { lt: page.cursor.id } }
        ]
      }
    ]
  };
}

export const listPageOrderBy = [{ created_at: "desc" as const }, { id: "desc" as const }];

/** Pass the rows fetched with take: limit + 1; returns the page and the cursor for the next one. */
export function listPageResult<T extends { created_at: Date; id: string }>(rows: T[], page: ListPage) {
  const items = rows.slice(0, page.limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > page.limit && last ? encodeListCursor(last) : null };
}
