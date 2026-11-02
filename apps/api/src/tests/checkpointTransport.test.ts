import { createServer, type RequestListener, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConfig } from "../config.js";
import { createOperationalLogger } from "../lib/logger.js";
import { CheckpointService } from "../services/checkpoints.js";

// Only loopback servers and synthetic credentials. These fixtures characterize
// the local adapter, not the unverified external provider contract.
const syntheticKey = "SYNTHETIC-TRANSPORT-TEST-ONLY";
const row = { id: "local", latitude: 31.7, longitude: 35.2, name_en: "Local gate", status: "closed" };
const servers: Server[] = [];
const safetyTimers: ReturnType<typeof setTimeout>[] = [];
async function origin(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing synthetic listener");
  return `http://127.0.0.1:${address.port}`;
}
function service(url: string, timeoutMs = 1_000) {
  return new CheckpointService({ url, apiKey: syntheticKey, timeoutMs, cacheTtlSeconds: 0 });
}
function safety(callback: () => void) {
  safetyTimers.push(setTimeout(callback, 700));
}
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const timer of safetyTimers.splice(0)) clearTimeout(timer);
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

describe("checkpoint transport security", () => {
  it("rejects same-origin redirects without a second request", async () => {
    let requests = 0;
    const primary = await origin((_req, res) => { requests++; res.writeHead(302, { location: "/other" }); res.end(); });
    await expect(service(primary).list()).rejects.toMatchObject({ statusCode: 503, message: "checkpoints_upstream_rejected" });
    expect(requests).toBe(1);
  });

  it.each([301, 302, 303, 307, 308])("rejects %i without sending either authentication header to a second origin", async (status) => {
    let secondaryRequests = 0;
    let secondaryApiKey = false;
    let secondaryAuthorization = false;
    const secondary = await origin((req, res) => {
      secondaryRequests++;
      secondaryApiKey ||= req.headers.apikey !== undefined;
      secondaryAuthorization ||= req.headers.authorization !== undefined;
      res.end(JSON.stringify([row]));
    });
    let primaryAuthenticated = false;
    const primary = await origin((req, res) => {
      primaryAuthenticated = req.headers.apikey === syntheticKey && req.headers.authorization === `Bearer ${syntheticKey}`;
      res.writeHead(status, { location: secondary + "/secondary" });
      res.end();
    });
    const result = await service(primary).list().then(() => "success", (error: unknown) => error);
    expect(primaryAuthenticated).toBe(true);
    expect({ secondaryRequests, secondaryApiKey, secondaryAuthorization }).toEqual({
      secondaryRequests: 0, secondaryApiKey: false, secondaryAuthorization: false
    });
    expect(result).toMatchObject({ statusCode: 503, message: "checkpoints_upstream_rejected" });
  });

  it.each(["headers", "body"] as const)("enforces the deadline during stalled %s and cancels the transport", async (phase) => {
    let peerClosed = false;
    let safetyReleased = false;
    const primary = await origin((_req, res) => {
      res.once("close", () => { peerClosed = true; });
      if (phase === "body") {
        res.writeHead(200, { "content-type": "application/json" });
        res.flushHeaders();
        res.write("[");
      }
      safety(() => {
        safetyReleased = true;
        res.end(phase === "body" ? JSON.stringify(row) + "]" : JSON.stringify([row]));
      });
    });
    const started = performance.now();
    const result = await service(primary, 100).list().then(() => "success", (error: unknown) => error);
    const elapsed = performance.now() - started;
    expect(result).toMatchObject({ statusCode: 503, message: "checkpoints_upstream_unreachable" });
    expect(elapsed).toBeLessThan(600);
    expect(safetyReleased).toBe(false);
    await vi.waitFor(() => expect(peerClosed).toBe(true), { timeout: 400 });
  });

  it.each(["declared", "chunked", "compressed"] as const)("rejects oversized %s decoded JSON rather than buffering it as success", async (mode) => {
    // Existing maps HTTP transport uses the same 1,000,000-byte resource budget.
    // Multibyte text proves this counts bytes, not JS string characters.
    const body = Buffer.from(JSON.stringify([{ ...row, name_en: "س".repeat(510_000) }]));
    expect(body.length).toBeGreaterThan(1_000_000);
    const primary = await origin((_req, res) => {
      const encoded = mode === "compressed" ? gzipSync(body) : body;
      res.writeHead(200, {
        "content-type": "application/json",
        ...(mode === "declared" ? { "content-length": String(encoded.length) } : {}),
        ...(mode === "compressed" ? { "content-encoding": "gzip" } : {})
      });
      res.end(encoded);
    });
    await expect(service(primary).list()).rejects.toMatchObject({ statusCode: 502, message: "checkpoints_upstream_invalid" });
  });

  it("accepts an empty array exactly at the byte bound and clears the deadline after success", async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");
    const primary = await origin((_req, res) => res.end("[]" + " ".repeat(999_998)));
    expect(await service(primary).list()).toMatchObject({ checkpoints: [], stale: false });
    // After settlement, a configured timer must not abort a completed request.
    const calls = abortSpy.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(abortSpy.mock.calls.length).toBe(calls);
  });

  it("cancels an unread oversized body promptly and releases the stream lock", async () => {
    let cancelled = false;
    let producer: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { producer = controller; }, cancel() { cancelled = true; } });
    const response = new Response(body, { headers: { "content-length": "1000001" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    // The safety timeout makes the vulnerable implementation settle, preserving
    // a useful RED instead of leaving a hanging test or background stream.
    const result = await Promise.race([
      service("http://127.0.0.1/unused").list().then(() => "success", (error: unknown) => error),
      new Promise((resolve) => safety(() => resolve("not-bounded")))
    ]);
    try {
      expect(result).toMatchObject({ statusCode: 502, message: "checkpoints_upstream_invalid" });
      expect(cancelled).toBe(true);
      expect(body.locked).toBe(false);
    } finally {
      // Cleanup even during the baseline RED. No global service is touched.
      if (!cancelled) producer!.close();
    }
  });

  it("cancels a rejected response body rather than waiting for it", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 302 })));
    await expect(service("http://127.0.0.1/unused").list()).rejects.toMatchObject({ statusCode: 503 });
    try { expect(cancelled).toBe(true); expect(body.locked).toBe(false); }
    finally { if (!body.locked && !cancelled) await body.cancel(); }
  });

  it("releases a broken reader and retains a sanitized transport failure", async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("SYNTHETIC-BODY-FAILURE")); } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    await expect(service("http://127.0.0.1/unused").list()).rejects.toMatchObject({
      statusCode: 503, message: "checkpoints_upstream_unreachable"
    });
    expect(body.locked).toBe(false);
  });

  it.each(["pending", "rejected"])("does not wait for a %s cancellation promise", async (mode) => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() {
      cancelled = true;
      return mode === "pending" ? new Promise<void>(() => {}) : Promise.reject(new Error("synthetic cancellation failure"));
    } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 403 })));
    await expect(service("http://127.0.0.1/unused").list()).rejects.toMatchObject({ statusCode: 503, message: "checkpoints_upstream_rejected" });
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });

  it("decodes UTF-8 split across chunks without changing authoritative labels", async () => {
    const expected = { ...row, name_en: "باب الزاوية — Bab Al-Zawiya" };
    const bytes = new TextEncoder().encode(JSON.stringify([expected]));
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    expect((await service("http://127.0.0.1/unused").list()).checkpoints).toEqual([expect.objectContaining(expected)]);
    expect(body.locked).toBe(false);
  });

  it("counts actual bytes across chunks even with an understated declared length", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(600_000));
      controller.enqueue(new Uint8Array(400_001));
    }, cancel() { cancelled = true; } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { headers: { "content-length": "1" } })));
    await expect(service("http://127.0.0.1/unused").list()).rejects.toMatchObject({ statusCode: 502 });
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });

  it.each(["redirect", "timeout", "oversized"] as const)("keeps the prior snapshot stale after %s rejection", async (mode) => {
    let failing = false;
    const primary = await origin((_req, res) => {
      if (!failing) { res.end(JSON.stringify([row])); return; }
      if (mode === "redirect") { res.writeHead(302, { location: "/other" }); res.end(); }
      else if (mode === "oversized") { res.writeHead(200, { "content-length": "1000001" }); res.flushHeaders(); }
      else { res.writeHead(200); res.flushHeaders(); res.write("["); }
    });
    const checkpointService = service(primary, 100);
    const first = await checkpointService.list();
    failing = true;
    expect(await checkpointService.list()).toEqual({ ...first, stale: true });
  });

  it.each([[null, [], 7], [{ latitude: true, longitude: 35 }], [{ latitude: 91, longitude: 181 }]])(
    "rejects an entirely unusable nonempty feed %#", async (...rows) => {
      const primary = await origin((_req, res) => res.end(JSON.stringify(rows)));
      await expect(service(primary).list()).rejects.toMatchObject({ statusCode: 502, message: "checkpoints_upstream_invalid" });
    }
  );

  it("retains the last good snapshot as stale on an all-invalid response, but accepts a real empty array", async () => {
    let payload: unknown = [row];
    const primary = await origin((_req, res) => res.end(JSON.stringify(payload)));
    const checkpointService = service(primary);
    const first = await checkpointService.list();
    payload = [{ id: "broken" }];
    expect(await checkpointService.list()).toEqual({ ...first, stale: true });
    payload = [];
    expect(await checkpointService.list()).toMatchObject({ checkpoints: [], stale: false });
  });

  it("keeps partial valid feeds, existing query parameters, labels and local status semantics", async () => {
    let requested = "";
    const primary = await origin((req, res) => {
      requested = req.url ?? "";
      res.end(JSON.stringify([row, { latitude: " " }]));
    });
    const result = await service(primary + "/feed?select=id,latitude,longitude&local=1").list();
    expect(result.checkpoints).toEqual([expect.objectContaining(row)]);
    const query = new URL(requested, primary).searchParams;
    expect(query.get("select")).toBe("id,latitude,longitude");
    expect(query.get("local")).toBe("1");
  });

  it("rejects malformed JSON and unapproved envelope shapes without guessing fields", async () => {
    let payload = "{";
    const primary = await origin((_req, res) => res.end(payload));
    await expect(service(primary).list()).rejects.toMatchObject({ statusCode: 502, message: "checkpoints_upstream_invalid" });
    payload = JSON.stringify({ checkpoints: [row] });
    await expect(service(primary).list()).rejects.toMatchObject({ statusCode: 502, message: "checkpoints_upstream_invalid" });
  });
});

describe("checkpoint provider credential redaction", () => {
  it.each(["apikey", "apiKey", "CHECKPOINTS_API_KEY"])("redacts %s through supported object/array contexts", (field) => {
    const output: string[] = [];
    const logger = createOperationalLogger(createConfig({
      APP_ENV: "local", DATABASE_URL: "mysql://synthetic:unused@127.0.0.1:59998/test_ci",
      JWT_SECRET: "synthetic-logging-test-secret-with-thirty-two-characters", LOG_LEVEL: "info"
    }), new Writable({ write(chunk, _encoding, callback) { output.push(String(chunk)); callback(); } }));
    const marker = "SYNTHETIC-REDACTION-ONLY-SECRET";
    for (let depth = 0; depth <= 5; depth++) {
      let context: Record<string, unknown> = { [field]: marker, safe: "preserved" };
      for (let level = 0; level < depth; level++) context = { context };
      logger.info(context, "synthetic redaction test");
    }
    logger.info({ request: { headers: { [field]: marker } }, items: [{ [field]: marker }] }, "synthetic array test");
    logger.child({ [field]: marker }).info({ safe: "preserved" }, "synthetic child binding test");
    // Boolean assertions keep even diagnostic failure output sanitized.
    expect(output.join("").includes(marker)).toBe(false);
    expect(output.join("").includes("[REDACTED]")).toBe(true);
    expect(output.every((line) => JSON.parse(line).msg.startsWith("synthetic"))).toBe(true);
  });
});
