import { HttpError } from "../middleware/error.js";

/**
 * Server-side proxy for the checkpoint/barrier feed.
 *
 * The local adapter targets PostgREST; provider compatibility is unverified.
 * The app never talks to it
 * directly: the key would ship inside the APK, and the mobile client would gain
 * a second network origin outside the session boundary. Keeping the call here
 * means the key lives in server config and the app sees one authenticated API.
 *
 * Nothing here invents a barrier. When the upstream fails and no cached read is
 * available the router answers 503 so the map can say so, because a barrier
 * drawn in the wrong place is worse than a barrier not drawn at all.
 */

export type CheckpointStatus = "open" | "congested" | "closed" | "unknown";

export type Checkpoint = {
  id: string;
  name_ar: string | null;
  name_en: string | null;
  latitude: number;
  longitude: number;
  status: CheckpointStatus;
  updated_at: string | null;
};

export type CheckpointReadResult = {
  checkpoints: Checkpoint[];
  fetched_at: string;
  stale: boolean;
};

export type CheckpointServiceConfig = {
  url: string;
  apiKey: string;
  timeoutMs: number;
  cacheTtlSeconds: number;
};

/**
 * The upstream table is owned by another team and its column names are not
 * pinned by a contract we control, so each field accepts the spellings seen in
 * the wild. A row that still has no usable coordinate is dropped rather than
 * guessed at — see `normalizeRow`.
 */
const ID_KEYS = ["id", "checkpoint_id", "uuid"] as const;
const NAME_AR_KEYS = ["name_ar", "ar_name", "title_ar", "label_ar"] as const;
const NAME_EN_KEYS = ["name_en", "en_name", "title_en", "label_en", "name"] as const;
const LAT_KEYS = ["latitude", "lat"] as const;
const LNG_KEYS = ["longitude", "lng", "lon", "long"] as const;
const STATUS_KEYS = ["status", "state", "condition"] as const;
const UPDATED_KEYS = ["updated_at", "last_updated", "modified_at", "created_at"] as const;

const CLOSED_MARKERS = ["closed", "blocked", "shut", "مغلق", "مغلقة"];
const CONGESTED_MARKERS = ["congested", "busy", "slow", "delay", "crowded", "ازدحام", "مزدحم", "أزمة", "ازمة", "أزمة متوسطة"];
const OPEN_MARKERS = ["open", "clear", "flowing", "مفتوح", "مفتوحة", "سالك"];

// Same server resource budget as maps/http.ts, not a provider feed-size or
// pagination contract. Reject the whole feed; never truncate it into success.
const MAX_CHECKPOINT_JSON_BYTES = 1_000_000;

function pick(row: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function toCoordinate(value: unknown, limit: number) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || Math.abs(numeric) > limit) return null;
  // Six decimals matches the catalog's stop precision (~0.1 m).
  return Number(numeric.toFixed(6));
}

function toStatus(value: unknown): CheckpointStatus {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase();
  const matches = (markers: string[]) => markers.some((marker) =>
    normalized === marker || normalized.startsWith(`${marker} `));
  if (matches(CLOSED_MARKERS)) return "closed";
  if (matches(CONGESTED_MARKERS)) return "congested";
  if (matches(OPEN_MARKERS)) return "open";
  return "unknown";
}

function toText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.normalize("NFC");
}

function toTimestamp(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeRow(row: unknown, index: number): Checkpoint | null {
  if (typeof row !== "object" || row === null || Array.isArray(row)) return null;
  const record = row as Record<string, unknown>;
  const latitude = toCoordinate(pick(record, LAT_KEYS), 90);
  const longitude = toCoordinate(pick(record, LNG_KEYS), 180);
  // A barrier without a position cannot be placed on the map, and placing it
  // anywhere else would be fabrication. Drop it.
  if (latitude === null || longitude === null) return null;
  const rawId = pick(record, ID_KEYS);
  const nameAr = toText(pick(record, NAME_AR_KEYS));
  const nameEn = toText(pick(record, NAME_EN_KEYS));
  return {
    id: rawId === undefined ? `checkpoint_${index}` : String(rawId),
    name_ar: nameAr,
    name_en: nameEn,
    latitude,
    longitude,
    status: toStatus(pick(record, STATUS_KEYS)),
    updated_at: toTimestamp(pick(record, UPDATED_KEYS))
  };
}

export class CheckpointService {
  constructor(private readonly config: CheckpointServiceConfig) {}

  private cache: { result: CheckpointReadResult; expiresAt: number } | null = null;

  async list(): Promise<CheckpointReadResult> {
    const now = Date.now();
    if (this.cache && now < this.cache.expiresAt) {
      return this.cache.result;
    }
    try {
      const checkpoints = await this.fetchUpstream();
      const result: CheckpointReadResult = {
        checkpoints,
        fetched_at: new Date().toISOString(),
        stale: false
      };
      this.cache = { result, expiresAt: now + this.config.cacheTtlSeconds * 1_000 };
      return result;
    } catch (error) {
      // A recent-but-expired read beats a blank map during a brief upstream
      // wobble, and the flag lets the client label it honestly.
      if (this.cache) {
        return { ...this.cache.result, stale: true };
      }
      throw error;
    }
  }

  private async fetchUpstream(): Promise<Checkpoint[]> {
    const controller = new AbortController();
    const deadline = performance.now() + this.config.timeoutMs;
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let completed = false;
    const checkDeadline = () => {
      // Timers cannot preempt synchronous JSON parsing/normalization. Bound its
      // input and check elapsed monotonic time before publishing any result.
      if (performance.now() >= deadline) controller.abort();
      controller.signal.throwIfAborted();
    };
    try {
      const url = new URL(this.config.url);
      if (!url.searchParams.has("select")) url.searchParams.set("select", "*");
      response = await fetch(url, {
        headers: {
          apikey: this.config.apiKey,
          authorization: `Bearer ${this.config.apiKey}`,
          accept: "application/json"
        },
        redirect: "manual",
        signal: controller.signal
      });
      checkDeadline();
      if (!response.ok) {
        // Includes redirects: never send either credential to another endpoint.
        throw new HttpError(503, "checkpoints_upstream_rejected");
      }
      const declaredLength = Number(response.headers.get("content-length"));
      if (declaredLength > MAX_CHECKPOINT_JSON_BYTES || !response.body) {
        throw new HttpError(502, "checkpoints_upstream_invalid");
      }
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let bytes = 0;
      let body = "";
      while (true) {
        const chunk = await reader.read();
        checkDeadline();
        if (chunk.done) break;
        // Fetch yields decoded bytes, including for compressed/chunked bodies.
        bytes += chunk.value.byteLength;
        if (bytes > MAX_CHECKPOINT_JSON_BYTES) {
          throw new HttpError(502, "checkpoints_upstream_invalid");
        }
        body += decoder.decode(chunk.value, { stream: true });
      }
      body += decoder.decode();
      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        throw new HttpError(502, "checkpoints_upstream_invalid");
      }
      checkDeadline();
      if (!Array.isArray(payload)) {
        throw new HttpError(502, "checkpoints_upstream_invalid");
      }
      const checkpoints = payload
        .map((row, index) => normalizeRow(row, index))
        .filter((checkpoint): checkpoint is Checkpoint => checkpoint !== null);
      if (payload.length > 0 && checkpoints.length === 0) {
        throw new HttpError(502, "checkpoints_upstream_invalid");
      }
      checkDeadline();
      completed = true;
      return checkpoints;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      // Upstream hostname, key, and error body stay server-side, including body
      // transport/abort errors. Malformed JSON retains the existing 502 above.
      throw new HttpError(503, "checkpoints_upstream_unreachable");
    } finally {
      clearTimeout(timer);
      if (!completed) controller.abort();
      // Do not await cancellation: an uncooperative source must not extend the
      // request deadline. Consume cancellation rejection and release ownership.
      if (reader) {
        void reader.cancel().catch(() => undefined);
        reader.releaseLock();
      } else if (response?.body) {
        void response.body.cancel().catch(() => undefined);
      }
    }
  }
}

export function createCheckpointService(config: CheckpointServiceConfig) {
  return new CheckpointService(config);
}
