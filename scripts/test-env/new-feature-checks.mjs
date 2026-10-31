// API-level checks for the newer features, run against the live test API on the disposable masari_demo
// database: six-digit email codes, open driver/shop sign-up with "Send for review", route fares,
// passenger parcels, the delivery handover code, trust score and ratings, the AI assistant fallback,
// the approaching alert, driver document expiry, bulk merchant orders and the admin metrics.
//
// Called from run-checks.mjs (after a reset). It can also run on its own: node scripts/test-env/new-feature-checks.mjs
// (run scripts/test-env/reset-data.ps1 first).
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { root, env, results, http, check, must, latestOtp, latestEmailCode, powershellReset } from "./check-kit.mjs";

const adminLogin = () => loginAs("demo.admin@masari.app", env.DEMO_ADMIN_PASSWORD, "/auth/admin/login");
const resetData = () => powershellReset();

const tag = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (name) => `qa-${name}-${tag}-${Math.random().toString(36).slice(2, 8)}`;
const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

async function prismaClient() {
  const { prisma } = await import(pathToFileURL(resolve(root, "apps/api/dist/lib/prisma.js")).href);
  return prisma;
}

async function loginAs(email, password, path = "/auth/login") {
  const r = await http(path, { method: "POST", body: { email, password }, expect: 200 });
  return r.json.token;
}

// --- Section 1 and 2: email codes and open sign-up -----------------------------------------------------------
async function emailCodeChecks(admin) {
  const consentsFor = async () => (await http("/auth/consents?locale=en", { expect: 200 })).json.documents;
  const startRegistration = async (email, password) =>
    (await http("/auth/mobile/register/start", { method: "POST", body: { name: "QA Email", email, password, locale: "en" }, expect: 202 })).json;
  const complete = async (registrationToken, code) => {
    const consents = await consentsFor();
    return http("/auth/mobile/register/complete", {
      method: "POST",
      body: {
        registration_token: registrationToken, email_verification_code: code, locale: "en",
        consents: consents.map((c) => ({ id: c.id, type: c.type, content_hash: c.content_hash })), adult_self_attestation: true
      }
    });
  };

  const email = `qa.mail.${tag}@example.com`;
  const password = `Qa-email-pass-${tag}`;
  await check("C31", "email sign-up: the email carries a six-digit code and that code finishes the sign-up", async () => {
    const started = await startRegistration(email, password);
    const code = latestEmailCode(email, "email_verification");
    must(/^\d{6}$/.test(code ?? ""), `the emailed proof is not six digits: ${code}`);
    const done = await complete(started.registration_token, code);
    must(done.status === 201 && done.json.token, `complete gave ${done.status} ${JSON.stringify(done.json).slice(0, 100)}`);
    must(done.json.user.role === "passenger" && done.json.user.profile_state === "phone_required", `user ${JSON.stringify(done.json.user)}`);
    const again = await complete(started.registration_token, code);
    must(again.status === 400, `a used code gave ${again.status}`);
    const signedIn = await http("/auth/login", { method: "POST", body: { email, password }, expect: 200 });
    must(signedIn.json.token, "no sign-in after email sign-up");
  });

  await check("C32", "email sign-up: five wrong codes lock the attempt, even the right code is then refused", async () => {
    const lockEmail = `qa.lock.${tag}@example.com`;
    const started = await startRegistration(lockEmail, password);
    const code = latestEmailCode(lockEmail, "email_verification");
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i += 1) {
      const r = await complete(started.registration_token, wrong);
      must(r.status === 400, `wrong code ${i + 1} gave ${r.status}`);
    }
    const right = await complete(started.registration_token, code);
    must(right.status === 400, `right code after five wrong ones gave ${right.status}`);
    const none = await http("/auth/login", { method: "POST", body: { email: lockEmail, password } });
    must(none.status === 401, `account exists after a locked attempt (login ${none.status})`);
  });

  await check("C33", "a malformed code (not six digits) is refused before it is checked", async () => {
    const started = await startRegistration(`qa.shape.${tag}@example.com`, password);
    for (const bad of ["12345", "1234567", "abcdef", "12 345"]) {
      const r = await complete(started.registration_token, bad);
      must(r.status === 400, `"${bad}" gave ${r.status}`);
    }
  });

  await check("C34", "password reset: start answers the same for known and unknown emails; email + six-digit code sets the new password", async () => {
    const known = await http("/auth/password/reset/start", { method: "POST", body: { email, locale: "en" }, expect: 202 });
    const unknown = await http("/auth/password/reset/start", { method: "POST", body: { email: `qa.nobody.${tag}@example.com`, locale: "en" }, expect: 202 });
    must(JSON.stringify(known.json) === JSON.stringify({ ok: true }) && JSON.stringify(unknown.json) === JSON.stringify({ ok: true }), "reset start answer differs");
    await sleep(500);
    const code = latestEmailCode(email, "password_reset");
    must(/^\d{6}$/.test(code ?? ""), `reset proof is not six digits: ${code}`);
    must(latestEmailCode(`qa.nobody.${tag}@example.com`, "password_reset") === undefined, "an email was produced for an unknown address");
    const newPassword = `Qa-new-pass-${tag}-x`;
    const wrongCode = await http("/auth/password/reset/confirm", { method: "POST", body: { email, code: code === "000000" ? "111111" : "000000", password: newPassword } });
    must(wrongCode.status === 400, `wrong reset code gave ${wrongCode.status}`);
    const ok = await http("/auth/password/reset/confirm", { method: "POST", body: { email, code, password: newPassword } });
    must(ok.status === 200, `reset confirm gave ${ok.status} ${JSON.stringify(ok.json).slice(0, 100)}`);
    must((await http("/auth/login", { method: "POST", body: { email, password } })).status === 401, "the old password still works");
    must((await http("/auth/login", { method: "POST", body: { email, password: newPassword } })).status === 200, "the new password does not work");
    const reuse = await http("/auth/password/reset/confirm", { method: "POST", body: { email, code, password: `${newPassword}-2` } });
    must(reuse.status === 400, `a used reset code gave ${reuse.status}`);
  });

  await check("C35", "password reset: five wrong codes lock the reset, the right code then fails", async () => {
    await http("/auth/password/reset/start", { method: "POST", body: { email, locale: "en" }, expect: 202 });
    await sleep(500);
    const code = latestEmailCode(email, "password_reset");
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i += 1) {
      const r = await http("/auth/password/reset/confirm", { method: "POST", body: { email, code: wrong, password: `Qa-other-pass-${tag}` } });
      must(r.status === 400, `wrong reset code ${i + 1} gave ${r.status}`);
    }
    const right = await http("/auth/password/reset/confirm", { method: "POST", body: { email, code, password: `Qa-other-pass-${tag}` } });
    must(right.status === 400, `right code after five wrong ones gave ${right.status}`);
  });
}

// Open sign-up helpers (no invitation code).
async function openSignUp({ role, phone, name, invitationCode }) {
  const consents = (await http("/onboarding/consents?locale=en", { expect: 200 })).json.documents;
  const body = { role, phone, locale: "en" };
  if (invitationCode) body.invitation_code = invitationCode;
  else body.email = `qa.open.${phone.slice(-4)}@example.com`;
  const started = (await http("/onboarding/attempts", { method: "POST", headers: { "idempotency-key": key("start") }, body, expect: 201 })).json;
  const continuation = `Onboarding ${started.onboarding_token}`;
  await sleep(400);
  const wrong = await http(`/onboarding/attempts/${started.attempt.id}/verify`, { method: "POST", token: continuation, headers: { "idempotency-key": key("wrong") }, body: { otp: "000000" } });
  const verified = (await http(`/onboarding/attempts/${started.attempt.id}/verify`, { method: "POST", token: continuation, headers: { "idempotency-key": key("ok") }, body: { otp: latestOtp(phone) }, expect: 200 })).json;
  const password = `Qa-long-passphrase-${phone.slice(-4)}`;
  const done = (await http(`/onboarding/attempts/${started.attempt.id}/complete`, {
    method: "POST", token: continuation, headers: { "idempotency-key": key("done") },
    body: { registration_grant: verified.registration_grant, display_name: name, password, locale: "en", adult_self_attestation: true, consents: consents.map((c) => ({ id: c.id, type: c.type, content_hash: c.content_hash })) },
    expect: 201
  })).json;
  return { wrongStatus: wrong.status, done, password, token: `Onboarding ${done.onboarding_status_token}` };
}
const uploadDriverDoc = (token, kind, bytes, expect) =>
  http(`/onboarding/driver-documents?kind=${kind}`, { method: "POST", token, raw: bytes, headers: { "content-type": "application/octet-stream" }, expect });

async function openSignupChecks(admin) {
  const phone = `+97059005${String(Date.now()).slice(-4)}`;
  let applicant;
  await check("C36", "open sign-up: a driver registers without an invitation code and is told to upload documents", async () => {
    applicant = await openSignUp({ role: "driver", phone, name: "QA Open Driver" });
    must(applicant.wrongStatus >= 400, "wrong phone code accepted");
    must(applicant.done.account_status === "pending", `status ${applicant.done.account_status}`);
    const status = await http("/onboarding/status", { token: applicant.token, expect: 200 });
    must(status.json.onboarding_status === "documents_required", `status ${status.json.onboarding_status}`);
  });
  await check("C37,F08", "'Send for review' is refused (409 documents_required) until every required document is uploaded", async () => {
    const none = await http("/onboarding/application/submit", { method: "POST", token: applicant.token });
    must(none.status === 409 && none.json.error === "documents_required" && none.json.missing_documents.length === 3, `no documents: ${none.status} ${JSON.stringify(none.json).slice(0, 120)}`);
    await uploadDriverDoc(applicant.token, "driver_licence", jpeg, 201);
    await uploadDriverDoc(applicant.token, "vehicle_registration", pdf, 201);
    const partial = await http("/onboarding/application/submit", { method: "POST", token: applicant.token });
    must(partial.status === 409 && partial.json.missing_documents.length === 1, `two documents: ${partial.status} ${JSON.stringify(partial.json).slice(0, 120)}`);
  });
  await check("F09", "a passenger cannot register through the open driver/shop sign-up (no invitation code)", async () => {
    const r = await http("/onboarding/attempts", { method: "POST", headers: { "idempotency-key": key("passenger-open") }, body: { role: "passenger", phone: `+97059005${String(Date.now()).slice(-4)}`, email: `qa.pass.${tag}@example.com`, locale: "en" } });
    must(r.status >= 400 && r.status < 500, `passenger sign-up without a code gave ${r.status}`);
  });
  await check("C38","admin approval is blocked before the application is submitted", async () => {
    const list = await http("/admin/driver-verifications?status=pending", { token: admin, expect: 200 });
    must(!list.json.verifications.some((x) => x.candidate.phone === phone), "an unsubmitted application is in the review queue");
    const users = await http(`/admin/users?search=${encodeURIComponent(phone)}`, { token: admin, expect: 200 });
    const user = users.json.users.find((u) => u.phone === phone);
    must(user, "the applicant is not found in Users");
    const detail = await http(`/admin/driver-verifications/${user.id}`, { token: admin, expect: 200 });
    const body = { expected_revision: detail.json.verification.revision, profile: { vehicle_type: "sedan", seats_total: 4, parcel_capacity: 4 } };
    const approve = await http(`/admin/driver-verifications/${user.id}/approve`, { method: "POST", token: admin, body });
    must(approve.status === 409 && approve.json.error === "application_not_submitted", `approve before submit gave ${approve.status} ${JSON.stringify(approve.json).slice(0, 100)}`);
    const reject = await http(`/admin/driver-verifications/${user.id}/reject`, { method: "POST", token: admin, body: { expected_revision: body.expected_revision, reason: "QA reject before submit" } });
    must(reject.status === 409 && reject.json.error === "application_not_submitted", `reject before submit gave ${reject.status}`);
    const login = await http("/auth/mobile/login", { method: "POST", body: { phone, password: applicant.password } });
    must([401, 403].includes(login.status), `unsubmitted applicant signed in: ${login.status}`);
  });
  await check("C39", "after the national ID is added 'Send for review' is accepted and the driver reaches the admin queue", async () => {
    await uploadDriverDoc(applicant.token, "national_id", jpeg, 201);
    const sent = await http("/onboarding/application/submit", { method: "POST", token: applicant.token, expect: 200 });
    must(sent.json.onboarding_status === "pending_review", `status ${sent.json.onboarding_status}`);
    const again = await http("/onboarding/application/submit", { method: "POST", token: applicant.token, expect: 200 });
    must(again.json.onboarding_status === "pending_review", "second submit not idempotent");
    const status = await http("/onboarding/status", { token: applicant.token, expect: 200 });
    must(status.json.onboarding_status === "pending_review", `status ${status.json.onboarding_status}`);
    const list = await http("/admin/driver-verifications?status=pending", { token: admin, expect: 200 });
    const v = list.json.verifications.find((x) => x.candidate.phone === phone);
    must(v && v.evidence.documents.length === 3, `admin sees ${v?.evidence.documents.length} documents`);
    applicant.verification = v;
  });
}

// --- Section 3 and 4: route fares and passenger parcels -------------------------------------------------------
// The admin builds one published route with three stops; nothing here depends on seeded data.
async function createPublishedRoute(admin) {
  const stops = [];
  for (const [i, name] of ["Alpha", "Bravo", "Charlie"].entries()) {
    const r = await http("/admin/stops", {
      method: "POST", token: admin, headers: { "idempotency-key": key("stop") },
      body: { stop_key: `qa-${tag}-${name.toLowerCase()}`, service_region_key: `qa-${tag}`, name_ar: `محطة ${name}`, name_en: `QA ${name} ${tag}`, latitude: 31.9 + i * 0.05, longitude: 35.2 + i * 0.05 },
      expect: 201
    });
    stops.push(r.json.stop ?? r.json);
  }
  const route = (await http("/admin/service-routes", {
    method: "POST", token: admin, headers: { "idempotency-key": key("route") },
    body: { route_key: `qa-route-${tag}`, route_group_key: `qa-group-${tag}`, service_region_key: `qa-${tag}`, direction: "outbound" }, expect: 201
  })).json.route;
  const version = (await http(`/admin/service-routes/${route.id}/versions`, {
    method: "POST", token: admin, headers: { "idempotency-key": key("version") },
    body: { name_ar: "مسار تجريبي", name_en: `QA route ${tag}` }, expect: 201
  })).json.version;
  const flags = [[true, false], [true, true], [false, true]];
  const stopsBody = stops.map((stop, i) => ({
    stop_id: stop.id, sequence: i + 1, passenger_pickup_allowed: flags[i][0], passenger_dropoff_allowed: flags[i][1],
    parcel_pickup_allowed: flags[i][0], parcel_dropoff_allowed: flags[i][1], estimated_offset_seconds: i * 900, dwell_seconds: 60
  }));
  const put = await http(`/admin/route-versions/${version.id}/stops`, { method: "PUT", token: admin, body: { expected_revision: version.draft_revision, stops: stopsBody }, expect: 200 });
  const draft = put.json.version ?? version;
  await http(`/admin/route-versions/${version.id}/publish`, {
    method: "POST", token: admin, headers: { "idempotency-key": key("publish") },
    body: { expected_revision: draft.draft_revision ?? version.draft_revision + 1, expected_current_version_id: null }, expect: 200
  });
  return { routeId: route.id, versionId: version.id, stops };
}

const makeWindow = (minutesAhead = 40) => {
  const from = new Date(Date.now() + minutesAhead * 60_000);
  return { requested_departure_from: from.toISOString(), requested_departure_until: new Date(from.getTime() + 60 * 60_000).toISOString() };
};

// One fixed window, so a retry with the same idempotency key carries exactly the same body.
const FIXED_WINDOW = makeWindow();
let sharedRoute;
async function routeFareChecks(admin) {
  let passenger;
  await check("E14", "route setup: the admin builds and publishes a route with three stops", async () => {
    sharedRoute = await createPublishedRoute(admin);
    passenger = await loginAs("demo.passenger@masari.app", env.DEMO_PASSENGER_PASSWORD);
    const list = await http("/routes", { token: passenger, expect: 200 });
    must(list.json.routes.some((r) => JSON.stringify(r).includes(sharedRoute.versionId)), "the published route is not in the public catalogue");
  });
  const fareUrl = () => `/admin/service-routes/${sharedRoute.routeId}/fares`;
  await check("E15", "route fares: admin sets seat and parcel fares; they need a reason and an admin; bad amounts and no-ops are refused", async () => {
    const empty = await http(fareUrl(), { token: admin, expect: 200 });
    must(empty.json.current.passenger_seat === null && empty.json.display_only === true, "a new route already has a fare");
    const change = (changes, reason = "QA tariff") => http(fareUrl(), { method: "PUT", token: admin, body: { changes, reason } });
    must((await http(fareUrl(), { method: "PUT", token: passenger, body: { changes: [{ item: "passenger_seat", amount_minor: 1500 }], reason: "x tariff" } })).status === 403, "a passenger changed fares");
    must((await change([{ item: "passenger_seat", amount_minor: 0 }])).status === 400, "amount 0 accepted");
    must((await change([{ item: "passenger_seat", amount_minor: 12.5 }])).status === 400, "fractional amount accepted");
    must((await change([{ item: "passenger_seat", amount_minor: 1500 }], "no")).status === 400, "a too-short reason was accepted");
    const ok = await change([{ item: "passenger_seat", amount_minor: 1500 }, { item: "parcel_s", amount_minor: 700 }, { item: "parcel_m", amount_minor: 900 }]);
    must(ok.status === 200 || ok.status === 201, `set fares gave ${ok.status} ${JSON.stringify(ok.json).slice(0, 120)}`);
    must(ok.json.current.passenger_seat.amount_minor === 1500 && ok.json.current.parcel_s.amount_minor === 700, "fares not stored");
    must((await change([{ item: "passenger_seat", amount_minor: 1500 }])).status === 409, "an unchanged fare was not refused");
    const history = await http(fareUrl(), { token: admin, expect: 200 });
    must(history.json.history.length === 3 && history.json.history[0].created_by?.name, "history incomplete");
  });
  const passengerBody = (count) => ({ route_version_id: sharedRoute.versionId, pickup_stop_id: sharedRoute.stops[0].id, dropoff_stop_id: sharedRoute.stops[2].id, ...FIXED_WINDOW, passenger_count: count });
  await check("E16", "the route catalogue and the passenger request show the fare; the request freezes it", async () => {
    const list = await http("/routes", { token: passenger, expect: 200 });
    const entry = list.json.routes.find((r) => JSON.stringify(r).includes(sharedRoute.versionId));
    must(entry?.fares?.passenger_seat_minor === 1500 && entry.fares.estimated === true && entry.fares.paid_directly_to_driver === true, `catalogue fares ${JSON.stringify(entry?.fares)}`);
    const k1 = key("fare-req");
    const first = await http("/passenger/route-requests", { method: "POST", token: passenger, headers: { "idempotency-key": k1 }, body: passengerBody(2), expect: 201 });
    must(first.json.request.fare.unit_minor === 1500 && first.json.request.fare.total_minor === 3000, `fare ${JSON.stringify(first.json.request.fare)}`);
    // Tariff change afterwards: the earlier request keeps 15.00, a new one gets the new price.
    await http(fareUrl(), { method: "PUT", token: admin, body: { changes: [{ item: "passenger_seat", amount_minor: 2000 }], reason: "QA tariff change" }, expect: [200, 201] });
    const replay = await http("/passenger/route-requests", { method: "POST", token: passenger, headers: { "idempotency-key": k1 }, body: passengerBody(2), expect: 200 });
    must(replay.json.replayed === true && replay.json.request.fare.unit_minor === 1500 && replay.json.request.fare.total_minor === 3000, `replayed fare changed to ${JSON.stringify(replay.json.request.fare)}`);
    const second = await http("/passenger/route-requests", { method: "POST", token: passenger, headers: { "idempotency-key": key("fare-req2") }, body: passengerBody(1), expect: 201 });
    must(second.json.request.fare.unit_minor === 2000, `a new request got ${JSON.stringify(second.json.request.fare)}`);
    const prisma = await prismaClient();
    const row = await prisma.passengerRequest.findUnique({ where: { id: first.json.request.id } });
    must(row.fare_unit_minor === 1500 && row.fare_total_minor === 3000, `stored fare ${row.fare_unit_minor}/${row.fare_total_minor}`);
  });
}

const parcelBody = (over = {}) => ({
  route_version_id: sharedRoute.versionId, pickup_stop_id: sharedRoute.stops[0].id, dropoff_stop_id: sharedRoute.stops[2].id, ...FIXED_WINDOW,
  size: "S", note: "Birthday present", receiver_name: "QA Receiver", receiver_phone: "+970590007777", forbidden_items_acknowledged: true, ...over
});
async function passengerParcelChecks(admin) {
  // A dedicated passenger so the limits below start from zero.
  const email = `qa.parcel.${tag}@example.com`;
  const password = `Qa-parcel-pass-${tag}`;
  const started = (await http("/auth/mobile/register/start", { method: "POST", body: { name: "QA Parcel Sender", email, password, locale: "en" }, expect: 202 })).json;
  const consents = (await http("/auth/consents?locale=en", { expect: 200 })).json.documents;
  const done = await http("/auth/mobile/register/complete", { method: "POST", body: { registration_token: started.registration_token, email_verification_code: latestEmailCode(email, "email_verification"), locale: "en", consents: consents.map((c) => ({ id: c.id, type: c.type, content_hash: c.content_hash })), adult_self_attestation: true } });
  if (done.status !== 201) throw new Error(`parcel sender sign-up gave ${done.status}`);
  // Passenger parcels need a verified phone on the sender profile.
  const senderPhone = `+97059006${String(Date.now()).slice(-4)}`;
  const phoneStart = await http("/profile/phone/start-verification", { method: "POST", token: done.json.token, body: { phone: senderPhone, locale: "en" }, expect: 202 });
  await sleep(300);
  await http("/profile/phone/confirm-verification", { method: "POST", token: done.json.token, body: { action_token: phoneStart.json.action_token, phone: senderPhone, code: latestOtp(senderPhone) }, expect: 200 });
  const sender = await loginAs(email, password);
  const post = (body, k = key("parcel"), token = sender) => http("/passenger/parcels", { method: "POST", token, headers: { "idempotency-key": k }, body });
  const created = [];

  await check("E17", "passenger parcel: limits are published and a valid parcel is created (receiver phone masked, idempotent)", async () => {
    const limits = await http("/passenger/parcels/limits", { token: sender, expect: 200 });
    must(limits.json.limits.maximum_open === 3 && !limits.json.limits.allowed_sizes.includes("L"), `limits ${JSON.stringify(limits.json)}`);
    const k = key("parcel-idem");
    const first = await post(parcelBody(), k);
    must(first.status === 201, `create gave ${first.status} ${JSON.stringify(first.json).slice(0, 140)}`);
    const parcel = first.json.parcel;
    created.push(parcel.id);
    must(parcel.tracking_state && parcel.size === "S" && parcel.can_cancel === true, `parcel ${JSON.stringify(parcel).slice(0, 160)}`);
    must(parcel.receiver_phone_masked && !parcel.receiver_phone_masked.includes("590007777") && !("receiver_phone" in parcel), `receiver phone leaked: ${parcel.receiver_phone_masked}`);
    const replay = await post(parcelBody(), k);
    must(replay.status === 200 && replay.json.replayed === true && replay.json.parcel.id === parcel.id, `replay gave ${replay.status}`);
    const other = await post(parcelBody({ size: "M" }), k);
    must(other.status === 409, `same key, different body gave ${other.status}`);
    const list = await http("/passenger/parcels", { token: sender, expect: 200 });
    must(list.json.parcels.length === 1, `list has ${list.json.parcels.length} parcels (a replay created a second)`);
    must((await post(parcelBody({ note: "x" }), "short")).status === 400, "a short idempotency key was accepted");
  });
  await check("E18", "passenger parcel: large size, short phone, missing acknowledgement and bad stops are refused", async () => {
    must((await post(parcelBody({ size: "L" }))).status === 400, "size L accepted");
    must((await post(parcelBody({ receiver_phone: "123" }))).status === 400, "short phone accepted");
    must((await post(parcelBody({ forbidden_items_acknowledged: false }))).status === 400, "unticked box accepted");
    const { forbidden_items_acknowledged, ...without } = parcelBody();
    must((await post(without)).status === 400, "missing acknowledgement accepted");
    must((await post(parcelBody({ pickup_stop_id: sharedRoute.stops[2].id, dropoff_stop_id: sharedRoute.stops[0].id }))).status >= 400, "drop-off before pickup accepted");
    must((await post(parcelBody({ receiver_name: "Q" }))).status === 400, "one-letter receiver name accepted");
    must((await post({ ...parcelBody(), fare_minor: 1 })).status === 400, "unknown field accepted");
  });
  await check("E19", "passenger parcel: roles and privacy - other users cannot read it; the admin list has no receiver data", async () => {
    const id = created[0];
    const mine = await http(`/passenger/parcels/${id}`, { token: sender, expect: 200 });
    must(mine.json.parcel.receiver_name === "QA Receiver", "the sender cannot see the receiver name");
    const stranger = await loginAs("demo.passenger@masari.app", env.DEMO_PASSENGER_PASSWORD);
    must((await http(`/passenger/parcels/${id}`, { token: stranger })).status === 404, "another passenger can read the parcel");
    must((await http(`/passenger/parcels/${id}/cancel`, { method: "PATCH", token: stranger })).status === 404, "another passenger can cancel it");
    must((await http("/passenger/parcels", { token: await loginAs("demo.driver@masari.app", env.DEMO_DRIVER_PASSWORD) })).status === 403, "a driver reached passenger parcels");
    must((await http("/passenger/parcels", { token: await loginAs("demo.merchant@masari.app", env.DEMO_MERCHANT_PASSWORD) })).status === 403, "a merchant reached passenger parcels");
    must((await http("/passenger/parcels", {})).status === 401, "anonymous reached passenger parcels");
    const adminList = await http("/admin/passenger-parcels", { token: admin, expect: 200 });
    const text = JSON.stringify(adminList.json);
    must(adminList.json.parcels.length >= 1, "admin list is empty");
    must(!text.includes("QA Receiver") && !text.includes("590007777") && !text.includes("Birthday present"), "receiver name, phone or note leaked to the admin list");
    must((await http("/admin/passenger-parcels", { token: sender })).status === 403, "a passenger opened the admin parcel list");
  });
  await check("E20", "passenger parcel: a fourth parcel in flight is refused", async () => {
    for (let i = 0; i < 2; i += 1) {
      const r = await post(parcelBody({ receiver_name: `QA Receiver ${i}` }));
      must(r.status === 201, `parcel ${i + 2} gave ${r.status} ${JSON.stringify(r.json).slice(0, 100)}`);
      created.push(r.json.parcel.id);
    }
    const fourth = await post(parcelBody());
    must(fourth.status === 409 && fourth.json.error === "passenger_parcel_limit_reached", `4th parcel gave ${fourth.status} ${fourth.json?.error}`);
  });
  await check("E21", "passenger parcel: cancelling erases the receiver data and frees a slot; cancelling twice is refused", async () => {
    const cancelled = await http(`/passenger/parcels/${created[0]}/cancel`, { method: "PATCH", token: sender, expect: 200 });
    const parcel = cancelled.json.parcel;
    must(parcel.receiver_details_removed === true && parcel.receiver_name === null && parcel.receiver_phone_masked === null && parcel.note === null, `receiver data kept: ${JSON.stringify(parcel).slice(0, 200)}`);
    must(String(parcel.tracking_state).includes("cancel"), `tracking ${parcel.tracking_state}`);
    must((await http(`/passenger/parcels/${created[0]}/cancel`, { method: "PATCH", token: sender })).status === 409, "second cancel not refused");
    const again = await post(parcelBody());
    must(again.status === 201, `after a cancel the slot was not freed: ${again.status}`);
    created.push(again.json.parcel.id);
  });
  await check("E22", "passenger parcel: the sender's handover code can be issued once and is never readable afterwards", async () => {
    const id = created[1];
    const state = await http(`/parcel-orders/${id}/handover`, { token: sender, expect: 200 });
    must(state.json.handover.issued === true && !("code" in state.json.handover) && !JSON.stringify(state.json).includes("digest"), `state ${JSON.stringify(state.json)}`);
    const regenerated = await http(`/parcel-orders/${id}/handover/regenerate`, { method: "POST", token: sender, body: {}, expect: 200 });
    must(/^\d{6}$/.test(regenerated.json.handover.code), "no six-digit code returned");
    const reread = await http(`/parcel-orders/${id}/handover`, { token: sender, expect: 200 });
    must(!JSON.stringify(reread.json).includes(regenerated.json.handover.code), "the code is readable after issuing");
    const stranger = await loginAs("demo.passenger@masari.app", env.DEMO_PASSENGER_PASSWORD);
    must((await http(`/parcel-orders/${id}/handover`, { token: stranger })).status === 404, "a stranger read the handover state");
    must((await http(`/parcel-orders/${id}/handover/regenerate`, { method: "POST", token: stranger, body: {} })).status === 404, "a stranger regenerated the code");
    const asAdmin = await http(`/parcel-orders/${id}/handover/regenerate`, { method: "POST", token: admin, body: {} });
    must(asAdmin.status === 403, `admin regenerate gave ${asAdmin.status}`);
  });
}

// --- Section 10: bulk merchant orders ------------------------------------------------------------------------
// A fresh shop owner (open sign-up, documents, admin approval) so the hourly upload limits start from zero.
async function freshMerchant(admin) {
  const phone = `+97059008${String(Date.now()).slice(-4)}`;
  const shop = await openSignUp({ role: "merchant", phone, name: "QA Bulk Shop" });
  const upload = (kind, bytes) => http(`/onboarding/merchant-documents?kind=${kind}`, { method: "POST", token: shop.token, raw: bytes, headers: { "content-type": "application/octet-stream" }, expect: 201 });
  await upload("commercial_register", jpeg);
  await upload("national_id", jpeg);
  await upload("shop_photo", pdf);
  await http("/onboarding/application/submit", { method: "POST", token: shop.token, expect: 200 });
  const users = await http(`/admin/users?search=${encodeURIComponent(phone)}`, { token: admin, expect: 200 });
  const id = users.json.users.find((u) => u.phone === phone).id;
  await http(`/admin/merchant-approvals/${id}/approve`, { method: "POST", token: admin, body: {}, expect: 200 });
  const signedIn = await http("/auth/mobile/login", { method: "POST", body: { phone, password: shop.password }, expect: 200 });
  return { token: signedIn.json.token, id, phone };
}

const CSV_HEADER = "order_ref,pickup_label,pickup_lat,pickup_lng,destination_label,destination_lat,destination_lng,size,priority";
const csvRow = (ref, i, size = "S") => `${ref},QA Shop,31.5326,35.0998,Customer ${i},${(31.70 + i * 0.001).toFixed(4)},35.2024,${size},normal`;

async function bulkOrderChecks(admin) {
  const shop = await freshMerchant(admin);
  const merchant = shop.token;
  const orderCount = async () => (await http("/merchant/orders", { token: merchant, expect: 200 })).json.orders.length;
  const valid = [CSV_HEADER, csvRow("A", 1), csvRow("A", 2, "M"), csvRow("B", 3), csvRow("", 4)].join("\n");
  const bulk = (csv, k, extra = {}) => http("/merchant/orders/bulk", { method: "POST", token: merchant, headers: k ? { "idempotency-key": k } : {}, body: { csv, ...extra } });

  await check("E23", "bulk orders: only a shop owner may use them; a preview validates rows and writes nothing", async () => {
    must((await http("/merchant/orders/bulk/preview", { method: "POST", token: await loginAs("demo.passenger@masari.app", env.DEMO_PASSENGER_PASSWORD), body: { csv: valid } })).status === 403, "a passenger previewed a bulk upload");
    must((await http("/merchant/orders/bulk/preview", { method: "POST", body: { csv: valid } })).status === 401, "anonymous preview");
    const before = await orderCount();
    const preview = await http("/merchant/orders/bulk/preview", { method: "POST", token: merchant, body: { csv: `${valid}\n,QA Shop,31.5,35.1,Bad row,31.7,35.2,Q,normal` }, expect: 200 });
    must(preview.json.total_rows === 5 && preview.json.valid_order_count === 3 && preview.json.error_count === 1, `preview ${JSON.stringify(preview.json).slice(0, 220)}`);
    must(preview.json.errors[0].row === 6 && preview.json.errors[0].code === "row_invalid_size" && preview.json.errors[0].message_ar, `error ${JSON.stringify(preview.json.errors[0])}`);
    must(preview.json.batch_plan.batches.length >= 1, "no batch plan");
    must((await orderCount()) === before, "a preview created orders");
  });
  const uploadKey = key("bulk");
  await check("E24", "bulk orders: Idempotency-Key is required; invalid rows block the upload unless skipped", async () => {
    must((await bulk(valid, undefined)).status === 400, "upload without Idempotency-Key accepted");
    const bad = `${valid}\n,QA Shop,31.5,35.1,Bad row,31.7,35.2,Q,normal`;
    const blocked = await bulk(bad, key("bulk-bad"));
    must(blocked.status === 400 && blocked.json.error === "bulk_validation_failed", `invalid file gave ${blocked.status}`);
    must((await orderCount()) === 0, "orders were created by a rejected upload");
  });
  await check("E25", "bulk orders: a valid upload creates one order per group; retrying it creates nothing twice", async () => {
    const first = await bulk(valid, uploadKey);
    must(first.status === 201 && first.json.summary.created === 3 && first.json.summary.failed === 0, `first ${first.status} ${JSON.stringify(first.json.summary)}`);
    must((await orderCount()) === 3, "wrong order count after upload");
    const retry = await bulk(valid, uploadKey);
    must(retry.status === 200 && retry.json.summary.created === 0 && retry.json.summary.replayed === 3, `retry ${retry.status} ${JSON.stringify(retry.json.summary)}`);
    must(retry.json.results.every((r) => r.status === "replayed") && retry.json.results.map((r) => r.order_id).join() === first.json.results.map((r) => r.order_id).join(), "retry returned different orders");
    must((await orderCount()) === 3, "the retry created more orders");
    const skip = await bulk(`${valid}\n,QA Shop,31.5,35.1,Bad row,31.7,35.2,Q,normal`, key("bulk-skip"), { skip_invalid: true });
    must(skip.status === 201 && skip.json.summary.created === 3 && skip.json.summary.failed === 1, `skip_invalid ${skip.status} ${JSON.stringify(skip.json.summary)}`);
  });
  await check("E26", "bulk orders: 51 rows are rejected as a whole and nothing is created", async () => {
    const before = await orderCount();
    const rows = Array.from({ length: 51 }, (_, i) => csvRow("", i + 1));
    const tooMany = await bulk([CSV_HEADER, ...rows].join("\n"), key("bulk-51"));
    must(tooMany.status === 400 && tooMany.json.errors.some((e) => e.code === "csv_too_many_rows"), `51 rows gave ${tooMany.status} ${JSON.stringify(tooMany.json).slice(0, 160)}`);
    must((await orderCount()) === before, "orders were created from a 51-row file");
    const exactly50 = await http("/merchant/orders/bulk/preview", { method: "POST", token: merchant, body: { csv: [CSV_HEADER, ...rows.slice(0, 50)].join("\n") }, expect: 200 });
    must(exactly50.json.valid_order_count === 50 && exactly50.json.error_count === 0, "50 rows were not accepted by the preview");
  });
}

// --- Section 7: AI assistant without a key -------------------------------------------------------------------
async function assistantChecks(admin) {
  const passenger = await loginAs("demo.passenger@masari.app", env.DEMO_PASSENGER_PASSWORD);
  const ask = (message, locale = "en") => http("/passenger/assistant/messages", { method: "POST", token: passenger, body: { message, locale } });
  const openCount = async () => (await http("/admin/ai-uncertain-requests?status=open", { token: admin, expect: 200 })).json.open_total;
  await check("E27", "AI assistant (no AI key): the rule-based fallback understands a clear request in English and Arabic", async () => {
    const en = await ask("I need to go from Bab Al-Zawiya to Bethlehem Center tomorrow at 8am with 2 seats");
    must(en.status === 200 && en.json.status === "request_review", `en ${en.status} ${JSON.stringify(en.json).slice(0, 160)}`);
    must(en.json.extracted.pickup_key === "demo-bab-al-zawiya" && en.json.extracted.destination_key === "demo-bethlehem-center" && en.json.extracted.passenger_count === 2, `extracted ${JSON.stringify(en.json.extracted)}`);
    must(en.json.intent.source === "rules" && en.json.intent.confidence >= 0.5, `intent ${JSON.stringify(en.json.intent)}`);
    const ar = await ask("من باب الزاوية الى وسط بيت لحم بكرة الساعة 8", "ar");
    must(ar.status === 200 && ar.json.status === "request_review" && ar.json.extracted.destination_key === "demo-bethlehem-center", `ar ${ar.status} ${JSON.stringify(ar.json).slice(0, 160)}`);
    must((await http("/passenger/assistant/messages", { method: "POST", body: { message: "x" } })).status === 401, "anonymous assistant");
    must((await http("/passenger/assistant/messages", { method: "POST", token: admin, body: { message: "hello" } })).status === 403, "admin used the passenger assistant");
    must((await ask("")).status === 400, "an empty message was accepted");
  });
  await check("E28", "AI assistant: an unsupported place gets a clear reply listing the places that are supported", async () => {
    const r = await ask("I want a ride from Bab Al-Zawiya to Nablus tomorrow at 5pm");
    must(r.status === 200 && r.json.status === "clarification", `status ${r.json.status}`);
    must(/isn't supported|not supported/i.test(r.json.question) && r.json.suggestions.includes("Bab Al-Zawiya"), `reply ${r.json.question}`);
    const ar = await ask("بدي اروح لنابلس", "ar");
    must(ar.json.status === "clarification" && /غير مدعوم/.test(ar.json.question), `Arabic reply ${ar.json.question}`);
  });
  await check("E29", "AI assistant: low confidence is queued for the admin once, the clear request is not queued, the admin resolves it", async () => {
    const before = await openCount();
    await ask("I need a ride from Bab Al-Zawiya to Bethlehem Center tomorrow at 7am");
    must((await openCount()) === before, "a clear request was queued");
    const text = `qa gibberish ${tag} zzz`;
    const low = await ask(text);
    must(low.status === 200 && low.json.status === "clarification" && low.json.intent.confidence < 0.5, `gibberish ${JSON.stringify(low.json).slice(0, 160)}`);
    const list = await http("/admin/ai-uncertain-requests?status=open", { token: admin, expect: 200 });
    const row = list.json.requests.find((r) => r.text === text);
    must(row && row.status === "open" && row.reason && row.intent_type, `queued row ${JSON.stringify(row)}`);
    must(list.json.open_total === before + 1, `open_total ${list.json.open_total} (was ${before})`);
    must(!JSON.stringify(row).includes("demo.passenger"), "the queue exposes the passenger's identity");
    must((await http("/admin/ai-uncertain-requests", { token: passenger })).status === 403, "a passenger read the review queue");
    must((await http(`/admin/ai-uncertain-requests/${row.id}`, { method: "PATCH", token: admin, body: { expected_revision: 99, note: "x" } })).status === 409, "stale revision accepted");
    const done = await http(`/admin/ai-uncertain-requests/${row.id}`, { method: "PATCH", token: admin, body: { expected_revision: row.revision, note: "QA checked" }, expect: 200 });
    must(done.json.request.status === "resolved", "not resolved");
    must((await http(`/admin/ai-uncertain-requests/${row.id}`, { method: "PATCH", token: admin, body: { expected_revision: row.revision + 1, note: "again" } })).status === 409, "resolved twice");
    must((await openCount()) === before, "open count did not drop after resolving");
  });
}

// --- Section 11: success metrics and the simulated comparison ------------------------------------------------
async function metricsChecks(admin) {
  const passenger = await loginAs("demo.passenger@masari.app", env.DEMO_PASSENGER_PASSWORD);
  await check("A20", "success metrics: admin only; sane shape; bad ranges refused; CSV export is a download", async () => {
    must((await http("/admin/success-metrics", { token: passenger })).status === 403, "passenger read success metrics");
    must((await http("/admin/success-metrics")).status === 401, "anonymous read success metrics");
    const r = await http("/admin/success-metrics", { token: admin, expect: 200 });
    must(r.json.range.from && r.json.range.to && r.json.generated_at && r.json.metrics && typeof r.json.metrics === "object", `shape ${JSON.stringify(r.json).slice(0, 200)}`);
    const text = JSON.stringify(r.json.metrics);
    must(!/password|token|email|phone/i.test(text), "personal data in the metrics");
    must((await http("/admin/success-metrics?from=2026-01-10&to=2026-01-01", { token: admin })).status === 400, "reversed range accepted");
    must((await http("/admin/success-metrics?from=2020-01-01&to=2026-01-01", { token: admin })).status === 400, "range over a year accepted");
    const csv = await http("/admin/success-metrics/export", { token: admin, expect: 200 });
    must((csv.headers.get("content-type") ?? "").startsWith("text/csv") && (csv.headers.get("content-disposition") ?? "").startsWith("attachment") && csv.buffer.length > 20, "export is not a CSV download");
    must((await http("/admin/success-metrics/export", { token: passenger })).status === 403, "passenger exported metrics");
  });
  await check("A21", "simulated comparison: admin only, deterministic for a seed, nothing is written", async () => {
    must((await http("/compare/simulation", { token: passenger })).status === 403, "passenger ran the simulation");
    must((await http("/compare/simulation")).status === 401, "anonymous ran the simulation");
    const a = await http("/compare/simulation?seed=7", { token: admin, expect: 200 });
    const b = await http("/compare/simulation?seed=7", { token: admin, expect: 200 });
    const c = await http("/compare/simulation?seed=8", { token: admin, expect: 200 });
    must(a.json.simulation && typeof a.json.simulation === "object", "no simulation in the answer");
    must(JSON.stringify(a.json) === JSON.stringify(b.json), "the same seed gave different results");
    must(JSON.stringify(a.json) !== JSON.stringify(c.json), "a different seed gave identical results");
    const text = JSON.stringify(a.json.simulation);
    for (const method of ["manual", "nearest", "masari"]) must(new RegExp(method, "i").test(text), `method ${method} missing`);
    must((await http("/compare/simulation?seed=abc", { token: admin })).status === 400, "a bad seed was accepted");
  });
}

// --- Sections 5, 6 and 8: one real trip (delivery handover, rating, trust score, approaching alert) -----------
// Starts from a clean reset so the seeded passenger request and merchant order are free for a match.
async function startSeededTrip(admin) {
  const driver = await loginAs("demo.driver@masari.app", env.DEMO_DRIVER_PASSWORD);
  const passenger = await loginAs("demo.passenger@masari.app", env.DEMO_PASSENGER_PASSWORD);
  const merchant = await loginAs("demo.merchant@masari.app", env.DEMO_MERCHANT_PASSWORD);
  const requests = await http("/admin/requests", { token: admin, expect: 200 });
  const orders = await http("/admin/orders", { token: admin, expect: 200 });
  const passengerRequest = requests.json.requests[0];
  const order = orders.json.orders[0];
  await http(`/merchant/orders/${order.id}/batch`, { method: "POST", token: merchant, body: {}, expect: 201 });
  const match = (await http("/matches/run", { method: "POST", token: admin, body: { passengerRequestId: passengerRequest.id, merchantOrderId: order.id }, expect: 201 })).json.match;
  const trip = (await http(`/matches/${match.id}/accept`, { method: "POST", token: driver, body: {}, expect: 201 })).json.trip;
  return { driver, passenger, merchant, order, trip };
}
const setStatus = (tripId, token, status, expect = 200) => http(`/trips/${tripId}/status`, { method: "POST", token, body: { status }, expect });

async function tripChecks() {
  await resetData();
  let admin = await adminLogin();
  const t = await startSeededTrip(admin);
  const tripId = t.trip.id;
  const approaching = async () => (await http("/notifications?limit=100", { token: t.passenger, expect: 200 })).json.notifications.filter((n) => n.type === "driver_approaching");

  await check("E30", "approaching alert: the passenger is told once when the simulated driver comes within the radius", async () => {
    must((await approaching()).length === 0, "an alert existed before the driver moved");
    const counts = [];
    for (let i = 0; i < 3; i += 1) {
      await http(`/trips/${tripId}/simulate/step`, { method: "POST", token: t.driver, body: {}, expect: 201 });
      counts.push((await approaching()).length);
    }
    must(counts.at(-1) === 1, `driver_approaching notifications after each step: ${counts.join(",")}`);
    must(counts.every((c) => c <= 1), `the alert repeated: ${counts.join(",")}`);
    const alert = (await approaching())[0];
    const { created_at, read_at, id, entity_id, ...content } = alert;
    must(!/\d+\.\d{3,}/.test(JSON.stringify(content)), `the alert carries coordinates: ${JSON.stringify(content)}`);
    // The merchant is not the passenger: no approaching alert for them.
    const merchantList = await http("/notifications?limit=100", { token: t.merchant, expect: 200 });
    must(!merchantList.json.notifications.some((n) => n.type === "driver_approaching"), "the merchant got a passenger alert");
  });

  for (const status of ["pickup_started", "picked_up", "in_transit"]) await setStatus(tripId, t.driver, status);

  await check("E31", "handover: a parcel trip cannot be delivered without the receiver code (plain status route, other roles, no code)", async () => {
    const plain = await setStatus(tripId, t.driver, "delivered", 409);
    must(plain.json.error === "delivery_confirmation_required" || plain.json.error, `plain delivered gave ${plain.json.error}`);
    const noCode = await http(`/trips/${tripId}/delivery-confirmation`, { method: "POST", token: t.driver, body: { method: "receiver_code" } });
    must(noCode.status === 400, `no code gave ${noCode.status}`);
    for (const [who, token] of [["passenger", t.passenger], ["merchant", t.merchant]]) {
      const r = await http(`/trips/${tripId}/delivery-confirmation`, { method: "POST", token, body: { method: "receiver_code", code: "123456" } });
      must(r.status === 403, `${who} confirmed a delivery: ${r.status}`);
    }
    const trip = await http(`/trips/${tripId}`, { token: t.driver, expect: 200 });
    must(trip.json.trip.status === "in_transit", "the trip left in_transit without a code");
    must(!JSON.stringify(trip.json).match(/"code"\s*:\s*"\d{6}"/), "the trip view exposes a handover code");
  });

  let code;
  await check("E32", "handover: the sender gets the six-digit code once; the driver cannot read or re-issue it", async () => {
    must((await http(`/parcel-orders/${t.order.id}/handover/regenerate`, { method: "POST", token: t.driver, body: {} })).status === 404, "the driver re-issued the code");
    must((await http(`/parcel-orders/${t.order.id}/handover`, { token: t.driver })).status === 404, "the driver read the handover state");
    const issued = await http(`/parcel-orders/${t.order.id}/handover/regenerate`, { method: "POST", token: t.merchant, body: {}, expect: 200 });
    code = issued.json.handover.code;
    must(/^\d{6}$/.test(code), `code ${code}`);
    const state = await http(`/parcel-orders/${t.order.id}/handover`, { token: t.merchant, expect: 200 });
    must(state.json.handover.issued === true && state.json.handover.attempts_remaining === 5 && !JSON.stringify(state.json).includes(code), `state ${JSON.stringify(state.json)}`);
  });

  await check("E33", "handover: five wrong codes lock it, the right code is then refused (429), a new code unlocks", async () => {
    const wrong = code === "000000" ? "000001" : "000000";
    const confirm = (c) => http(`/trips/${tripId}/delivery-confirmation`, { method: "POST", token: t.driver, body: { method: "receiver_code", code: c } });
    for (let i = 0; i < 5; i += 1) {
      const r = await confirm(wrong);
      must(r.status === 422 || r.status === 429, `wrong code ${i + 1} gave ${r.status}`);
    }
    const locked = await confirm(code);
    must(locked.status === 429 && locked.json.error === "handover_locked", `right code after five wrong ones gave ${locked.status} ${locked.json?.error}`);
    const state = await http(`/parcel-orders/${t.order.id}/handover`, { token: t.merchant, expect: 200 });
    must(state.json.handover.locked === true, `state not locked: ${JSON.stringify(state.json)}`);
    const fresh = await http(`/parcel-orders/${t.order.id}/handover/regenerate`, { method: "POST", token: t.merchant, body: {}, expect: 200 });
    code = fresh.json.handover.code;
    must((await confirm(wrong === code ? "999999" : wrong)).status === 422, "wrong code after unlocking was not a plain mismatch");
  });

  await check("E34", "handover: the right code delivers the trip, which the admin sees as confirmed by code and not flagged", async () => {
    const delivered = await http(`/trips/${tripId}/delivery-confirmation`, { method: "POST", token: t.driver, body: { method: "receiver_code", code }, expect: 200 });
    must(delivered.json.delivered === true, `delivered ${JSON.stringify(delivered.json).slice(0, 120)}`);
    const again = await http(`/trips/${tripId}/delivery-confirmation`, { method: "POST", token: t.driver, body: { method: "receiver_code", code } });
    must(again.status >= 400, `a trip delivered twice gave ${again.status}`);
    const view = await http(`/admin/trips/${tripId}`, { token: admin, expect: 200 });
    const dc = view.json.trip.delivery_confirmation;
    must(dc && dc.flagged === false && JSON.stringify(dc.methods).includes("receiver_code"), `admin view ${JSON.stringify(dc)}`);
    must(!JSON.stringify(view.json).includes(code), "the admin view shows the code");
  });

  await check("E35", "rating: only after the trip is completed, once, 1-5 stars, passenger only; drivers never see ratings", async () => {
    const rate = (token, stars) => http(`/trips/${tripId}/rating`, { method: "POST", token, body: { stars } });
    const early = await rate(t.passenger, 5);
    must(early.status === 409 && early.json.error === "trip_not_completed", `rating before completion gave ${early.status} ${early.json?.error}`);
    await setStatus(tripId, t.driver, "completed");
    must((await rate(t.passenger, 0)).status === 400 && (await rate(t.passenger, 6)).status === 400 && (await rate(t.passenger, 4.5)).status === 400, "an invalid star count was accepted");
    must([403, 404].includes((await rate(t.driver, 5)).status), "a driver rated a trip");
    must([403, 404].includes((await rate(t.merchant, 5)).status), "the shop owner rated a trip");
    must((await http(`/trips/${tripId}/rating`, { token: t.passenger, expect: 200 })).json.rating === null, "a rating existed before it was given");
    const ok = await rate(t.passenger, 5);
    must(ok.status === 201 && ok.json.rating.stars === 5, `rating gave ${ok.status}`);
    const twice = await rate(t.passenger, 1);
    must(twice.status === 409 && twice.json.error === "trip_already_rated", `second rating gave ${twice.status}`);
    must((await http(`/trips/${tripId}/rating`, { token: t.passenger, expect: 200 })).json.rating.stars === 5, "the passenger cannot see their own rating");
    must([403, 404].includes((await http(`/trips/${tripId}/rating`, { token: t.driver })).status), "a driver read the rating");
    for (const path of ["/driver/performance", `/trips/${tripId}`, "/me", "/driver/routes", "/matches"]) {
      const body = JSON.stringify((await http(path, { token: t.driver })).json);
      must(!/"stars"|trip_rating|triprating/i.test(body), `${path} shows a rating to the driver`);
    }
  });

  await check("E36", "trust score: recomputed after the trip, between 0 and 100, with a breakdown; admin sees it; the job is repeatable", async () => {
    const prisma = await prismaClient();
    const user = await prisma.user.findUnique({ where: { email: "demo.driver@masari.app" }, include: { driver_profile: true } });
    const profile = user.driver_profile;
    must(Number.isInteger(profile.trust_score) && profile.trust_score >= 0 && profile.trust_score <= 100, `score ${profile.trust_score}`);
    must(profile.trust_computed_at, "the score was not recomputed after the completed trip");
    const components = JSON.stringify(profile.trust_components);
    must(/rating/i.test(components) && /experience/i.test(components), `components ${components.slice(0, 160)}`);
    const seen = await http(`/admin/users/${user.id}`, { token: admin, expect: 200 });
    must(seen.json.user.driver_profile.trust_score === profile.trust_score, "the admin sees a different score");
    const run = () => spawnSync("npm", ["run", "trust:recompute", "-w", "@masari/api"], { cwd: root, env: process.env, shell: true, encoding: "utf8", timeout: 120_000 });
    const first = run();
    const out = (first.stdout ?? "") + (first.stderr ?? "");
    must(first.status === 0 && /Recomputed trust score for \d+ driver\(s\); 0 failed/.test(out), `recompute job: ${out.slice(-200)}`);
    const again = await prisma.driverProfile.findUnique({ where: { id: profile.id } });
    must(again.trust_score === profile.trust_score, `the score moved from ${profile.trust_score} to ${again.trust_score} on an unchanged history`);
    const second = run();
    must(second.status === 0, "the recompute job is not repeatable");
  });

  // Second trip, same reset cycle is not possible (one seeded pair), so the fallback gets its own clean start.
  await resetData();
  admin = await adminLogin();
  const u = await startSeededTrip(admin);
  for (const status of ["pickup_started", "picked_up", "in_transit"]) await setStatus(u.trip.id, u.driver, status);
  await check("E37", "handover fallback: 'receiver unavailable' needs a reason of at least 10 characters, delivers, and is flagged for the admin", async () => {
    const send = (body) => http(`/trips/${u.trip.id}/delivery-confirmation`, { method: "POST", token: u.driver, body });
    must((await send({ method: "receiver_unavailable" })).status === 400, "no reason accepted");
    must((await send({ method: "receiver_unavailable", reason: "no answer" })).status === 400, "a 9-character reason accepted");
    must((await send({ method: "receiver_unavailable", reason: "x".repeat(301) })).status === 400, "a 301-character reason accepted");
    const reason = "Receiver phone off, nobody at the address";
    const ok = await send({ method: "receiver_unavailable", reason });
    must(ok.status === 200 && ok.json.delivered === true, `fallback gave ${ok.status} ${JSON.stringify(ok.json).slice(0, 120)}`);
    const list = await http("/admin/trips", { token: admin, expect: 200 });
    const row = list.json.trips.find((x) => x.id === u.trip.id);
    must(row?.delivery_confirmation?.flagged === true, `list row ${JSON.stringify(row?.delivery_confirmation)}`);
    const dc = (await http(`/admin/trips/${u.trip.id}`, { token: admin, expect: 200 })).json.trip.delivery_confirmation;
    must(dc.flagged === true && JSON.stringify(dc.methods).includes("receiver_unavailable") && JSON.stringify(dc.reasons).includes("nobody at the address"), `detail ${JSON.stringify(dc)}`);
    const state = await http(`/parcel-orders/${u.order.id}/handover`, { token: u.merchant, expect: 200 });
    must(state.json.handover.confirmation_method === "receiver_unavailable" && state.json.handover.unavailable_reason === reason, `sender sees ${JSON.stringify(state.json.handover)}`);
    await setStatus(u.trip.id, u.driver, "completed");
  });
}

// --- Section 9: driver document expiry, restriction and renewal ---------------------------------------------
const isoDay = (offsetDays) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
function runExpiryJob() {
  const r = spawnSync("npm", ["run", "documents:expiry", "-w", "@masari/api"], { cwd: root, env: process.env, shell: true, encoding: "utf8", timeout: 120_000 });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  const m = out.match(/Checked (\d+) driver\(s\): sent (\d+) reminder\(s\), restricted (\d+) driver/);
  if (r.status !== 0 || !m) throw new Error(`expiry job failed: ${out.slice(-300)}`);
  return { checked: Number(m[1]), reminded: Number(m[2]), restricted: Number(m[3]) };
}

async function documentExpiryChecks() {
  const admin = await adminLogin();
  const phone = `+97059005${String(Date.now()).slice(-4)}`;
  const applicant = await openSignUp({ role: "driver", phone, name: "QA Expiry Driver" });
  for (const [kind, bytes] of [["driver_licence", jpeg], ["vehicle_registration", pdf], ["national_id", jpeg]]) await uploadDriverDoc(applicant.token, kind, bytes, 201);
  await http("/onboarding/application/submit", { method: "POST", token: applicant.token, expect: 200 });
  const user = (await http(`/admin/users?search=${encodeURIComponent(phone)}`, { token: admin, expect: 200 })).json.users.find((u) => u.phone === phone);
  const verification = () => http(`/admin/driver-verifications/${user.id}`, { token: admin, expect: 200 }).then((r) => r.json.verification);
  const prisma = await prismaClient();
  const profile = { vehicle_type: "sedan", seats_total: 4, parcel_capacity: 4 };
  let driver;
  const driverNotifications = async (type) => (await http("/notifications?limit=100", { token: driver, expect: 200 })).json.notifications.filter((n) => n.type === type);
  const goOnline = () => http("/driver/online-state", { method: "PUT", token: driver, headers: { "idempotency-key": key("online") }, body: { online: true } });

  await check("E38", "document expiry: dates are recorded on approval (a past date is refused) and show in the expiring list", async () => {
    const v = await verification();
    const body = (expiry) => ({ expected_revision: v.revision, profile, expiry });
    const past = await http(`/admin/driver-verifications/${user.id}/approve`, { method: "POST", token: admin, body: body({ licence: isoDay(-1), vehicle_registration: isoDay(300), insurance: isoDay(300) }) });
    must(past.status === 400 && past.json.error === "expiry_date_in_past", `past date gave ${past.status} ${past.json?.error}`);
    const ok = await http(`/admin/driver-verifications/${user.id}/approve`, { method: "POST", token: admin, body: body({ licence: isoDay(5), vehicle_registration: isoDay(300), insurance: isoDay(300) }), expect: 200 });
    must(ok.json.verification.status === "approved", "not approved");
    const row = await prisma.driverVerification.findUnique({ where: { user_id: user.id } });
    must(row.licence_expires_at && row.vehicle_registration_expires_at && row.insurance_expires_at, "dates not stored");
    const expiring = await http("/admin/driver-verifications/expiring?within_days=30", { token: admin, expect: 200 });
    must(expiring.json.verifications.some((x) => x.candidate.phone === phone), "the driver is missing from the expiring-soon list");
    const login = await http("/auth/mobile/login", { method: "POST", body: { phone, password: applicant.password }, expect: 200 });
    driver = login.json.token;
    must((await http("/admin/driver-verifications/expiring", { token: driver })).status === 403, "a driver read the expiring list");
  });
  await check("E39", "document expiry: the daily job reminds once (not twice) when a document runs out within 7 days", async () => {
    const first = runExpiryJob();
    must(first.reminded >= 1 && first.restricted === 0, `first run ${JSON.stringify(first)}`);
    const notes = await driverNotifications("driver_documents_expiring");
    must(notes.length === 1, `${notes.length} reminders after the first run`);
    const second = runExpiryJob();
    must(second.reminded === 0 && second.restricted === 0, `second run ${JSON.stringify(second)}`);
    must((await driverNotifications("driver_documents_expiring")).length === 1, "the reminder was repeated");
    must((await verification()).status === "approved", "the driver was restricted too early");
  });
  await check("E40", "document expiry: the day after the licence date the job restricts the driver (documents_expired, unverified, no going online)", async () => {
    await prisma.driverVerification.update({ where: { user_id: user.id }, data: { licence_expires_at: new Date(`${isoDay(-1)}T00:00:00.000Z`) } });
    const run = runExpiryJob();
    must(run.restricted === 1, `job ${JSON.stringify(run)}`);
    const v = await verification();
    must(v.status === "documents_expired", `status ${v.status}`);
    const profileRow = await prisma.driverProfile.findUnique({ where: { user_id: user.id } });
    must(profileRow.verified === false, "the profile is still verified");
    const online = await goOnline();
    must(online.status === 403 && online.json.error === "driver_documents_expired", `going online gave ${online.status} ${online.json?.error}`);
    const availability = await http("/driver/availabilities", { method: "POST", token: driver, headers: { "idempotency-key": key("avail") }, body: {} });
    must(availability.status === 403 || availability.status === 400, `availability gave ${availability.status}`);
    must((await driverNotifications("driver_documents_expired")).length === 1, "no 'documents expired' notification");
    must(runExpiryJob().restricted === 0, "the job restricted the same driver twice");
    const awaiting = await http("/admin/driver-verifications/re-review?state=awaiting_driver", { token: admin, expect: 200 });
    must(awaiting.json.verifications.some((x) => x.candidate.phone === phone), "the driver is not in the re-review queue (awaiting driver)");
    must((await http("/me", { token: driver })).status === 200, "the restricted driver lost the whole session");
  });
  await check("E41", "document expiry: renewal needs a file; submit moves it to the admin re-review queue; the driver stays restricted until approval", async () => {
    const state = await http("/driver/document-renewal", { token: driver, expect: 200 });
    must(state.json.status === "documents_expired" && state.json.can_upload === true, `state ${JSON.stringify(state.json).slice(0, 140)}`);
    must((await http("/driver/document-renewal/submit", { method: "POST", token: driver })).status === 409, "submit with no documents accepted");
    const bad = await http("/driver/document-renewal/documents?kind=driver_licence", { method: "POST", token: driver, raw: Buffer.from("not a photo"), headers: { "content-type": "application/octet-stream" } });
    must(bad.status === 415, `a non-image gave ${bad.status}`);
    await http("/driver/document-renewal/documents?kind=driver_licence", { method: "POST", token: driver, raw: jpeg, headers: { "content-type": "application/octet-stream" }, expect: 201 });
    await http("/driver/document-renewal/submit", { method: "POST", token: driver, expect: 200 });
    const queue = await http("/admin/driver-verifications/re-review?state=submitted", { token: admin, expect: 200 });
    const entry = queue.json.verifications.find((x) => x.candidate.phone === phone);
    must(entry && entry.evidence.documents.length >= 1, "the renewed document is not in the re-review queue");
    must((await goOnline()).status === 403, "the driver went online while the renewal was still waiting");
    must((await http("/driver/document-renewal", { token: await loginAs("demo.passenger@masari.app", env.DEMO_PASSENGER_PASSWORD) })).status === 403, "a passenger reached the renewal area");
  });
  await check("E42", "document expiry: approving the renewal needs the new licence date and restores access at once", async () => {
    const v = await verification();
    const missing = await http(`/admin/driver-verifications/${user.id}/approve`, { method: "POST", token: admin, body: { expected_revision: v.revision } });
    must(missing.status === 400 && ["expiry_dates_required", "expiry_date_in_past"].includes(missing.json.error), `without new dates ${missing.status} ${missing.json?.error}`);
    await http(`/admin/driver-verifications/${user.id}/approve`, { method: "POST", token: admin, body: { expected_revision: v.revision, expiry: { licence: isoDay(365) } }, expect: 200 });
    const after = await verification();
    must(after.status === "approved", `status ${after.status}`);
    must(after.history.some((h) => h.decision === "documents_expired") && after.history.some((h) => h.decision === "renewal_submitted"), "history incomplete");
    const profileRow = await prisma.driverProfile.findUnique({ where: { user_id: user.id } });
    must(profileRow.verified === true, "the driver is not verified again");
    const online = await goOnline();
    must(online.status !== 403, `still refused after approval: ${online.status} ${online.json?.error}`);
    must(runExpiryJob().restricted === 0, "the job restricted the renewed driver again");
  });
}

export async function runNewFeatureChecks() {
  console.log("== New features (email codes, open sign-up, fares, parcels, handover, trust, AI, expiry, bulk, metrics)");
  const admin = await adminLogin();
  await emailCodeChecks(admin);
  await openSignupChecks(admin);
  await routeFareChecks(admin);
  await passengerParcelChecks(admin);
  await bulkOrderChecks(admin);
  await assistantChecks(admin);
  await metricsChecks(admin);
  await tripChecks();
  await documentExpiryChecks();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await runNewFeatureChecks();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
