import { createHash } from "node:crypto";
import request from "supertest";
import { createApp } from "../app.js";
import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { EmailOtpProvider, FakeOtpProvider } from "../lib/otp.js";
import { resetDemoData, DEMO_ACCOUNTS } from "../modules/demoReset.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const checks: string[] = [];
function check(condition: unknown, name: string) {
  assert(condition, name);
  checks.push(name);
}

const provider = new FakeOtpProvider();
const app = createApp(config, { otpProvider: provider });

function key(label: string) {
  return `integration-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function seedLegalFixtures() {
  assert(config.publicRegistration?.testLegalFixturesEnabled, "Test legal fixtures must be explicitly enabled");
  assert(!config.isStaging && !config.isProduction, "Test legal fixtures are forbidden in production-like environments");
  const effectiveAt = new Date("2026-07-19T00:00:00.000Z");
  await prisma.consentRelease.create({
    data: {
      version: "test-demo-2026-07-v1",
      status: "effective",
      revision: 3,
      intended_effective_at: effectiveAt,
      legal_approved_at: effectiveAt,
      legal_approved_by: "TEST/DEMO ONLY",
      activated_at: effectiveAt,
      activated_by: "TEST/DEMO ONLY",
      created_by: "TEST/DEMO ONLY",
      documents: {
        create: (["ar", "en"] as const).flatMap((locale) =>
          (["terms", "privacy", "adult_self_attestation"] as const).map((type) => {
            const content = `TEST/DEMO ONLY - NOT PRODUCTION LEGAL CONTENT - ${locale} - ${type}`;
            return {
          document_type: type,
          version: "test-demo-2026-07-v1",
          locale,
              content_body: content,
          content_digest: createHash("sha256").update(content).digest("hex"),
          content_reference: content,
          effective_at: effectiveAt,
          legal_approved_at: effectiveAt,
          legal_approved_by: "TEST/DEMO ONLY"
            };
          })
        )
      }
    }
  });
}

async function adminToken() {
  const response = await request(app).post("/api/v1/auth/login").send({
    email: DEMO_ACCOUNTS.admin.email,
    password: config.demo!.adminPassword
  });
  assert(response.status === 200, "Admin login failed");
  return response.body.token as string;
}

const CAP_BUCKETS = [
  "otp_ip_hour", "otp_phone_day", "otp_email_day", "open_start_ip", "open_start_phone", "open_start_email",
  "open_start_global", "registration_conflict_ip"
];

/** Every request in this script comes from one test IP, so the per-source start caps are cleared between starts. */
async function clearStartCaps() {
  await prisma.abuseCounter.deleteMany({ where: { bucket_type: { in: CAP_BUCKETS } } });
}

function contactEmail(phone: string) {
  return `open.${phone.slice(-6)}@example.com`;
}

/** Self-service start: no invitation, the one-time code goes to the applicant's own email. */
async function start(
  role: string,
  phone: string,
  idempotency = key("start"),
  application: typeof app = app
) {
  provider.outbox.clear();
  await clearStartCaps();
  return request(application)
    .post("/api/v1/onboarding/attempts")
    .set("idempotency-key", idempotency)
    .send({ role, phone, email: contactEmail(phone), region: "PS", locale: "ar" });
}

function latestOtp() {
  const values = [...provider.outbox.values()];
  assert(values.length === 1, "Expected exactly one OTP in the injected fake provider outbox");
  return values[0];
}

async function verify(attemptId: string, token: string, otp: string, idempotency = key("verify")) {
  return request(app)
    .post(`/api/v1/onboarding/attempts/${attemptId}/verify`)
    .set("authorization", `Onboarding ${token}`)
    .set("idempotency-key", idempotency)
    .send({ otp });
}

async function consents(locale = "ar") {
  const response = await request(app).get("/api/v1/onboarding/consents").query({ locale });
  assert(response.status === 200, "Consent retrieval failed");
  return (response.body.documents as Array<{ id: string; type: string; content_hash: string }>).map(
    ({ id, type, content_hash }) => ({ id, type, content_hash })
  );
}

async function complete(
  attemptId: string,
  token: string,
  grant: string,
  documents: Array<{ id: string; type: string; content_hash: string }>,
  displayName: string,
  password: string,
  idempotency = key("complete")
) {
  return request(app)
    .post(`/api/v1/onboarding/attempts/${attemptId}/complete`)
    .set("authorization", `Onboarding ${token}`)
    .set("idempotency-key", idempotency)
    .send({
      registration_grant: grant,
      display_name: displayName,
      password,
      locale: "ar",
      consents: documents,
      adult_self_attestation: true
    });
}

async function onboard(
  role: "driver" | "merchant",
  phone: string,
  name: string,
  password: string
) {
  const started = await start(role, phone);
  assert(started.status === 201, `${role} onboarding did not start`);
  assert(Date.parse(started.body.onboarding_token_expires_at) > Date.now(), `${role} continuation expiry missing`);
  const otp = latestOtp();
  const verified = await verify(started.body.attempt.id, started.body.onboarding_token, otp);
  assert(verified.status === 200, `${role} phone verification failed`);
  assert(Date.parse(verified.body.registration_grant_expires_at) > Date.now(), `${role} grant expiry missing`);
  const documents = await consents();
  const completionKey = key("complete");
  const completed = await complete(
    started.body.attempt.id,
    started.body.onboarding_token,
    verified.body.registration_grant,
    documents,
    name,
    password,
    completionKey
  );
  return { started, verified, completed, documents, completionKey, name, password };
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("integration jpeg body")]);

const openStart = (role: string, phone: string) => start(role, phone, key("open-start"));

async function uploadDocument(path: string, token: string, kind: string) {
  return request(app)
    .post(`/api/v1/onboarding/${path}?kind=${kind}`)
    .set("authorization", `Onboarding ${token}`)
    .set("content-type", "application/octet-stream")
    .send(JPEG);
}

const submitApplication = (token: string) =>
  request(app).post("/api/v1/onboarding/application/submit").set("authorization", `Onboarding ${token}`);

/** Driver / shop-owner registration: no invitation, documents required before review. */
async function selfServiceChecks(admin: string, legal: Array<{ id: string; type: string; content_hash: string }>) {
  await clearStartCaps();
  const openConfig = await request(app).get("/api/v1/onboarding/config");
  check(
    JSON.stringify(openConfig.body.open_registration_roles) === JSON.stringify(["driver", "merchant"]),
    "driver and shop-owner registration is advertised without any invitation"
  );
  check((await openStart("passenger", "+970599222201")).status === 404, "passengers do not register through this flow");

  // A number that already has an account looks exactly like a new one until the code is proven.
  const existing = await openStart("driver", "+970599111115");
  check(existing.status === 201 && existing.body.next_action === "verify_otp", "open start does not reveal an existing account");
  const existingVerified = await verify(existing.body.attempt.id, existing.body.onboarding_token, latestOtp());
  const existingComplete = await complete(
    existing.body.attempt.id, existing.body.onboarding_token, existingVerified.body.registration_grant,
    legal, "Duplicate Person", "duplicate secure pass 2026"
  );
  check(existingComplete.status === 409 && existingComplete.body.error === "registration_conflict", "an existing number cannot be registered again");

  const started = await openStart("driver", "+970599222202");
  check(started.status === 201, "open driver start succeeds");
  const attempt = await prisma.onboardingAttempt.findUniqueOrThrow({ where: { id: started.body.attempt.id } });
  check(attempt.invitation_id === null, "open attempt has no invitation");
  check(attempt.delivery_email === "open.222202@example.com", "open attempt records the email the code is sent to");
  const wrongOtp = await verify(started.body.attempt.id, started.body.onboarding_token, "000000");
  check(wrongOtp.status === 400, "a wrong code is refused as in the invited flow");
  const verified = await verify(started.body.attempt.id, started.body.onboarding_token, latestOtp());
  check(verified.status === 200, "open driver phone verification succeeds");
  const completed = await complete(
    started.body.attempt.id, started.body.onboarding_token, verified.body.registration_grant,
    legal, "Open Driver", "open driver secure pass 2026"
  );
  check(
    completed.status === 201 && completed.body.account_status === "pending" && completed.body.next_action === "upload_documents",
    "open driver is created pending and told to upload documents"
  );
  const statusToken = completed.body.onboarding_status_token as string;
  const driver = await prisma.user.findUniqueOrThrow({ where: { phone: "+970599222202" } });
  check(driver.review_submitted_at === null, "open driver has not been submitted for review");
  check(
    (await request(app).post("/api/v1/auth/login").send({ phone: "+970599222202", password: "open driver secure pass 2026" })).status === 403,
    "an open pending driver cannot sign in"
  );
  const notQueued = await request(app).get("/api/v1/admin/driver-verifications?status=pending&limit=100").set("authorization", `Bearer ${admin}`);
  check(
    notQueued.status === 200 && !notQueued.body.verifications.some((entry: { candidate: { id: string } }) => entry.candidate.id === driver.id),
    "an unsubmitted driver is not in the admin review queue"
  );
  const approveEarly = await request(app)
    .post(`/api/v1/admin/driver-verifications/${driver.id}/approve`)
    .set("authorization", `Bearer ${admin}`)
    .send({ expected_revision: 1, profile: { vehicle_type: "sedan", seats_total: 4, parcel_capacity: 3 } });
  check(approveEarly.status === 409 && approveEarly.body.error === "application_not_submitted", "admin cannot approve an unsubmitted application");
  const noDocuments = await submitApplication(statusToken);
  check(
    noDocuments.status === 409 && noDocuments.body.error === "documents_required" && noDocuments.body.missing_documents.length === 3,
    "submission is refused with no documents"
  );
  const statusBefore = await request(app).get("/api/v1/onboarding/status").set("authorization", `Onboarding ${statusToken}`);
  check(statusBefore.body.onboarding_status === "documents_required", "status asks for documents");
  check((await uploadDocument("driver-documents", statusToken, "driver_licence")).status === 201, "licence uploaded");
  check((await uploadDocument("driver-documents", statusToken, "insurance")).status === 201, "optional insurance uploaded");
  const partial = await submitApplication(statusToken);
  check(partial.status === 409 && partial.body.missing_documents.length === 3, "an optional kind does not satisfy the required set");
  check((await uploadDocument("driver-documents", statusToken, "vehicle_registration")).status === 201, "vehicle registration uploaded");
  check((await uploadDocument("driver-documents", statusToken, "vehicle_photo")).status === 201, "vehicle photo uploaded");
  check((await uploadDocument("driver-documents", statusToken, "national_id")).status === 201, "national ID uploaded");
  const submitted = await submitApplication(statusToken);
  check(submitted.status === 200 && submitted.body.onboarding_status === "pending_review", "complete application is submitted");
  check((await submitApplication(statusToken)).status === 200, "submission is idempotent");
  const queued = await request(app).get("/api/v1/admin/driver-verifications?status=pending&limit=100").set("authorization", `Bearer ${admin}`);
  check(queued.body.verifications.some((entry: { candidate: { id: string } }) => entry.candidate.id === driver.id), "a submitted driver enters the review queue");
  const approved = await request(app)
    .post(`/api/v1/admin/driver-verifications/${driver.id}/approve`)
    .set("authorization", `Bearer ${admin}`)
    .send({ expected_revision: 1, profile: { vehicle_type: "sedan", seats_total: 4, parcel_capacity: 3 } });
  check(approved.status === 200, "admin approves a submitted open driver");
  check(
    (await request(app).post("/api/v1/auth/login").send({ phone: "+970599222202", password: "open driver secure pass 2026" })).status === 200,
    "an approved open driver can sign in"
  );

  const shopStart = await openStart("merchant", "+970599222203");
  const shopVerified = await verify(shopStart.body.attempt.id, shopStart.body.onboarding_token, latestOtp());
  const shopCompleted = await complete(
    shopStart.body.attempt.id, shopStart.body.onboarding_token, shopVerified.body.registration_grant,
    legal, "Open Shop", "open shop secure pass 2026"
  );
  check(shopCompleted.status === 201 && shopCompleted.body.next_action === "upload_documents", "open shop owner is created pending");
  const shopToken = shopCompleted.body.onboarding_status_token as string;
  const shop = await prisma.user.findUniqueOrThrow({ where: { phone: "+970599222203" } });
  const shopEarly = await request(app).post(`/api/v1/admin/merchant-approvals/${shop.id}/approve`).set("authorization", `Bearer ${admin}`).send({});
  check(shopEarly.status === 409 && shopEarly.body.error === "application_not_submitted", "admin cannot approve an unsubmitted shop owner");
  check((await submitApplication(shopToken)).status === 409, "shop owner cannot submit without documents");
  for (const kind of ["commercial_register", "national_id"]) {
    check((await uploadDocument("merchant-documents", shopToken, kind)).status === 201, `shop ${kind} uploaded`);
  }
  check((await submitApplication(shopToken)).status === 409, "shop owner cannot submit without the shop photo");
  check((await uploadDocument("merchant-documents", shopToken, "shop_photo")).status === 201, "shop photo uploaded");
  check((await submitApplication(shopToken)).status === 200, "complete shop application is submitted");
  const shopApproved = await request(app).post(`/api/v1/admin/merchant-approvals/${shop.id}/approve`).set("authorization", `Bearer ${admin}`).send({});
  check(shopApproved.status === 200, "admin approves a submitted open shop owner");

  // Starting again for the same phone supersedes the older open attempt.
  const again = await openStart("driver", "+970599222204");
  const supersede = await openStart("driver", "+970599222204");
  check(again.status === 201 && supersede.status === 201, "repeat open start succeeds");
  const olderAttempt = await prisma.onboardingAttempt.findUniqueOrThrow({ where: { id: again.body.attempt.id } });
  check(olderAttempt.status === "cancelled", "an older open attempt is superseded");
  check(
    (await verify(again.body.attempt.id, again.body.onboarding_token, "123456")).status === 401,
    "the superseded attempt's token no longer works"
  );
  await emailDeliveryChecks(legal);
}

/** OTP_PROVIDER=email behaviour: the code travels by email only, and an unproven phone is not a sign-in identity. */
async function emailDeliveryChecks(legal: Array<{ id: string; type: string; content_hash: string }>) {
  const sent: Array<{ to: string; purpose: string; actionToken: string }> = [];
  const emailApp = createApp(config, { otpProvider: new EmailOtpProvider({ kind: "approved", send: async (m) => { sent.push(m); } }) });
  await clearStartCaps();
  const phone = "+970599333301";
  const email = "email.flow@example.com";
  const started = await request(emailApp).post("/api/v1/onboarding/attempts").set("idempotency-key", key("email-start"))
    .send({ role: "driver", phone, email, region: "PS", locale: "en" });
  check(started.status === 201 && sent.length === 1 && sent[0].to === email && sent[0].purpose === "phone_code", "the code is emailed to the open applicant");
  check(!JSON.stringify(started.body).includes(sent[0].actionToken) && !JSON.stringify(started.body).includes(email), "the start response carries neither the code nor the email");
  const token = `Onboarding ${started.body.onboarding_token}`;
  const verified = await request(emailApp).post(`/api/v1/onboarding/attempts/${started.body.attempt.id}/verify`)
    .set("authorization", token).set("idempotency-key", key("email-verify")).send({ otp: sent[0].actionToken });
  check(verified.status === 200, "the emailed code verifies the attempt");
  const done = await request(emailApp).post(`/api/v1/onboarding/attempts/${started.body.attempt.id}/complete`)
    .set("authorization", token).set("idempotency-key", key("email-complete"))
    .send({ registration_grant: verified.body.registration_grant, display_name: "Email Driver", password: "email driver secure pass 2026", locale: "ar", consents: legal, adult_self_attestation: true });
  check(done.status === 201, "email-verified open sign-up completes");
  const user = await prisma.user.findUniqueOrThrow({ where: { phone } });
  check(user.email === email && user.email_verified_at !== null, "the proven email becomes the verified sign-in identity");
  check(user.phone_verified_at === null, "an email-verified open sign-up leaves the phone unverified");
  check(
    (await request(emailApp).post("/api/v1/auth/login").send({ phone, password: "email driver secure pass 2026" })).status === 401,
    "an unverified phone cannot be used to sign in"
  );
}

async function main() {
  check(config.publicOnboardingEnabled, "public onboarding enabled only for disposable integration environment");
  check(config.onboarding?.otpProvider === "fake", "fake provider enforced");
  await resetDemoData();
  await seedLegalFixtures();
  const admin = await adminToken();

  const publicConfig = await request(app).get("/api/v1/onboarding/config");
  check(publicConfig.status === 200 && publicConfig.body.enabled === true, "enabled public config");
  check(!JSON.stringify(publicConfig.body).includes("provider"), "config does not expose provider");
  check(publicConfig.body.request_id, "config request ID");
  const legal = await consents();
  check(legal.length === 3, "complete approved consent set");
  check((await request(app).get("/api/v1/onboarding/consents").query({ locale: "fr" })).status === 400, "consent locale validation");

  const removedLegal = await prisma.consentDocument.findFirstOrThrow({ where: { locale: "en", document_type: "privacy" } });
  await prisma.consentDocument.delete({ where: { id: removedLegal.id } });
  const unavailableConfig = await request(app).get("/api/v1/onboarding/config");
  check(unavailableConfig.status === 200 && unavailableConfig.body.enabled === false, "missing legal document safely disables onboarding");
  await prisma.consentDocument.create({ data: {
    id: removedLegal.id,
    release_id: removedLegal.release_id,
    document_type: removedLegal.document_type,
    version: removedLegal.version,
    locale: removedLegal.locale,
    content_body: removedLegal.content_body,
    content_digest: removedLegal.content_digest,
    content_reference: removedLegal.content_reference,
    effective_at: removedLegal.effective_at,
    retired_at: removedLegal.retired_at,
    legal_approved_at: removedLegal.legal_approved_at,
    legal_approved_by: removedLegal.legal_approved_by
  } });
  const duplicateEffectiveAt = removedLegal.effective_at;
  const duplicateRelease = await prisma.consentRelease.create({
    data: {
      version: "test-demo-2026-07-v2",
      status: "effective",
      revision: 3,
      intended_effective_at: duplicateEffectiveAt,
      legal_approved_at: duplicateEffectiveAt,
      legal_approved_by: "TEST/DEMO ONLY",
      activated_at: duplicateEffectiveAt,
      activated_by: "TEST/DEMO ONLY",
      created_by: "TEST/DEMO ONLY",
      documents: { create: {
        document_type: "terms",
        version: "test-demo-2026-07-v2",
        locale: "ar",
        content_body: "TEST/DEMO ONLY - DUPLICATE TERMS",
        content_digest: createHash("sha256").update("TEST/DEMO ONLY - DUPLICATE TERMS").digest("hex"),
        content_reference: "TEST/DEMO ONLY - DUPLICATE TERMS",
        effective_at: duplicateEffectiveAt,
        legal_approved_at: duplicateEffectiveAt,
        legal_approved_by: "TEST/DEMO ONLY"
      } }
    }
  });
  check((await request(app).get("/api/v1/onboarding/consents").query({ locale: "ar" })).status === 503, "ambiguous active consent set fails closed");
  check((await request(app).get("/api/v1/onboarding/config")).body.enabled === false, "ambiguous consent set disables onboarding");
  await prisma.consentDocument.deleteMany({ where: { release_id: duplicateRelease.id } });
  await prisma.consentRelease.delete({ where: { id: duplicateRelease.id } });

  check(
    JSON.stringify(publicConfig.body.registration_roles) === JSON.stringify(["driver", "merchant"]),
    "registration is offered to drivers and shop owners only"
  );
  const passengerStart = await start("passenger", "+970599111111");
  check(passengerStart.status === 404 && passengerStart.body.error === "onboarding_unavailable", "passenger registration is not offered by this flow");
  const legacyCode = await request(app)
    .post("/api/v1/onboarding/attempts")
    .set("idempotency-key", key("legacy-code"))
    .send({ invitation_code: "ABCDEFGHJKLMNPQRSTUV2345", role: "driver", phone: "+970599111119", email: contactEmail("+970599111119"), region: "PS", locale: "ar" });
  check(legacyCode.status === 400, "an invitation code is no longer accepted");
  const idempotencyBeforeIneligible = await prisma.idempotencyRecord.count();
  check((await start("passenger", "+970599111122")).status === 404, "ineligible role remains generic");
  check(await prisma.idempotencyRecord.count() === idempotencyBeforeIneligible, "ineligible starts do not claim idempotency records");
  check(await prisma.invitation.count() === 0 && await prisma.invitationRedemption.count() === 0, "registration creates and redeems no invitation");

  const rejectedProvider = new FakeOtpProvider("rejected");
  const rejectedApp = createApp(config, { otpProvider: rejectedProvider });
  const rejectedStart = await start("driver", "+970599111118", key("rejected-start"), rejectedApp);
  check(rejectedStart.status === 201 && rejectedStart.body.next_action === "resend_otp", "provider rejection leaves recoverable attempt");
  check(!JSON.stringify(rejectedStart.body).includes("rejected"), "provider rejection details stay private");
  const rejectedChallenge = await prisma.otpChallenge.findFirstOrThrow({ where: { onboarding_attempt_id: rejectedStart.body.attempt.id } });
  check(rejectedChallenge.delivery_status === "rejected" && rejectedChallenge.consumed_at === null, "rejected challenge is unverifiable");

  const racePhone = "+970599111113";
  const raceKey = key("race-start");
  const firstStart = await start("driver", racePhone, raceKey);
  check(firstStart.status === 201 && provider.outbox.size === 1, "start creates one attempt and sends one OTP");
  const raceRequests = [firstStart];
  const resumed = await start("driver", racePhone, raceKey);
  check(resumed.status === 200 && resumed.body.attempt.id === firstStart.body.attempt.id, "lost response resumes same attempt");
  check(resumed.body.onboarding_token !== firstStart.body.onboarding_token, "resume rotates continuation token");
  check(provider.outbox.size === 0, "resume does not send duplicate OTP");

  const raceAttemptId = firstStart.body.attempt.id as string;
  const firstChallenge = await prisma.onboardingAttempt.findUniqueOrThrow({ where: { id: raceAttemptId }, select: { current_challenge_id: true } });
  await prisma.otpChallenge.update({ where: { id: firstChallenge.current_challenge_id! }, data: { last_sent_at: new Date(Date.now() - 120_000) } });
  provider.outbox.clear();
  const acceptedResendKey = key("resend-accepted");
  const acceptedResend = await request(app)
    .post(`/api/v1/onboarding/attempts/${raceAttemptId}/resend`)
    .set("authorization", `Onboarding ${resumed.body.onboarding_token}`)
    .set("idempotency-key", acceptedResendKey)
    .send({});
  check(acceptedResend.status === 200 && acceptedResend.body.status === "otp_sent", "resend acceptance succeeds");
  const acceptedResendReplay = await request(app)
    .post(`/api/v1/onboarding/attempts/${raceAttemptId}/resend`)
    .set("authorization", `Onboarding ${resumed.body.onboarding_token}`)
    .set("idempotency-key", acceptedResendKey)
    .send({});
  check(
    acceptedResendReplay.status === 200 &&
      acceptedResendReplay.body.status === "otp_sent" &&
      acceptedResendReplay.body.resend_available_at === acceptedResend.body.resend_available_at,
    "accepted resend replay preserves its exact safe outcome and cooldown"
  );
  const afterAcceptedResend = await prisma.onboardingAttempt.findUniqueOrThrow({ where: { id: raceAttemptId }, select: { current_challenge_id: true } });
  check(afterAcceptedResend.current_challenge_id !== firstChallenge.current_challenge_id, "accepted resend promotes a new challenge");
  check((await prisma.otpChallenge.findUniqueOrThrow({ where: { id: firstChallenge.current_challenge_id! } })).superseded_at !== null, "accepted resend supersedes previous challenge");
  await prisma.otpChallenge.update({ where: { id: afterAcceptedResend.current_challenge_id! }, data: { last_sent_at: new Date(Date.now() - 120_000) } });
  const rejectedResendKey = key("resend-rejected");
  const rejectedResend = await request(rejectedApp)
    .post(`/api/v1/onboarding/attempts/${raceAttemptId}/resend`)
    .set("authorization", `Onboarding ${resumed.body.onboarding_token}`)
    .set("idempotency-key", rejectedResendKey)
    .send({});
  check(rejectedResend.status === 200 && rejectedResend.body.status === "verification_temporarily_unavailable", "rejected resend is safely retryable");
  const rejectedResendReplay = await request(rejectedApp)
    .post(`/api/v1/onboarding/attempts/${raceAttemptId}/resend`)
    .set("authorization", `Onboarding ${resumed.body.onboarding_token}`)
    .set("idempotency-key", rejectedResendKey)
    .send({});
  check(
    rejectedResendReplay.status === 200 &&
      rejectedResendReplay.body.status === "verification_temporarily_unavailable" &&
      rejectedResendReplay.body.resend_available_at === rejectedResend.body.resend_available_at,
    "rejected resend replay preserves its exact retryable outcome and cooldown"
  );
  check((await prisma.onboardingAttempt.findUniqueOrThrow({ where: { id: raceAttemptId } })).current_challenge_id === afterAcceptedResend.current_challenge_id, "rejected resend preserves prior challenge");
  await prisma.otpChallenge.update({ where: { id: afterAcceptedResend.current_challenge_id! }, data: { last_sent_at: new Date(Date.now() - 120_000) } });
  const concurrentResends = await Promise.all([
    request(app).post(`/api/v1/onboarding/attempts/${raceAttemptId}/resend`).set("authorization", `Onboarding ${resumed.body.onboarding_token}`).set("idempotency-key", key("resend-race-a")).send({}),
    request(app).post(`/api/v1/onboarding/attempts/${raceAttemptId}/resend`).set("authorization", `Onboarding ${resumed.body.onboarding_token}`).set("idempotency-key", key("resend-race-b")).send({})
  ]);
  check(concurrentResends.filter((response) => response.status === 200).length === 1, "concurrent resend has one winner");
  check(concurrentResends.some((response) => response.status === 429), "concurrent resend cannot bypass cooldown");

  await clearStartCaps();
  const concurrentPhone = "+970599111120";
  const concurrentStarts = await Promise.all([
    request(app).post("/api/v1/onboarding/attempts").set("idempotency-key", key("start-race-a"))
      .send({ role: "driver", phone: concurrentPhone, email: contactEmail(concurrentPhone), region: "PS", locale: "ar" }),
    request(app).post("/api/v1/onboarding/attempts").set("idempotency-key", key("start-race-b"))
      .send({ role: "driver", phone: concurrentPhone, email: contactEmail(concurrentPhone), region: "PS", locale: "ar" })
  ]);
  check(concurrentStarts.every((response) => [200, 201].includes(response.status)), "concurrent starts both answer safely");
  // Known gap: two simultaneous starts with different keys can both stay live (the supersede step is not
  // atomic). That cannot create two accounts: completion re-checks the phone in a serializable transaction.
  check(
    await prisma.onboardingAttempt.count({ where: { phone_e164: concurrentPhone, status: { in: ["created", "otp_dispatching", "otp_sent", "phone_verified"] } } }) >= 1,
    "concurrent starts leave a live attempt for the phone"
  );

  const driverPassword = "driver secure pass 2026";
  const driver = await onboard("driver", "+970599111115", "سائق مساري", driverPassword);
  check(driver.completed.status === 201 && driver.completed.body.account_status === "pending", "driver is pending");
  check(driver.completed.body.next_action === "upload_documents", "driver is told to upload documents before review");
  check(!driver.completed.body.token && !driver.completed.body.refresh_token, "completion issues no operational session");
  check(Boolean(driver.completed.body.onboarding_status_token), "driver receives narrow status token");
  const driverCompletionReplay = await complete(
    driver.started.body.attempt.id,
    driver.started.body.onboarding_token,
    driver.verified.body.registration_grant,
    driver.documents,
    driver.name,
    driver.password,
    driver.completionKey
  );
  check(
    driverCompletionReplay.status === 200 &&
      driverCompletionReplay.body.account_status === "pending" &&
      Boolean(driverCompletionReplay.body.onboarding_status_token) &&
      driverCompletionReplay.body.onboarding_status_token !== driver.completed.body.onboarding_status_token,
    "driver exact completion replay rotates a fresh pending credential"
  );
  const changedDriverReplay = await complete(
    driver.started.body.attempt.id,
    driver.started.body.onboarding_token,
    driver.verified.body.registration_grant,
    driver.documents,
    "Changed Replay Name",
    driver.password,
    driver.completionKey
  );
  check(
    changedDriverReplay.status === 409 && changedDriverReplay.body.error === "registration_conflict",
    "completed continuation accepts only the original completion payload"
  );
  const newKeyDriverReplay = await complete(
    driver.started.body.attempt.id,
    driver.started.body.onboarding_token,
    driver.verified.body.registration_grant,
    driver.documents,
    driver.name,
    driver.password,
    key("complete-after-revocation")
  );
  check(
    newKeyDriverReplay.status === 401 && newKeyDriverReplay.body.error === "onboarding_unavailable",
    "completed continuation cannot authorize a new completion operation"
  );
  check(Date.parse(driver.completed.body.onboarding_status_expires_at) > Date.now(), "driver receives exact pending-session expiry");
  check(
    (await request(app).get("/api/v1/onboarding/status").set("authorization", `Onboarding ${driver.completed.body.onboarding_status_token}`)).status === 401,
    "driver completion replay revokes the superseded pending credential"
  );
  const driverStatus = await request(app).get("/api/v1/onboarding/status").set("authorization", `Onboarding ${driverCompletionReplay.body.onboarding_status_token}`);
  check(driverStatus.status === 200 && driverStatus.body.onboarding_status === "documents_required", "pending status endpoint asks for documents");
  check((await request(app).get("/api/v1/driver/routes").set("authorization", `Onboarding ${driver.completed.body.onboarding_status_token}`)).status === 401, "pending token cannot access operational routes");
  check((await request(app).post("/api/v1/auth/login").send({ phone: "+970599111115", password: driverPassword })).status === 403, "a pending driver cannot sign in by phone");
  const driverUser = await prisma.user.findUniqueOrThrow({ where: { phone: "+970599111115" } });
  check(await prisma.authSession.count({ where: { user_id: driverUser.id } }) === 0, "driver completion creates no auth session");
  check(await prisma.refreshToken.count({ where: { session: { user_id: driverUser.id } } }) === 0, "driver completion creates no refresh token");
  const login = await request(app).post("/api/v1/auth/login").send({ phone: "٠٥٩٩١١١١١٥", region: "PS", password: driverPassword });
  check(login.status === 401 && login.body.error === "invalid_credentials", "a phone number without a country code is refused at sign-in");
  const recovered = await request(app).post("/api/v1/onboarding/status-sessions").send({ phone: "+970599111115", region: "PS", password: driverPassword });
  check(
    recovered.status === 200 &&
      recovered.body.onboarding_status === "documents_required" &&
      recovered.body.role === "driver" &&
      Date.parse(recovered.body.onboarding_status_expires_at) > Date.now(),
    "pending status recovery works without disclosing role before authentication"
  );
  const wrongRecovery = await request(app).post("/api/v1/onboarding/status-sessions").send({ phone: "+970599111115", region: "PS", password: "wrong password value" });
  check(wrongRecovery.status === 401 && wrongRecovery.body.error === "invalid_credentials", "wrong recovery credentials are generic");
  const driverVerification = await prisma.driverVerification.findUnique({ where: { user_id: driverUser.id } });
  check(
    driverVerification?.status === "pending" && driverVerification.revision === 1,
    "driver completion creates exactly one pending verification lifecycle"
  );
  const suspended = await request(app)
    .patch(`/api/v1/admin/users/${driverUser.id}/status`)
    .set("authorization", `Bearer ${admin}`)
    .send({ status: "suspended", reason: "Integration validation", expected_status: "pending" });
  check(suspended.status === 200, "admin can suspend a pending onboarding account");
  check(
    (await request(app).get("/api/v1/onboarding/status").set("authorization", `Onboarding ${recovered.body.onboarding_status_token}`)).status === 401,
    "suspension revokes pending status token"
  );

  const merchant = await onboard("merchant", "+970599111116", "تاجر مساري", "merchant secure pass 2026");
  check(merchant.completed.status === 201 && merchant.completed.body.account_status === "pending", "merchant is pending");
  check(!merchant.completed.body.token && Boolean(merchant.completed.body.onboarding_status_token), "merchant receives status token only");
  const merchantCompletionReplay = await complete(
    merchant.started.body.attempt.id,
    merchant.started.body.onboarding_token,
    merchant.verified.body.registration_grant,
    merchant.documents,
    merchant.name,
    merchant.password,
    merchant.completionKey
  );
  check(
    merchantCompletionReplay.status === 200 &&
      merchantCompletionReplay.body.account_status === "pending" &&
      Boolean(merchantCompletionReplay.body.onboarding_status_token) &&
      merchantCompletionReplay.body.onboarding_status_token !== merchant.completed.body.onboarding_status_token,
    "merchant exact completion replay rotates a fresh pending credential"
  );

  const replayKey = key("verify-replay");
  const replayStart = await start("driver", "+970599111117");
  const replayOtp = latestOtp();
  const firstVerify = await verify(replayStart.body.attempt.id, replayStart.body.onboarding_token, replayOtp, replayKey);
  const secondVerify = await verify(replayStart.body.attempt.id, replayStart.body.onboarding_token, replayOtp, replayKey);
  check(firstVerify.status === 200 && secondVerify.status === 200, "exact verify replay succeeds safely");
  check(firstVerify.body.registration_grant !== secondVerify.body.registration_grant, "verify replay rotates raw grant");
  const conflictVerify = await verify(replayStart.body.attempt.id, replayStart.body.onboarding_token, "000000", replayKey);
  check(conflictVerify.status === 409 && conflictVerify.body.error === "registration_conflict", "same idempotency key with different payload conflicts");

  const mismatchedConsents = legal.map((document, index) => index === 0 ? { ...document, content_hash: "0".repeat(64) } : document);
  const consentMismatch = await complete(replayStart.body.attempt.id, replayStart.body.onboarding_token, secondVerify.body.registration_grant, mismatchedConsents, "Concurrency User", "concurrency secure pass", key("consent-mismatch"));
  check(consentMismatch.status === 409 && consentMismatch.body.error === "consent_version_changed", "consent version mismatch is rejected");
  const missingAdult = await request(app)
    .post(`/api/v1/onboarding/attempts/${replayStart.body.attempt.id}/complete`)
    .set("authorization", `Onboarding ${replayStart.body.onboarding_token}`)
    .set("idempotency-key", key("adult-required"))
    .send({ registration_grant: secondVerify.body.registration_grant, display_name: "Concurrency User", password: "concurrency secure pass", locale: "ar", consents: legal, adult_self_attestation: false });
  check(missingAdult.status === 400, "adult self-attestation is required");
  const concurrentCompletions = await Promise.all([
    complete(replayStart.body.attempt.id, replayStart.body.onboarding_token, secondVerify.body.registration_grant, legal, "Concurrency User", "concurrency secure pass", key("complete-race-a")),
    complete(replayStart.body.attempt.id, replayStart.body.onboarding_token, secondVerify.body.registration_grant, legal, "Concurrency User", "concurrency secure pass", key("complete-race-b"))
  ]);
  check(concurrentCompletions.filter((response) => response.status === 201).length === 1, "concurrent completion has one winner");
  check(await prisma.user.count({ where: { phone: "+970599111117" } }) === 1, "concurrent completion creates exactly one user");

  const digestRecord = await prisma.idempotencyRecord.findFirstOrThrow({ where: { operation: "onboarding_verify" }, orderBy: { created_at: "desc" } });
  check(![replayOtp, "000000", driverPassword].some((secret) => digestRecord.request_digest.includes(secret)), "idempotency record stores no raw secret-bearing payload");
  check(digestRecord.request_digest.length === 64, "idempotency request digest is fixed-length keyed material");

  const auditText = JSON.stringify(await prisma.auditEvent.findMany({ select: { metadata: true } }));
  check(!["+970599111115", replayOtp, driverPassword, secondVerify.body.registration_grant].some((secret) => auditText.includes(secret)), "audit metadata contains no raw onboarding secret or phone");

  if (config.driverDocuments) {
    await selfServiceChecks(admin, legal);
  }

  const onboardedUsers = await prisma.user.findMany({
    where: { demo_account: false },
    select: { id: true }
  });
  check(onboardedUsers.length >= 3, "onboarded users exist before reset");
  const protectedCounts = await Promise.all([
    prisma.user.count(),
    prisma.onboardingAttempt.count(),
    prisma.userConsent.count(),
    prisma.auditEvent.count()
  ]);
  try {
    await resetDemoData();
    throw new Error("reset unexpectedly accepted real-shaped onboarding users");
  } catch (error) {
    check(
      error instanceof Error && error.message === "demo_reset_real_data_present",
      "reset refuses a disposable database while non-demo users exist"
    );
  }
  check(
    JSON.stringify(await Promise.all([
      prisma.user.count(),
      prisma.onboardingAttempt.count(),
      prisma.userConsent.count(),
      prisma.auditEvent.count()
    ])) === JSON.stringify(protectedCounts),
    "blocked reset leaves onboarding data unchanged"
  );
  await prisma.user.updateMany({
    where: { id: { in: onboardedUsers.map(({ id }) => id) } },
    data: { demo_account: true }
  });
  await resetDemoData();
  check(await prisma.user.count({ where: { id: { in: onboardedUsers.map(({ id }) => id) } } }) === 0, "reset removes explicitly marked integration fixtures");
  check(await prisma.onboardingAttempt.count() === 0 && await prisma.onboardingSession.count() === 0, "reset removes onboarding attempts and sessions");
  check(await prisma.user.count({ where: { demo_account: true } }) === 5, "reset preserves deterministic demo accounts");
  check(await prisma.userConsent.count() === 0, "reset leaves no onboarding evidence orphan");
  check(await prisma.consentDocument.count() === 0 && await prisma.consentRelease.count() === 0, "reset removes test legal fixtures");

  console.log(`Public onboarding MySQL integration passed: ${checks.length} checks`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Public onboarding integration failed");
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
