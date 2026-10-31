import { HttpError } from "../middleware/error.js";

// Only this backend adapter knows the authenticated provider target. Never accept
// a URL from a client/config value or reuse the legacy PostgREST credential.
export const PARTNER_ENDPOINT = "https://db.aweenrayeh.com/v1/partner/checkpoints";
export const PARTNER_CACHE_MS = 15_000;
// Server memory/CPU budget, not a claim about provider pagination or feed size.
export const PARTNER_MAX_BYTES = 1_000_000;
export type PartnerLease = { id: string; notBefore: Date };
export interface PartnerBudget {
  reserve(timeoutMs: number): Promise<{ retryAfterSeconds: number; lease?: PartnerLease }>;
  settle(lease: PartnerLease, cooldownSeconds?: number): Promise<void>;
}
export type PartnerTimestamp = { raw: string; timezone_specified: boolean };
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 1000) throw Error("invalid_field");
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("invalid_object");
  return value as Record<string, unknown>;
}
function timestamp(value: unknown): PartnerTimestamp {
  const raw = text(value);
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})?$/.exec(raw);
  if (!parts) throw Error("invalid_timestamp");
  const [, y, m, d, h, minute, second, zone] = parts;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]! || Number(h) > 23 || Number(minute) > 59 || Number(second) > 59 ||
      (zone && zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))) throw Error("invalid_timestamp");
  // In particular, do not call Date.parse on an offset-free provider value.
  return { raw, timezone_specified: zone !== undefined };
}
export function mapLimitedPartnerResponse(payload: unknown, fetchedAt: string) {
  const root = object(payload);
  const generated_at = timestamp(root.generatedAt);
  if (!Array.isArray(root.checkpoints)) throw Error("invalid_collection");
  const ids = new Set<string>(), cityCounts = new Map<string, number>();
  const checkpoints = root.checkpoints.map(value => {
    const row = object(value);
    const id = text(row.id), city = text(row.city), name = text(row.checkpoint);
    if (ids.has(id)) throw Error("duplicate_provider_id");
    ids.add(id);
    const count = (cityCounts.get(city) ?? 0) + 1;
    if (count > 7) throw Error("limited_scope_exceeded");
    cityCounts.set(city, count);
    return {
      provider_checkpoint_id: id, checkpoint_name_ar: name, city_ar: city,
      entering_status_last_updated: timestamp(row.entering_status_last_updated),
      leaving_status_last_updated: timestamp(row.leaving_status_last_updated),
      latitude: null, longitude: null, coordinate_verified: false,
      ready_for_map: false, traffic_status: "unavailable" as const
    };
  });
  return { schema_version: 1, dataset_role: "LIMITED_PROVIDER_DIRECTORY" as const,
    limited_dataset: true, max_records_per_city: 7, permission_state: "USER_REPORTED" as const,
    generated_at, fetched_at: fetchedAt, count: checkpoints.length, city_count: cityCounts.size, checkpoints };
}
export type LimitedCheckpointDirectory = ReturnType<typeof mapLimitedPartnerResponse>;

export class LimitedCheckpointDirectoryService {
  private cache?: { value: LimitedCheckpointDirectory; until: number };
  private flight?: Promise<LimitedCheckpointDirectory>;
  private failureUntil = 0;
  constructor(private readonly options: { apiKey: string; timeoutMs: number }, private readonly budget: PartnerBudget,
    private readonly transport: typeof fetch = fetch) {}

  async list(): Promise<LimitedCheckpointDirectory> {
    if (this.cache && performance.now() < this.cache.until) return this.cache.value;
    if (this.flight) return this.flight;
    if (performance.now() < this.failureUntil) throw new HttpError(503, "limited_directory_unavailable");
    this.flight = this.read();
    try { return await this.flight; } finally { this.flight = undefined; }
  }
  private async read(): Promise<LimitedCheckpointDirectory> {
    const controller = new AbortController();
    const started = performance.now();
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(Error("deadline")); }, this.options.timeoutMs);
    });
    const checkDeadline = () => {
      if (controller.signal.aborted || performance.now() - started >= this.options.timeoutMs) throw Error("deadline");
    };
    try {
      const run = async () => {
        const reservation = await this.budget.reserve(this.options.timeoutMs);
        const lease = reservation.lease;
        if (reservation.retryAfterSeconds > 0 || !lease) {
          // A peer can settle an in-flight hold. Recheck the authoritative row
          // after a bounded negative cache; never cache its year-9999 sentinel.
          this.failureUntil = performance.now() + 5000; throw Error("shared_budget");
        }
        let releaseNormalHold = true;
        try {
          checkDeadline();
          response = await this.transport(PARTNER_ENDPOINT, { redirect: "manual", signal: controller.signal,
            headers: { Accept: "application/json", "X-Api-Key": this.options.apiKey } });
          if (response.status === 429) {
            // The durable reservation is still held. Never release it on a
            // failed cooldown write or a crash between receipt and persistence.
            releaseNormalHold = false;
            const header = response.headers.get("retry-after");
            // Guide documents seconds, 60 by default. Never shorten that cooldown.
            const seconds = header && /^\d+$/.test(header) ? Math.max(60, Number(header)) : 60;
            if (!Number.isSafeInteger(seconds) || seconds > 2_147_483_647) {
              // Unrepresentable cooldown: require operator investigation instead
              // of shortening it into an automatic retry. The shared row is held.
              this.failureUntil = Infinity;
              await this.budget.settle(lease, Infinity);
            } else {
              this.failureUntil = performance.now() + seconds * 1000;
              await this.budget.settle(lease, seconds);
            }
            throw Error("provider_budget");
          }
          checkDeadline();
          if (response.status !== 200 || !response.body) throw Error("upstream_rejected");
          const contentLength = response.headers.get("content-length");
          if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > PARTNER_MAX_BYTES) throw Error("body_limit");
          reader = response.body.getReader();
          const chunks: Uint8Array[] = []; let size = 0;
          while (true) {
            const result = await reader.read(); checkDeadline();
            if (result.done) break;
            size += result.value.byteLength;
            if (size > PARTNER_MAX_BYTES) throw Error("body_limit");
            chunks.push(result.value);
          }
          const bytes = Buffer.concat(chunks, size);
          const value = mapLimitedPartnerResponse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), new Date().toISOString());
          checkDeadline();
          releaseNormalHold = false;
          await this.budget.settle(lease);
          checkDeadline();
          this.cache = { value, until: performance.now() + PARTNER_CACHE_MS };
          return value;
        } finally {
          if (releaseNormalHold) await this.budget.settle(lease);
        }
      };
      return await Promise.race([run(), deadline]);
    } catch {
      this.failureUntil = Math.max(this.failureUntil, performance.now() + 5000);
      throw new HttpError(503, "limited_directory_unavailable");
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
      else if (response?.body) void response.body.cancel().catch(() => {});
    }
  }
}
