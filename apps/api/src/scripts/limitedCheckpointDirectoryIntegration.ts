import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { createApp } from "../app.js";
import { createConfig } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { signAuthToken } from "../middleware/auth.js";
import { MysqlPartnerBudget } from "../services/limitedCheckpointBudget.js";
import { LimitedCheckpointDirectoryService, PARTNER_ENDPOINT } from "../services/limitedCheckpointDirectory.js";

const db = new URL(process.env.DATABASE_URL ?? "");
if (!db.pathname.endsWith("_ci") || !["127.0.0.1", "localhost", "mysql"].includes(db.hostname)) {
  throw Error("limited_directory_requires_disposable_local_ci_database");
}
const owned: string[] = [], digests: string[] = [], servers: Server[] = [];
let assertions = 0;
const check = (value: unknown) => { assert(value, "limited_directory_integration_assertion"); assertions++; };
function key() { const value = `SYNTHETIC-LIMITED-${randomUUID()}`; digests.push(createHash("sha256").update(value).digest("hex")); return value; }
async function serve(app: ReturnType<typeof createApp>) {
  const server = createServer(app); servers.push(server);
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const addr = server.address(); assert(addr && typeof addr !== "string");
  return `http://127.0.0.1:${addr.port}/api/v1`;
}
async function productCounts() { return Promise.all([prisma.passengerRequest.count(), prisma.driverRoute.count(), prisma.merchantOrder.count(), prisma.parcel.count(), prisma.auditEvent.count()]); }
try {
  const before = await productCounts();
  const quotaKey = key();
  const quotas = [new MysqlPartnerBudget(prisma, quotaKey), new MysqlPartnerBudget(prisma, quotaKey)];
  const starts = await Promise.all(Array.from({ length: 24 }, (_, i) => quotas[i % 2]!.reserve(500)));
  check(starts.filter(v => v.retryAfterSeconds === 0).length === 1);
  for (let round = 0; round < 2; round++) {
    const probeKey = key(), peers = [new MysqlPartnerBudget(prisma, probeKey), new MysqlPartnerBudget(prisma, probeKey)];
    const concurrent = await Promise.all(Array.from({ length: 24 }, (_, i) => peers[i % 2]!.reserve(500)));
    check(concurrent.filter(v => v.lease !== undefined).length === 1);
  }
  const winningIndex = starts.findIndex(v => v.lease !== undefined);
  await quotas[winningIndex % 2]!.settle(starts[winningIndex]!.lease!, 60);
  await assert.rejects(quotas[winningIndex % 2]!.settle(starts[winningIndex]!.lease!));
  check((await new MysqlPartnerBudget(prisma, quotaKey).reserve(500)).retryAfterSeconds >= 59);
  const distinct = new MysqlPartnerBudget(prisma, key()); check((await distinct.reserve(500)).retryAfterSeconds === 0);

  // A received 429 followed by a database failure must not permit another
  // process to retry after the short original request slot.
  const failureKey = key(), failureBudget = new MysqlPartnerBudget(prisma, failureKey);
  let received429 = false;
  const failedCooldown = new LimitedCheckpointDirectoryService({ apiKey: failureKey, timeoutMs: 500 }, {
    reserve: timeout => failureBudget.reserve(timeout), settle: async () => { throw Error("synthetic_database_outage"); }
  }, async () => { received429 = true; return new Response("", { status: 429, headers: { "retry-after": "90" } }); });
  await assert.rejects(failedCooldown.list(), { message: "limited_directory_unavailable" });
  check(received429);
  await new Promise(done => setTimeout(done, 2700));
  check((await new MysqlPartnerBudget(prisma, failureKey).reserve(500)).retryAfterSeconds > 0);

  const recoveryKey = key(); let enter!: () => void, respond!: (response: Response) => void;
  const entered = new Promise<void>(done => { enter = done; });
  const pending = new Promise<Response>(done => { respond = done; });
  const emptyPayload = () => new Response(JSON.stringify({ generatedAt: "2026-10-24T10:00:00Z", checkpoints: [] }));
  const leader = new LimitedCheckpointDirectoryService({ apiKey: recoveryKey, timeoutMs: 2000 }, new MysqlPartnerBudget(prisma, recoveryKey), async () => { enter(); return pending; });
  const peer = new LimitedCheckpointDirectoryService({ apiKey: recoveryKey, timeoutMs: 2000 }, new MysqlPartnerBudget(prisma, recoveryKey), async () => emptyPayload());
  const ownerRead = leader.list(); await entered;
  await assert.rejects(peer.list(), { message: "limited_directory_unavailable" });
  respond(emptyPayload()); await ownerRead;
  await new Promise(done => setTimeout(done, 5100));
  check((await peer.list()).count === 0);

  // A real lock wait crosses expiry. DB time must be read after acquiring it.
  const lockKey = key(), lockDigest = digests.at(-1)!;
  const lockedBudget = new MysqlPartnerBudget(prisma, lockKey);
  check((await lockedBudget.reserve(500)).retryAfterSeconds === 0);
  await prisma.$executeRaw`UPDATE abuse_counters SET expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 100000 MICROSECOND)
    WHERE bucket_type='checkpoint_partner_budget' AND subject_digest=${lockDigest}`;
  let release!: () => void, acquired!: () => void;
  const hold = new Promise<void>(done => { release = done; });
  const ready = new Promise<void>(done => { acquired = done; });
  const locker = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM abuse_counters WHERE bucket_type='checkpoint_partner_budget' AND subject_digest=${lockDigest} FOR UPDATE`;
    acquired(); await hold;
  });
  await ready;
  const started = performance.now(), waiting = lockedBudget.reserve(500);
  await new Promise(done => setTimeout(done, 300)); release(); await locker;
  check((await waiting).retryAfterSeconds === 0); const lockWaitMs = Math.round(performance.now() - started); check(lockWaitMs >= 290);

  const tokens: string[] = [], sessions: string[] = [];
  for (const role of ["passenger", "driver", "merchant", "admin"] as const) {
    const user = await prisma.user.create({ data: { name: "Synthetic limited directory verification", role, email_verified_at: new Date(), profile_state: "complete", account_status: "active" } });
    owned.push(user.id);
    const session = await prisma.authSession.create({ data: { user_id: user.id, client_type: role === "admin" ? "admin" : "mobile", expires_at: new Date(Date.now() + 60000), security_version_at_issue: 1 } });
    sessions.push(session.id); tokens.push(signAuthToken({ id: user.id, role, sessionId: session.id, securityVersion: 1 }));
  }
  let upstream = 0;
  const sharedKey = key();
  const configuration = createConfig({ ...process.env, APP_ENV: "local", ENABLE_DEMO_FEATURES: "false", AWEENRAYEH_LIMITED_DIRECTORY_ENABLED: "true", AWEENRAYEH_PARTNER_API_KEY: sharedKey,
    CHECKPOINTS_ENABLED: "false", CHECKPOINT_DIRECTORY_ENABLED: "false", MAPS_ENABLED: "false" });
  const syntheticTransport: typeof fetch = async (target, init) => {
    check(target === PARTNER_ENDPOINT && init?.redirect === "manual"); upstream++;
    return new Response(JSON.stringify({ generatedAt: "2026-10-24T10:00:00Z", checkpoints: [
      { id: "synthetic-stable-id", city: "مدينة تجريبية", checkpoint: "بوابة-تجريبية", entering_status_last_updated: "2026-10-24T10:00:00", leaving_status_last_updated: "2026-10-24T10:00:00Z" }
    ] }));
  };
  const app = () => createApp(configuration, { limitedCheckpointDirectoryService: new LimitedCheckpointDirectoryService(configuration.limitedCheckpointDirectory!, new MysqlPartnerBudget(prisma, sharedKey), syntheticTransport) });
  const a = await serve(app()), b = await serve(app());
  const get = async (base: string, path: string, expected: number, token?: string) => {
    const response = await fetch(base + path, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(5000) });
    check(response.status === expected); return response;
  };
  await get(a, "/limited-checkpoint-directory", 401);
  await get(a, "/limited-checkpoint-directory", 403, tokens[2]);
  await get(a, "/limited-checkpoint-directory", 403, tokens[3]);
  const reads = await Promise.all(Array.from({ length: 12 }, (_, i) => get(a, "/limited-checkpoint-directory", 200, tokens[i % 2])));
  const payload = await reads[0]!.json();
  check(payload.count === 1 && payload.limited_dataset === true);
  check(payload.checkpoints[0].provider_checkpoint_id === "synthetic-stable-id");
  check(payload.checkpoints[0].latitude === null && payload.checkpoints[0].traffic_status === "unavailable");
  check(payload.checkpoints[0].entering_status_last_updated.timezone_specified === false);
  check(reads.every(v => v.headers.get("cache-control") === "no-store")); check(upstream === 1);
  await get(b, "/limited-checkpoint-directory", 503, tokens[0]); check(upstream === 1);
  const capability = await (await get(a, "/capabilities?include=limited-checkpoint-directory", 200, tokens[0])).json();
  check(capability.limited_checkpoint_directory_available === true && capability.checkpoints_available === false);
  check(!("limited_checkpoint_directory_available" in await (await get(a, "/capabilities", 200, tokens[0])).json()));
  await get(a, "/checkpoint-directory", 404, tokens[0]); await get(a, "/checkpoints", 404, tokens[0]);
  await prisma.authSession.update({ where: { id: sessions[0] }, data: { revoked_at: new Date() } });
  await get(a, "/limited-checkpoint-directory", 401, tokens[0]);
  check(JSON.stringify(before) === JSON.stringify(await productCounts()));
  console.log(JSON.stringify({ suite: "limited_directory_real_mysql", result: "PASS", assertions, concurrent_reservations: 72,
    concurrent_keys: 3, grants_per_key: 1, independent_instances: 2, coalesced_http_reads: 12, upstream_calls: upstream, lock_wait_ms: lockWaitMs,
    cross_restart_cooldown: true, product_rows_unchanged: true, provider_calls: 0, credentials: "synthetic_only" }));
} finally {
  for (const server of servers) { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
  if (owned.length) await prisma.user.deleteMany({ where: { id: { in: owned } } });
  if (digests.length) await prisma.abuseCounter.deleteMany({ where: { bucket_type: "checkpoint_partner_budget", subject_digest: { in: digests } } });
  await prisma.$disconnect();
}
