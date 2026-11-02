import { createServer, type Server, type RequestListener } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { LimitedCheckpointDirectoryService, PARTNER_ENDPOINT, PARTNER_MAX_BYTES, mapLimitedPartnerResponse, type PartnerBudget } from "../services/limitedCheckpointDirectory.js";
import { Writable } from "node:stream";
import { createOperationalLogger } from "../lib/logger.js";
import { createConfig } from "../config.js";
const key = "SYNTHETIC-LIMITED-KEY-NEVER-REAL";
export const fixture = () => ({ generatedAt: "2026-08-16T22:28:23.000Z", checkpoints: [
  { id: "synthetic:one", city: "مدينة تجريبية أ", checkpoint: "بوابة-تجريبية", entering_status_last_updated: "2026-08-16T18:28:32", leaving_status_last_updated: "2026-08-16T18:28:32+03:00" },
  { id: "synthetic:two", city: "مدينة تجريبية ب", checkpoint: "بوابة-تجريبية", entering_status_last_updated: "2026-08-16T18:28:32", leaving_status_last_updated: "2026-08-16T18:28:32Z" }
] });
const servers: Server[] = [];
async function origin(handler: RequestListener) {
  const server = createServer(handler); servers.push(server);
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address(); if (!address || typeof address === "string") throw Error("local_listener");
  return `http://127.0.0.1:${address.port}`;
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(servers.splice(0).map(server => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }))); });
it("documented object preserves IDs and ambiguous timestamps without coordinates or traffic inference", async () => {
  const local = await origin((_req, res) => res.end(JSON.stringify(fixture())));
  const value = await new LimitedCheckpointDirectoryService({ apiKey: key, timeoutMs: 500 }, { reserve: async () => ({ retryAfterSeconds: 0, lease: { id: "synthetic-attempt", notBefore: new Date(0) } }), settle: async () => {} }, (_url, init) => { expect(_url).toBe(PARTNER_ENDPOINT); return fetch(local, init); }).list();
  expect(value.checkpoints).toHaveLength(2);
  expect(value.checkpoints[0]).toMatchObject({ provider_checkpoint_id: "synthetic:one", latitude: null, longitude: null, traffic_status: "unavailable" });
  expect(value).toMatchObject({ limited_dataset: true, max_records_per_city: 7, permission_state: "USER_REPORTED", city_count: 2,
    generated_at: { raw: fixture().generatedAt, timezone_specified: true } });
  expect(value.checkpoints[0]!.entering_status_last_updated).toEqual({ raw: "2026-08-16T18:28:32", timezone_specified: false });
  expect(value.checkpoints[0]!.leaving_status_last_updated.timezone_specified).toBe(true);
});
function service(local: string, budget: PartnerBudget = { reserve: async () => ({ retryAfterSeconds: 0, lease: { id: "synthetic-attempt", notBefore: new Date(0) } }), settle: async () => {} }, timeoutMs = 500) {
  return new LimitedCheckpointDirectoryService({ apiKey: key, timeoutMs }, budget, (url, init) => {
    expect(url).toBe(PARTNER_ENDPOINT); return fetch(local, init);
  });
}
it("accepts a genuinely empty documented collection", () => {
  expect(mapLimitedPartnerResponse({ ...fixture(), checkpoints: [] }, new Date().toISOString())).toMatchObject({ count: 0, city_count: 0, checkpoints: [] });
});
for (const defect of ["array", "missing-id", "null-name", "missing-time", "invalid-date", "duplicate-id", "eighth-per-city", "missing-generation"]) {
  it(`rejects the entire malformed feed: ${defect}`, () => {
    const payload = fixture();
    const row = payload.checkpoints[0]!;
    if (defect === "array") { expect(() => mapLimitedPartnerResponse(payload.checkpoints, "now")).toThrow(); return; }
    if (defect === "missing-id") delete (row as Partial<typeof row>).id;
    if (defect === "null-name") (row as unknown as Record<string, unknown>).checkpoint = null;
    if (defect === "missing-time") delete (row as Partial<typeof row>).entering_status_last_updated;
    if (defect === "invalid-date") row.entering_status_last_updated = "2026-02-30T12:00:00";
    if (defect === "duplicate-id") payload.checkpoints[1]!.id = row.id;
    if (defect === "eighth-per-city") payload.checkpoints = Array.from({ length: 8 }, (_, i) => ({ ...row, id: `synthetic-${i}` }));
    if (defect === "missing-generation") delete (payload as Partial<typeof payload>).generatedAt;
    expect(() => mapLimitedPartnerResponse(payload, "now")).toThrow();
  });
}
it("uses only X-Api-Key on the fixed request and coalesces fresh reads", async () => {
  let count = 0;
  const local = await origin((req, res) => {
    count++; expect(req.headers["x-api-key"]).toBe(key);
    expect(req.headers.authorization).toBeUndefined(); expect(req.headers.apikey).toBeUndefined();
    expect(req.url).toBe("/"); res.end(JSON.stringify(fixture()));
  });
  const adapter = service(local);
  await Promise.all(Array.from({ length: 30 }, () => adapter.list()));
  await adapter.list(); expect(count).toBe(1);
});
it.each([301, 302, 303, 307, 308])("rejects redirect %i without forwarding credentials", async code => {
  let secondaryCalls = 0;
  const secondary = await origin((_req, res) => { secondaryCalls++; res.end("{}"); });
  const primary = await origin((_req, res) => { res.writeHead(code, { location: secondary }); res.end(); });
  await expect(service(primary).list()).rejects.toMatchObject({ message: "limited_directory_unavailable", statusCode: 503 });
  expect(secondaryCalls).toBe(0);
});
it.each([401, 403, 502])("sanitizes HTTP %i and does not return provider bodies", async status => {
  const local = await origin((_req, res) => { res.writeHead(status); res.end(key); });
  await expect(service(local).list()).rejects.toMatchObject({ message: "limited_directory_unavailable" });
});
it("persists Retry-After without immediately repeating the upstream request", async () => {
  let count = 0, deferred = 0;
  const local = await origin((_req, res) => { count++; res.writeHead(429, { "retry-after": "90" }); res.end(key); });
  const adapter = service(local, { reserve: async () => ({ retryAfterSeconds: 0, lease: { id: "synthetic-attempt", notBefore: new Date(0) } }), settle: async (_lease, seconds) => { deferred = seconds ?? 0; } });
  await expect(adapter.list()).rejects.toThrow("limited_directory_unavailable");
  await expect(adapter.list()).rejects.toThrow("limited_directory_unavailable");
  expect(deferred).toBe(90); expect(count).toBe(1);
});
it("does not shorten a long Retry-After into a local maximum", async () => {
  let deferred = 0;
  const local = await origin((_req, res) => { res.writeHead(429, { "retry-after": "90000" }); res.end(); });
  await expect(service(local, { reserve: async () => ({ retryAfterSeconds: 0, lease: { id: "synthetic-attempt", notBefore: new Date(0) } }), settle: async (_lease, seconds) => { deferred = seconds ?? 0; } }).list()).rejects.toThrow("limited_directory_unavailable");
  expect(deferred).toBe(90000);
});
it("persists a received 429 even when its headers cross the local deadline", async () => {
  let now = 0, cooldown = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const adapter = new LimitedCheckpointDirectoryService({ apiKey: key, timeoutMs: 500 }, {
    reserve: async () => ({ retryAfterSeconds: 0, lease: { id: "synthetic-late-429", notBefore: new Date(0) } }),
    settle: async (_lease, seconds) => { cooldown = seconds ?? 0; }
  }, async () => { now = 600; return new Response("", { status: 429, headers: { "retry-after": "90" } }); });
  await expect(adapter.list()).rejects.toThrow("limited_directory_unavailable");
  expect(cooldown).toBe(90);
});
it("shared denial and failed coordination never send a request", async () => {
  let count = 0; const local = await origin((_req, res) => { count++; res.end("{}"); });
  for (const reserve of [async () => ({ retryAfterSeconds: 60 }), async () => { throw Error(key); }]) {
    await expect(service(local, { reserve, settle: async () => {} }).list()).rejects.toThrow("limited_directory_unavailable");
  }
  expect(count).toBe(0);
});
it("rechecks a shared in-flight hold after its owner successfully settles", async () => {
  let now = 0, held = false, calls = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  let entered!: () => void, respond!: (response: Response) => void;
  const started = new Promise<void>(done => { entered = done; });
  const pending = new Promise<Response>(done => { respond = done; });
  const budget: PartnerBudget = {
    reserve: async () => {
      if (held) return { retryAfterSeconds: 251_000_000_000 };
      held = true; return { retryAfterSeconds: 0, lease: { id: "synthetic-held-attempt", notBefore: new Date(0) } };
    },
    settle: async () => { held = false; }
  };
  const first = new LimitedCheckpointDirectoryService({ apiKey: key, timeoutMs: 500 }, budget, async () => { calls++; entered(); return pending; });
  const second = new LimitedCheckpointDirectoryService({ apiKey: key, timeoutMs: 500 }, budget, async () => { calls++; return new Response(JSON.stringify(fixture())); });
  const flight = first.list(); await started;
  await expect(second.list()).rejects.toThrow("limited_directory_unavailable");
  respond(new Response(JSON.stringify(fixture()))); await flight;
  now = 5001;
  await expect(second.list()).resolves.toMatchObject({ count: 2 });
  expect(calls).toBe(2);
});
it.each(["headers", "body"])("deadline covers stalled %s and closes the socket", async phase => {
  let closed = false;
  const local = await origin((_req, res) => {
    res.on("close", () => { closed = true; });
    if (phase === "body") { res.writeHead(200); res.flushHeaders(); res.write('{"generatedAt":'); }
  });
  const start = performance.now();
  await expect(service(local, undefined, 70).list()).rejects.toThrow("limited_directory_unavailable");
  expect(performance.now() - start).toBeLessThan(450);
  await new Promise(done => setTimeout(done, 50)); expect(closed).toBe(true);
});
it("deadline also bounds database wait and a late grant never starts HTTP", async () => {
  let calls = 0;
  const adapter = new LimitedCheckpointDirectoryService({ apiKey: key, timeoutMs: 30 }, {
    reserve: async () => { await new Promise(done => setTimeout(done, 90)); return { retryAfterSeconds: 0, lease: { id: "synthetic-late-attempt", notBefore: new Date(0) } }; }, settle: async () => {}
  }, async () => { calls++; return new Response(JSON.stringify(fixture())); });
  await expect(adapter.list()).rejects.toThrow("limited_directory_unavailable");
  await new Promise(done => setTimeout(done, 100)); expect(calls).toBe(0);
});
it.each(["oversized", "invalid-json", "bad-utf8"])("rejects %s body", async failure => {
  const local = await origin((_req, res) => res.end(failure === "oversized" ? "x".repeat(PARTNER_MAX_BYTES + 1) : failure === "invalid-json" ? "{" : Buffer.from([255])));
  await expect(service(local).list()).rejects.toThrow("limited_directory_unavailable");
});
it("does not serve expired cache after network failure", async () => {
  let now = 0, calls = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const adapter = new LimitedCheckpointDirectoryService({ apiKey: key, timeoutMs: 500 }, { reserve: async () => ({ retryAfterSeconds: 0, lease: { id: "synthetic-attempt", notBefore: new Date(0) } }), settle: async () => {} }, async () => {
    if (++calls > 1) throw Error(key); return new Response(JSON.stringify(fixture()));
  });
  await adapter.list(); now = 14999; await adapter.list(); expect(calls).toBe(1);
  now = 15001; await expect(adapter.list()).rejects.toThrow("limited_directory_unavailable"); expect(calls).toBe(2);
});
it("redacts dedicated key and HTTP header variants at supported nested depths", () => {
  let captured = "";
  const logger = createOperationalLogger(createConfig({ APP_ENV: "local", DATABASE_URL: "mysql://synthetic:unused@localhost:59998/no_db", JWT_SECRET: "synthetic-local-jwt-secret-over-thirty-two-characters" }),
    new Writable({ write(chunk, _encoding, done) { captured += String(chunk); done(); } }));
  for (const field of ["AWEENRAYEH_PARTNER_API_KEY", "x-api-key", "X-Api-Key"]) {
    logger.info({ [field]: key, req: { headers: { [field]: key } }, a: { b: { c: { d: { e: { [field]: key } } } } } });
  }
  expect(captured).toContain("[REDACTED]"); expect(captured).not.toContain(key);
});
