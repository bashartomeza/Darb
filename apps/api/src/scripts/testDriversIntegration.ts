import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";

// Real-database check of the owner's test drivers: seed into the disposable database, sign a seeded driver in
// through the real login route with the password from the credentials file, and find that driver as a rider.
const databaseName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
assert(databaseName.endsWith("_ci"), "test-driver integration requires a disposable database ending in _ci");

const { createApp } = await import("../app.js");
const { prisma } = await import("../lib/prisma.js");
const { signAuthToken } = await import("../middleware/auth.js");
const { ensureIntegrationRoutes } = await import("./integrationRoutes.js");
const { removeTestDrivers, seedTestDrivers, testDriverSpecs } = await import("../services/testDriverSeed.js");

let assertions = 0;
function check(value: unknown, message: string) {
  assert(value, `test-driver integration failed: ${message}`);
  assertions += 1;
}

const directory = mkdtempSync(join(tmpdir(), "darb-test-drivers-"));
const file = join(directory, "credentials.txt");
const server = createServer(createApp());
let passengerId: string | undefined;

try {
  await ensureIntegrationRoutes(prisma);
  await removeTestDrivers(prisma, { dryRun: false });

  const dry = await seedTestDrivers(prisma, { dryRun: true, resetPasswords: false, force: false });
  check(dry.created === 20, "dry run reports twenty new drivers");
  check((await prisma.user.count({ where: { email: { endsWith: "@darb.ps" } } })) === 0, "dry run wrote nothing");

  const first = await seedTestDrivers(prisma, { dryRun: false, resetPasswords: false, force: false, credentialsFile: file, bcryptCost: 4 });
  check(first.created === 20 && first.routesCreated === 20 && first.passwordsWritten === 20, "first run creates 20 drivers with 20 routes");
  const again = await seedTestDrivers(prisma, { dryRun: false, resetPasswords: false, force: true, credentialsFile: file, bcryptCost: 4 });
  check(again.created === 0 && again.unchanged === 20 && again.routesCreated === 0 && again.passwordsWritten === 0, "second run changes nothing");

  const specs = testDriverSpecs();
  const lines = readFileSync(file, "utf8").trim().split("\n").map((line) => line.split(" | "));
  check(lines.length === 20, "credentials file has twenty lines");
  const activeRoutes = await prisma.driverRoute.findMany({
    where: { status: "active", driver: { user: { email: { in: specs.map((spec) => spec.email) } } } },
    include: { route_version: true, driver: { include: { user: true } } }
  });
  check(activeRoutes.length === 20, "exactly one active route per test driver");
  check(new Set(activeRoutes.map((route) => route.route_version?.service_route_id)).size === 20, "every predefined route has one driver");

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const passenger = await prisma.user.create({
    data: {
      name: "SYNTHETIC test-driver rider", role: "passenger", email: `rider_${randomUUID()}@example.invalid`, email_verified_at: new Date(),
      profile_state: "complete", account_status: "active", demo_account: true
    }
  });
  passengerId = passenger.id;
  const session = await prisma.authSession.create({
    data: { user_id: passenger.id, client_type: "mobile", security_version_at_issue: passenger.security_version, expires_at: new Date(Date.now() + 3_600_000) }
  });
  const riderToken = signAuthToken({ id: passenger.id, role: "passenger", sessionId: session.id, securityVersion: passenger.security_version });

  // Driver 1 (first route) and driver 20 (last route): log in with the file's password, then search as a rider.
  for (const index of [0, 19]) {
    const [email, password, routeKey] = lines[index]!;
    check(email === specs[index]!.email && routeKey === specs[index]!.routeKey, `file line ${index + 1} names the right driver and route`);
    const login = await request(server).post("/api/v1/auth/login").send({ email, password });
    check(login.status === 200 && typeof login.body.access_token === "string", `driver ${index + 1} signs in through the real login route`);
    check(login.body.user.role === "driver", "signed in as a driver");
    const wrong = await request(server).post("/api/v1/auth/login").send({ email, password: `${password}x` });
    check(wrong.status === 401, "a wrong password is refused");

    const route = await prisma.serviceRoute.findUniqueOrThrow({ where: { route_key: routeKey! } });
    const search = await request(server)
      .post("/api/v1/matches/search")
      .set("Authorization", `Bearer ${riderToken}`)
      .send({ service_route_id: route.id, preferred_time: new Date(Date.now() + 3_600_000).toISOString(), passenger_count: 1 });
    check(search.status === 200, `rider search on ${routeKey} succeeds`);
    const results = search.body.results as Array<{ id: string; service_route_id: string }>;
    const own = activeRoutes.find((candidate) => candidate.driver.user.email === email)!;
    check(results.some((result) => result.id === own.id && result.service_route_id === route.id), `rider search on ${routeKey} finds the test driver`);
  }

  const removed = await removeTestDrivers(prisma, { dryRun: false });
  check(removed.removed === 20 && removed.suspended === 0, "removal deletes the twenty test drivers");
  check((await prisma.user.count({ where: { email: { in: specs.map((spec) => spec.email) } } })) === 0, "no test driver remains");
  console.log(JSON.stringify({ ok: true, assertions }));
} finally {
  await removeTestDrivers(prisma, { dryRun: false }).catch(() => undefined);
  if (passengerId) {
    await prisma.authSession.deleteMany({ where: { user_id: passengerId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: passengerId } }).catch(() => undefined);
  }
  await new Promise<void>((resolve) => (server.listening ? server.close(() => resolve()) : resolve()));
  rmSync(directory, { recursive: true, force: true });
  await prisma.$disconnect();
}
