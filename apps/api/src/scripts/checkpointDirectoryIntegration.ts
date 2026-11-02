import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { config, createConfig } from "../config.js";
import { createApp } from "../app.js";
import { signAuthToken } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { CheckpointDirectoryService } from "../services/checkpointDirectory.js";
import { directoryFixture } from "../tests/checkpointDirectoryFixture.js";

const database = new URL(process.env.DATABASE_URL ?? "");
if (!database.pathname.endsWith("_ci") || !["127.0.0.1", "localhost", "mysql"].includes(database.hostname)) {
  throw new Error("checkpoint_directory_requires_disposable_local_ci_database");
}
const fixture = directoryFixture(true), owned: string[] = [], servers: Server[] = [];
let assertions = 0;
function check(value: unknown) { assert(value, "checkpoint_directory_integration_assertion"); assertions++; }
async function serve(enabled: boolean) {
  const appConfig = createConfig({ ...process.env, CHECKPOINT_DIRECTORY_ENABLED: String(enabled),
    CHECKPOINT_DIRECTORY_FILE: fixture.file, CHECKPOINTS_ENABLED: "false" });
  const server = createServer(createApp(appConfig, { checkpointDirectoryService: new CheckpointDirectoryService(fixture.file, fixture.manifest) }));
  servers.push(server); await new Promise<void>(ok => server.listen(0, "127.0.0.1", ok));
  const address = server.address(); assert(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}/api/v1`;
}
async function counts() {
  return Promise.all([prisma.passengerRequest.count(), prisma.driverRoute.count(), prisma.merchantOrder.count(), prisma.parcel.count(), prisma.auditEvent.count()]);
}
try {
  const before = await counts(), tokens: string[] = [];
  for (const role of ["passenger", "driver", "merchant"] as const) {
    const user = await prisma.user.create({ data: { name: "Synthetic directory verification", role,
      email_verified_at: new Date(), profile_state: "complete", account_status: "active" } });
    owned.push(user.id);
    const session = await prisma.authSession.create({ data: { user_id: user.id, client_type: "mobile",
      expires_at: new Date(Date.now() + 60_000), security_version_at_issue: 1 } });
    tokens.push(signAuthToken({ id: user.id, role, sessionId: session.id, securityVersion: 1 }));
  }
  const enabled = await serve(true), disabled = await serve(false);
  async function get(base: string, path: string, status: number, token?: string, method = "GET") {
    const result = await fetch(base + path, { method, headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(5_000) });
    check(result.status === status); return result;
  }
  await get(disabled, "/checkpoint-directory", 404, tokens[0]);
  await get(enabled, "/checkpoint-directory", 401);
  for (const token of tokens.slice(0, 2)) {
    const response = await get(enabled, "/checkpoint-directory", 200, token), body = await response.json();
    check(response.headers.get("cache-control") === "no-store"); check(body.count === 3 && body.city_count === 2);
    check(body.checkpoints.every((row: { latitude: unknown; ready_for_map: boolean; traffic_status: string }) => row.latitude === null && !row.ready_for_map && row.traffic_status === "unavailable"));
    check(new Set(body.checkpoints.map((row: { research_row_key: string }) => row.research_row_key)).size === 3);
    const legacy = await (await get(enabled, "/capabilities", 200, token)).json(); check(!("checkpoint_directory_available" in legacy));
    const extended = await (await get(enabled, "/capabilities?include=checkpoint-directory", 200, token)).json();
    check(extended.checkpoint_directory_available === true && extended.checkpoints_available === false);
    await get(enabled, "/checkpoint-directory", 404, token, "POST");
  }
  await get(enabled, "/checkpoint-directory", 403, tokens[2]);
  await prisma.authSession.updateMany({ where: { user_id: owned[0] }, data: { revoked_at: new Date() } });
  await get(enabled, "/checkpoint-directory", 401, tokens[0]);
  check(JSON.stringify(before) === JSON.stringify(await counts()));
  console.log(JSON.stringify({ suite: "checkpoint_directory_real_mysql", result: "PASS", assertions,
    synthetic_records: 3, real_session_authorization: true, product_rows_unchanged: true,
    raw_research_dataset_used: false, live_checkpoints_enabled: config.checkpointsEnabled }));
} finally {
  for (const server of servers) { server.closeAllConnections(); await new Promise<void>(ok => server.close(() => ok())); }
  if (owned.length) await prisma.user.deleteMany({ where: { id: { in: owned } } });
  fixture.dispose(); await prisma.$disconnect();
}
