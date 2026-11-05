import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  auditEvent: { create: vi.fn() },
  notification: { create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  notificationPreference: { findUnique: vi.fn(), upsert: vi.fn() },
  pushDevice: { upsert: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");
const { config } = await import("../config.js");
const { FcmClient, classifyFailure, FCM_SCOPE } = await import("../services/fcmClient.js");
const { PushDispatcher, pushData } = await import("../services/pushDispatcher.js");
const { pushText } = await import("../services/pushText.js");
const { parsePushConfig } = await import("../lib/pushConfig.js");
const { startPushWorker } = await import("../lib/pushWorker.js");
const { signalPushDispatch, setPushDispatchHandler } = await import("../lib/pushSignal.js");
const { notify } = await import("../services/notifications.js");

const TOKEN = "fcm-token_abc:APA91bExampleTokenValue1234567890";
const OTHER_TOKEN = "fcm-token_other:APA91bAnotherTokenValue987654321";

const users: Record<string, { id: string; role: string; name: string; phone: string; demo_account: boolean }> = {
  passenger_1: { id: "passenger_1", role: "passenger", name: "P1", phone: "+1", demo_account: true },
  driver_1: { id: "driver_1", role: "driver", name: "D1", phone: "+3", demo_account: true }
};

function auth(id: keyof typeof users) {
  const token = jwt.sign({ role: users[id].role, sid: `session_${id}`, ver: 1 }, "test-only-jwt-secret-with-at-least-thirty-two-characters", {
    subject: id,
    expiresIn: "1h"
  });
  return { Authorization: `Bearer ${token}` };
}

function signedInMocks() {
  prismaMock.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => {
    const user = where.id ? users[where.id] : undefined;
    return user ? { ...user, account_status: "active", security_version: 1 } : null;
  });
  prismaMock.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
    const user = users[where.id.replace(/^session_/, "")];
    return user
      ? {
          id: where.id,
          user_id: user.id,
          user: { email_verified_at: new Date(), ...user, account_status: "active", security_version: 1 },
          security_version_at_issue: 1,
          expires_at: new Date(Date.now() + 60_000),
          revoked_at: null
        }
      : null;
  });
}

const keys = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" }
});

const serviceAccount = {
  projectId: "darb-test-project",
  clientEmail: "push-sender@darb-test-project.iam.gserviceaccount.com",
  privateKey: keys.privateKey,
  tokenUri: "https://oauth2.googleapis.com/token"
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  signedInMocks();
});

describe("push device registration API", () => {
  it("requires authentication", async () => {
    await request(createApp()).put("/api/v1/push/devices").send({ token: TOKEN, platform: "android" }).expect(401);
    await request(createApp()).get("/api/v1/push/preferences").expect(401);
  });

  it("registers the token for the caller and its session, idempotently", async () => {
    prismaMock.pushDevice.upsert.mockResolvedValue({ id: "pd1", platform: "android", locale: "ar", last_seen_at: new Date() });

    const response = await request(createApp())
      .put("/api/v1/push/devices")
      .set(auth("passenger_1"))
      .send({ token: TOKEN, platform: "android", app_version: "1.0.0+1", locale: "ar" })
      .expect(200);

    expect(response.body).toEqual({ device: { platform: "android", locale: "ar", registered: true }, push_available: false });
    // The token is write-only: it never comes back.
    expect(JSON.stringify(response.body)).not.toContain(TOKEN);
    const args = prismaMock.pushDevice.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ token: TOKEN });
    expect(args.create).toMatchObject({ token: TOKEN, user_id: "passenger_1", session_id: "session_passenger_1", platform: "android", app_version: "1.0.0+1", locale: "ar" });
    expect(args.update).toMatchObject({ user_id: "passenger_1", session_id: "session_passenger_1", revoked_at: null, revoke_reason: null });
  });

  it("moves a token to the account that registers it last", async () => {
    prismaMock.pushDevice.upsert.mockResolvedValue({ id: "pd1", platform: "android", locale: null, last_seen_at: new Date() });

    await request(createApp()).put("/api/v1/push/devices").set(auth("passenger_1")).send({ token: TOKEN, platform: "android" }).expect(200);
    await request(createApp()).put("/api/v1/push/devices").set(auth("driver_1")).send({ token: TOKEN, platform: "android" }).expect(200);

    // Same unique token both times; the update hands the row to the second account.
    const second = prismaMock.pushDevice.upsert.mock.calls[1][0];
    expect(second.where).toEqual({ token: TOKEN });
    expect(second.update).toMatchObject({ user_id: "driver_1", session_id: "session_driver_1" });
  });

  it("retries once when two registrations of a new token race on the unique index", async () => {
    prismaMock.pushDevice.upsert
      .mockRejectedValueOnce(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }))
      .mockResolvedValueOnce({ id: "pd1", platform: "ios", locale: null, last_seen_at: new Date() });

    await request(createApp()).put("/api/v1/push/devices").set(auth("passenger_1")).send({ token: TOKEN, platform: "ios" }).expect(200);
    expect(prismaMock.pushDevice.upsert).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["too short", { token: "short", platform: "android" }],
    ["bad characters", { token: "token with spaces and <script>abcdefgh", platform: "android" }],
    ["too long", { token: "a".repeat(513), platform: "android" }],
    ["unknown platform", { token: TOKEN, platform: "symbian" }],
    ["bad locale", { token: TOKEN, platform: "android", locale: "not a locale" }],
    ["unknown field", { token: TOKEN, platform: "android", user_id: "driver_1" }]
  ])("rejects a malformed registration (%s) without echoing the value", async (_label, body) => {
    const response = await request(createApp()).put("/api/v1/push/devices").set(auth("passenger_1")).send(body).expect(400);
    expect(response.body.error).toBe("validation_error");
    expect(JSON.stringify(response.body)).not.toContain(String(body.token));
    expect(prismaMock.pushDevice.upsert).not.toHaveBeenCalled();
  });

  it("keeps at most ten live tokens per account, retiring the least recently seen", async () => {
    prismaMock.pushDevice.upsert.mockResolvedValue({ id: "pd11", platform: "android", locale: null, last_seen_at: new Date() });
    prismaMock.pushDevice.findMany.mockResolvedValue([{ id: "pd_old_1" }, { id: "pd_old_2" }]);
    prismaMock.pushDevice.updateMany.mockResolvedValue({ count: 2 });

    await request(createApp()).put("/api/v1/push/devices").set(auth("passenger_1")).send({ token: TOKEN, platform: "android" }).expect(200);

    // Newest first, so every live token after the first ten is excess.
    expect(prismaMock.pushDevice.findMany).toHaveBeenCalledWith({
      where: { user_id: "passenger_1", revoked_at: null },
      orderBy: [{ last_seen_at: "desc" }, { id: "desc" }],
      skip: 10,
      select: { id: true }
    });
    expect(prismaMock.pushDevice.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["pd_old_1", "pd_old_2"] }, revoked_at: null },
      data: { revoked_at: expect.any(Date), revoke_reason: "device_limit" }
    });
  });

  it("revokes nothing when the account is within the limit", async () => {
    prismaMock.pushDevice.upsert.mockResolvedValue({ id: "pd1", platform: "android", locale: null, last_seen_at: new Date() });
    prismaMock.pushDevice.findMany.mockResolvedValue([]);
    await request(createApp()).put("/api/v1/push/devices").set(auth("passenger_1")).send({ token: TOKEN, platform: "android" }).expect(200);
    expect(prismaMock.pushDevice.updateMany).not.toHaveBeenCalled();
  });

  it("unregisters only the caller's own token, with the same answer either way", async () => {
    prismaMock.pushDevice.updateMany.mockResolvedValue({ count: 0 });

    const response = await request(createApp())
      .post("/api/v1/push/devices/unregister")
      .set(auth("driver_1"))
      .send({ token: OTHER_TOKEN })
      .expect(200);

    expect(response.body).toEqual({ ok: true });
    expect(prismaMock.pushDevice.updateMany).toHaveBeenCalledWith({
      where: { token: OTHER_TOKEN, user_id: "driver_1", revoked_at: null },
      data: { revoked_at: expect.any(Date), revoke_reason: "unregistered" }
    });
  });

  it("offers no endpoint that lists tokens", async () => {
    await request(createApp()).get("/api/v1/push/devices").set(auth("passenger_1")).expect(404);
  });

  it("defaults the push preference to on and stores changes per account", async () => {
    prismaMock.notificationPreference.findUnique.mockResolvedValue(null);
    const initial = await request(createApp()).get("/api/v1/push/preferences").set(auth("passenger_1")).expect(200);
    expect(initial.body).toEqual({ push_enabled: true, push_available: false });

    prismaMock.notificationPreference.upsert.mockResolvedValue({ push_enabled: false });
    const updated = await request(createApp())
      .put("/api/v1/push/preferences")
      .set(auth("passenger_1"))
      .send({ push_enabled: false })
      .expect(200);
    expect(updated.body).toEqual({ push_enabled: false, push_available: false });
    expect(prismaMock.notificationPreference.upsert).toHaveBeenCalledWith({
      where: { user_id: "passenger_1" },
      create: { user_id: "passenger_1", push_enabled: false },
      update: { push_enabled: false },
      select: { push_enabled: true }
    });

    await request(createApp()).put("/api/v1/push/preferences").set(auth("passenger_1")).send({ push_enabled: "no" }).expect(400);
  });

  it("reports push as available when the server is configured to send", async () => {
    prismaMock.notificationPreference.findUnique.mockResolvedValue({ push_enabled: true });
    const enabled = { ...config, push: { enabled: true as const, projectId: serviceAccount.projectId, serviceAccount } };
    const response = await request(createApp(enabled)).get("/api/v1/push/preferences").set(auth("passenger_1")).expect(200);
    expect(response.body.push_available).toBe(true);
  });
});

describe("FCM HTTP v1 client", () => {
  it("signs a service-account grant, caches the OAuth token and sends the v1 message", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url === serviceAccount.tokenUri) return json(200, { access_token: "ya29.test-access", expires_in: 3600 });
      return json(200, { name: "projects/darb-test-project/messages/1" });
    });
    const client = new FcmClient({ projectId: serviceAccount.projectId, serviceAccount, fetch });

    const message = { token: TOKEN, title: "Trip update", body: "The trip is now: Accepted", data: { notification_id: "n1", type: "trip_status" } };
    expect(await client.send(message)).toEqual({ kind: "sent" });
    expect(await client.send(message)).toEqual({ kind: "sent" });

    // One OAuth exchange for two sends.
    const oauth = calls.filter((call) => call.url === serviceAccount.tokenUri);
    expect(oauth).toHaveLength(1);
    const form = new URLSearchParams(String(oauth[0].init.body));
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const claims = jwt.verify(form.get("assertion")!, keys.publicKey, { algorithms: ["RS256"] }) as jwt.JwtPayload;
    expect(claims).toMatchObject({ iss: serviceAccount.clientEmail, scope: FCM_SCOPE, aud: serviceAccount.tokenUri });

    const sends = calls.filter((call) => call.url !== serviceAccount.tokenUri);
    expect(sends).toHaveLength(2);
    expect(sends[0].url).toBe("https://fcm.googleapis.com/v1/projects/darb-test-project/messages:send");
    expect(sends[0].init.method).toBe("POST");
    expect((sends[0].init.headers as Record<string, string>).authorization).toBe("Bearer ya29.test-access");
    expect(JSON.parse(String(sends[0].init.body))).toEqual({
      message: {
        token: TOKEN,
        notification: { title: "Trip update", body: "The trip is now: Accepted" },
        data: { notification_id: "n1", type: "trip_status" },
        android: { priority: "high" },
        apns: { headers: { "apns-priority": "10" }, payload: { aps: { sound: "default" } } }
      }
    });
  });

  it("refreshes the OAuth token once after a 401", async () => {
    let sends = 0;
    const fetch = vi.fn(async (url: string) => {
      if (url === serviceAccount.tokenUri) return json(200, { access_token: `token-${fetch.mock.calls.length}`, expires_in: 3600 });
      sends += 1;
      return sends === 1 ? json(401, { error: { status: "UNAUTHENTICATED" } }) : json(200, {});
    });
    const client = new FcmClient({ projectId: serviceAccount.projectId, serviceAccount, fetch });
    expect(await client.send({ token: TOKEN, title: "t", data: {} })).toEqual({ kind: "sent" });
    expect(fetch.mock.calls.filter(([url]) => url === serviceAccount.tokenUri)).toHaveLength(2);
  });

  it("classifies token errors as invalid and everything else as a plain failure", async () => {
    const fcmError = (errorCode: string) => ({
      error: { status: errorCode === "UNREGISTERED" ? "NOT_FOUND" : "INVALID_ARGUMENT", details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode }] }
    });
    const send = async (response: Response) => {
      const fetch = vi.fn(async (url: string) => (url === serviceAccount.tokenUri ? json(200, { access_token: "a", expires_in: 3600 }) : response));
      return new FcmClient({ projectId: serviceAccount.projectId, serviceAccount, fetch }).send({ token: TOKEN, title: "t", data: {} });
    };
    expect(await send(json(404, fcmError("UNREGISTERED")))).toEqual({ kind: "invalid_token", reason: "unregistered" });
    expect(await send(json(403, fcmError("SENDER_ID_MISMATCH")))).toEqual({ kind: "invalid_token", reason: "sender_id_mismatch" });
    expect(classifyFailure(400, { status: "INVALID_ARGUMENT", message: "The registration token is not a valid FCM registration token" }))
      .toEqual({ kind: "invalid_token", reason: "invalid_token" });
    expect(classifyFailure(400, { status: "INVALID_ARGUMENT", message: "Invalid JSON payload received." }).kind).toBe("failed");
    expect(await send(json(503, { error: { status: "UNAVAILABLE" } }))).toEqual({ kind: "failed", status: 503, reason: "unavailable" });
    const failed = await send(json(500, "not json"));
    expect(failed.kind).toBe("failed");
  });

  it("reports network failures without throwing or leaking credentials", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const result = await new FcmClient({ projectId: serviceAccount.projectId, serviceAccount, fetch }).send({ token: TOKEN, title: "t", data: {} });
    expect(result.kind).toBe("failed");
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});

describe("push dispatcher", () => {
  const now = new Date("2026-11-05T10:00:00Z");
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: "n1",
    user_id: "passenger_1",
    type: "trip_status",
    entity_type: "Trip",
    entity_id: "trip_1",
    params: { status: "accepted" },
    ...overrides
  });

  function dispatcher(sender: { send: ReturnType<typeof vi.fn> }) {
    return new PushDispatcher({ db: prismaMock as never, sender: sender as never, now: () => now });
  }

  beforeEach(() => {
    prismaMock.notification.findMany.mockResolvedValue([row()]);
    prismaMock.notification.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.notificationPreference.findUnique.mockResolvedValue(null);
    prismaMock.pushDevice.findMany.mockResolvedValue([
      { id: "pd1", token: TOKEN, locale: "en" },
      { id: "pd2", token: OTHER_TOKEN, locale: "ar" }
    ]);
    prismaMock.pushDevice.updateMany.mockResolvedValue({ count: 1 });
  });

  it("claims recent unpushed rows and sends localised text with a deep-link payload to live devices", async () => {
    const sender = { send: vi.fn(async () => ({ kind: "sent" as const })) };
    const result = await dispatcher(sender).runPass();

    expect(result).toEqual({ claimed: 1, sent: 2, revoked: 0, failed: 0, skipped: 0 });
    expect(prismaMock.notification.findMany.mock.calls[0][0].where).toEqual({
      push_attempted_at: null,
      created_at: { gte: new Date(now.getTime() - 10 * 60_000) }
    });
    expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({ where: { id: "n1", push_attempted_at: null }, data: { push_attempted_at: now } });
    // Only devices of an active account whose sign-in session is still live.
    expect(prismaMock.pushDevice.findMany.mock.calls[0][0].where).toEqual({
      user_id: "passenger_1",
      revoked_at: null,
      user: { account_status: "active" },
      session: { revoked_at: null, expires_at: { gt: now } }
    });
    const data = { notification_id: "n1", type: "trip_status", entity_type: "Trip", entity_id: "trip_1" };
    expect(sender.send).toHaveBeenCalledWith({ token: TOKEN, title: "Trip update", body: "The trip is now: Accepted", data });
    expect(sender.send).toHaveBeenCalledWith({ token: OTHER_TOKEN, title: "تحديث على الرحلة", body: "حالة الرحلة الآن: مقبول", data });
  });

  it("skips a row another instance claimed first", async () => {
    prismaMock.notification.updateMany.mockResolvedValue({ count: 0 });
    const sender = { send: vi.fn() };
    const result = await dispatcher(sender).runPass();
    expect(result.claimed).toBe(0);
    expect(sender.send).not.toHaveBeenCalled();
  });

  it("respects an account that turned push off", async () => {
    prismaMock.notificationPreference.findUnique.mockResolvedValue({ push_enabled: false });
    const sender = { send: vi.fn() };
    const result = await dispatcher(sender).runPass();
    expect(result).toMatchObject({ claimed: 1, skipped: 1, sent: 0 });
    expect(sender.send).not.toHaveBeenCalled();
    expect(prismaMock.pushDevice.findMany).not.toHaveBeenCalled();
  });

  it("revokes tokens FCM reports invalid and keeps going after other failures", async () => {
    const sender = {
      send: vi
        .fn()
        .mockResolvedValueOnce({ kind: "invalid_token", reason: "unregistered" })
        .mockResolvedValueOnce({ kind: "failed", reason: "unavailable", status: 503 })
    };
    const result = await dispatcher(sender).runPass();
    expect(result).toMatchObject({ sent: 0, revoked: 1, failed: 1 });
    expect(prismaMock.pushDevice.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.pushDevice.updateMany).toHaveBeenCalledWith({
      where: { id: "pd1", token: TOKEN, revoked_at: null },
      data: { revoked_at: now, revoke_reason: "fcm_unregistered" }
    });
  });

  it("never throws out of a pass, even when the database fails", async () => {
    prismaMock.notification.findMany.mockRejectedValue(new Error("db down"));
    const error = vi.fn();
    const pass = new PushDispatcher({ db: prismaMock as never, sender: { send: vi.fn() }, logger: { info: vi.fn(), error }, now: () => now });
    await expect(pass.runPass()).resolves.toMatchObject({ claimed: 0 });
    expect(error).toHaveBeenCalledWith({ event: "push_pass_failed", error_type: "Error" }, expect.any(String));
  });

  it("builds string-only data and text for every notification type", () => {
    expect(pushData(row({ entity_type: null, entity_id: null }) as never)).toEqual({ notification_id: "n1", type: "trip_status" });
    for (const type of [
      "match_offered", "match_accepted", "match_rejected", "trip_status", "driver_approaching",
      "driver_verification_approved", "driver_verification_rejected", "driver_documents_expiring",
      "driver_documents_expired", "driver_documents_renewal_submitted", "incident_updated", "merchant_order_expired", "match_withdrawn", "cancelled", "something_new"
    ]) {
      for (const locale of ["ar", "en-US", null]) {
        expect(pushText(type, {}, locale).title.length).toBeGreaterThan(0);
      }
    }
    expect(pushText("driver_documents_expiring", { kind: "licence", expires_on: "2026-12-01" }, "en").body).toBe(
      "Your Driving licence expires on 2026-12-01."
    );
    // "Pickup started" means the driver has set off, not that they are near.
    expect(pushText("driver_approaching", { reason: "pickup_started" }, "en")).toEqual({
      title: "Your driver is approaching",
      body: "Your driver has set off to your pickup point. Please get ready."
    });
    expect(pushText("driver_approaching", { reason: "pickup_started" }, "ar").body).toBe("انطلق سائقك إلى نقطة الانطلاق. يرجى الاستعداد.");
    expect(pushText("driver_approaching", { reason: "radius" }, "en").body).toBe("Your driver is near your pickup point. Please get ready.");
    expect(pushText("driver_approaching", { reason: "eta" }, "ar").body).toBe("سائقك قريب من نقطة الانطلاق. يرجى الاستعداد.");
    // A reviewer's free-text reason never goes to a lock screen.
    expect(pushText("driver_verification_rejected", { reason: "Blurry photo of the licence" }, "en").body).not.toContain("Blurry");
  });

  it("words cancellations for the person affected, in the device language", () => {
    const owner = { audience: "owner", kind: "ride" };
    expect(pushText("cancelled", { ...owner, by: "system", automatic: true, reason: "no_driver_in_time" }, "en")).toEqual({
      title: "Ride request cancelled",
      body: "No driver accepted it in time, so it was cancelled."
    });
    expect(pushText("cancelled", { ...owner, by: "system", automatic: true, reason: "no_driver_in_time" }, "ar")).toEqual({
      title: "تم إلغاء طلب الرحلة",
      body: "لم يقبله أي سائق في الوقت المحدد، لذلك أُلغي تلقائياً."
    });
    expect(pushText("cancelled", { ...owner, by: "driver", waiting: true, reason: "vehicle_problem" }, "en")).toEqual({
      title: "Your driver cancelled",
      body: "Your request is waiting for another driver."
    });
    expect(pushText("cancelled", { audience: "owner", kind: "parcel", by: "admin", reason: "safety_concern" }, "en")).toEqual({
      title: "Parcel cancelled",
      body: "Cancelled by the Darb team: Safety concern."
    });
    expect(pushText("cancelled", { audience: "driver", kind: "ride", by: "passenger", reason: "changed_plans" }, "en")).toEqual({
      title: "Trip cancelled",
      body: "The passenger cancelled this trip: Changed plans."
    });
    expect(pushText("cancelled", { audience: "driver", kind: "order", by: "merchant", reason: "wrong_details", partial: true }, "ar").title)
      .toBe("تمت إزالة طلب من رحلتك");
    // An unknown reason code never leaks as a raw code.
    expect(pushText("cancelled", { audience: "owner", kind: "order", by: "admin", reason: "zzz" }, "en").body).toBe("Cancelled by the Darb team: Other.");
  });
});

describe("push disabled (the default)", () => {
  afterEach(() => setPushDispatchHandler(undefined));

  it("is off in the default configuration and starts no worker", () => {
    expect(config.push).toEqual({ enabled: false });
    const logger = { info: vi.fn(), error: vi.fn() };
    expect(startPushWorker(config, logger as never)).toBeUndefined();
  });

  it("writes inbox rows without touching push when no sender is running", async () => {
    prismaMock.notification.create.mockResolvedValue({});
    const fetch = vi.spyOn(globalThis, "fetch");
    await notify(prismaMock as never, { userId: "passenger_1", type: "trip_status", dedupeKey: "k", params: { status: "accepted" } });
    expect(() => signalPushDispatch()).not.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(prismaMock.notification.findMany).not.toHaveBeenCalled();
    fetch.mockRestore();
  });

  it("asks the running sender for a pass after an inbox row is written", async () => {
    const kick = vi.fn();
    setPushDispatchHandler(kick);
    prismaMock.notification.create.mockResolvedValue({});
    await notify(prismaMock as never, { userId: "passenger_1", type: "trip_status", dedupeKey: "k" });
    expect(kick).toHaveBeenCalledTimes(1);

    // A duplicate (no new row) does not ask for a push.
    prismaMock.notification.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    await notify(prismaMock as never, { userId: "passenger_1", type: "trip_status", dedupeKey: "k" });
    expect(kick).toHaveBeenCalledTimes(1);
  });

  it("starts the worker only when enabled, and stops cleanly", () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    prismaMock.notification.findMany.mockResolvedValue([]);
    const worker = startPushWorker(
      { push: { enabled: true, projectId: serviceAccount.projectId, serviceAccount } },
      logger as never,
      { sender: { send: vi.fn() }, intervalMs: 60_000 }
    );
    expect(worker).toBeDefined();
    worker!.stop();
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("PRIVATE");
  });
});

describe("push configuration", () => {
  const parseBoolean = (name: string, value: string | undefined) => {
    if (value === undefined || value === "") return false;
    if (value === "true") return true;
    if (value === "false") return false;
    throw new Error(`${name} must be true or false`);
  };
  const keyJson = JSON.stringify({
    type: "service_account",
    project_id: serviceAccount.projectId,
    client_email: serviceAccount.clientEmail,
    private_key: keys.privateKey,
    token_uri: serviceAccount.tokenUri
  });

  it("is off unless explicitly enabled", () => {
    const problems: string[] = [];
    expect(parsePushConfig({}, problems, parseBoolean)).toEqual({ enabled: false });
    expect(parsePushConfig({ PUSH_NOTIFICATIONS_ENABLED: "false", FCM_SERVICE_ACCOUNT_JSON: keyJson }, problems, parseBoolean)).toEqual({ enabled: false });
    expect(problems).toEqual([]);
  });

  it("requires exactly one credential source when enabled", () => {
    const problems: string[] = [];
    parsePushConfig({ PUSH_NOTIFICATIONS_ENABLED: "true" }, problems, parseBoolean);
    parsePushConfig({ PUSH_NOTIFICATIONS_ENABLED: "true", FCM_SERVICE_ACCOUNT_JSON: keyJson, FCM_SERVICE_ACCOUNT_FILE: "/etc/darb/fcm.json" }, problems, parseBoolean);
    parsePushConfig({ PUSH_NOTIFICATIONS_ENABLED: "true", FCM_SERVICE_ACCOUNT_FILE: "relative/fcm.json" }, problems, parseBoolean);
    expect(problems).toEqual([
      "PUSH_NOTIFICATIONS_ENABLED requires FCM_SERVICE_ACCOUNT_JSON or FCM_SERVICE_ACCOUNT_FILE",
      "Set only one of FCM_SERVICE_ACCOUNT_JSON and FCM_SERVICE_ACCOUNT_FILE",
      "FCM_SERVICE_ACCOUNT_FILE must be an absolute path"
    ]);
  });

  it("accepts inline JSON, base64 JSON or a file, and never prints the key", () => {
    const problems: string[] = [];
    const inline = parsePushConfig({ PUSH_NOTIFICATIONS_ENABLED: "true", FCM_SERVICE_ACCOUNT_JSON: keyJson }, problems, parseBoolean);
    const base64 = parsePushConfig(
      { PUSH_NOTIFICATIONS_ENABLED: "true", FCM_SERVICE_ACCOUNT_JSON: Buffer.from(keyJson).toString("base64") },
      problems,
      parseBoolean
    );
    const file = parsePushConfig({ PUSH_NOTIFICATIONS_ENABLED: "true", FCM_SERVICE_ACCOUNT_FILE: "/etc/darb/fcm.json" }, problems, parseBoolean, () => keyJson);
    expect(problems).toEqual([]);
    for (const parsed of [inline, base64, file]) {
      expect(parsed).toMatchObject({ enabled: true, projectId: "darb-test-project" });
      expect(JSON.stringify(parsed)).not.toContain(keys.privateKey.slice(40, 80));
    }
  });

  it("rejects malformed keys and foreign token endpoints without echoing values", () => {
    const problems: string[] = [];
    const enabled = (json: string) => parsePushConfig({ PUSH_NOTIFICATIONS_ENABLED: "true", FCM_SERVICE_ACCOUNT_JSON: json }, problems, parseBoolean);
    expect(enabled("{not json")).toEqual({ enabled: false });
    expect(enabled(JSON.stringify({ project_id: "darb-test-project" }))).toEqual({ enabled: false });
    expect(enabled(keyJson.replace(serviceAccount.tokenUri, "https://attacker.example/token"))).toEqual({ enabled: false });
    expect(enabled(JSON.stringify({ ...JSON.parse(keyJson), private_key: "secret-but-not-pem" }))).toEqual({ enabled: false });
    expect(problems).toEqual([
      "FCM_SERVICE_ACCOUNT_JSON is not valid service-account JSON",
      "FCM_SERVICE_ACCOUNT_JSON is missing client_email, private_key",
      "FCM_SERVICE_ACCOUNT_JSON token_uri must be https://oauth2.googleapis.com/token",
      "FCM_SERVICE_ACCOUNT_JSON private_key is not a PEM private key"
    ]);
    expect(problems.join(" ")).not.toContain("secret-but-not-pem");

    const unreadable: string[] = [];
    parsePushConfig({ PUSH_NOTIFICATIONS_ENABLED: "true", FCM_SERVICE_ACCOUNT_FILE: "/missing/fcm.json" }, unreadable, parseBoolean, () => {
      throw new Error("ENOENT");
    });
    expect(unreadable).toEqual(["FCM_SERVICE_ACCOUNT_FILE could not be read"]);
  });
});
