// Automated checks of the test plan's API-level items, run against the live test
// API on the disposable masari_demo database. It resets the data, exercises
// sign-in, role boundaries, approvals, sign-up with documents and the safety
// rules, then runs the existing demo smoke suites for the main story. Prints one
// line per check and a summary; exits non-zero if anything failed.
//
//   node scripts/test-env/run-checks.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { root, env, base, stateDir, otpFile, results, http, check, must, runNpm, powershellReset, latestOtp } from "./check-kit.mjs";
import { runNewFeatureChecks } from "./new-feature-checks.mjs";

// ---------------------------------------------------------------------------
// Main story and features: the existing end-to-end suites (they reset the data).
console.log("== Clean start (removes earlier test sign-ups)");
powershellReset();
console.log("== Main story and features (existing smoke suites)");
const smoke = runNpm("demo:smoke");
await check("D01-D07,D09,D10,A18", "main story: request, batch, match, accept, trip, tracking, comparison (demo:smoke)", () => must(smoke.ok, smoke.out.slice(-300)));
const features = runNpm("demo:features");
await check("D08,E04,E05,E06,E07,A16,A17", "notifications, incident reports and triage, reports and CSV export (demo:features)", () => must(features.ok, features.out.slice(-300)));

console.log("== Clean start, then roles, approvals and sign-up");
powershellReset();
const invitations = readFileSync(resolve(stateDir, "invitations.txt"), "utf8");
void invitations;

const login = async (email, password, path = "/auth/login") => http(path, { method: "POST", body: { email, password } });
const loginByPhone = async (phone, password) => http("/auth/mobile/login", { method: "POST", body: { phone, password } });
const E = {
  admin: ["demo.admin@masari.app", env.DEMO_ADMIN_PASSWORD],
  passenger: ["demo.passenger@masari.app", env.DEMO_PASSENGER_PASSWORD],
  driver: ["demo.driver@masari.app", env.DEMO_DRIVER_PASSWORD],
  driver2: ["demo.driver2@masari.app", env.DEMO_DRIVER_PASSWORD],
  merchant: ["demo.merchant@masari.app", env.DEMO_MERCHANT_PASSWORD],
};
const tokens = {};

await check("B03", "wrong password is refused with a clear error", async () => {
  const r = await login("nobody@example.com", "wrong-password-123");
  must(r.status === 401 && r.json?.error, `status ${r.status}`);
});
for (const role of ["passenger", "driver", "merchant"]) {
  await check(role === "passenger" ? "B04" : "B05", `${role} signs in and /me reports the right role`, async () => {
    const r = await login(...E[role]);
    must(r.status === 200 && r.json.token, `login ${r.status}`);
    tokens[role] = r.json.token;
    const me = await http("/me", { token: r.json.token, expect: 200 });
    must(me.json.user?.role === role, `role ${me.json.user?.role}`);
  });
}
await check("A01", "admin signs in", async () => {
  const r = await login(...E.admin, "/auth/admin/login");
  must(r.status === 200 && r.json.token, `login ${r.status}`);
  tokens.admin = r.json.token;
});
await check("B05", "second demo driver signs in", async () => {
  const r = await login(...E.driver2);
  must(r.status === 200, `login ${r.status}`);
  tokens.driver2 = r.json.token;
});
await check("F01", "a passenger cannot use the admin sign-in", async () => {
  const r = await login(...E.passenger, "/auth/admin/login");
  must([401, 403].includes(r.status), `status ${r.status}`);
});
await check("F01b", "an Admin never signs in by phone; an unknown phone is refused", async () => {
  const adminPhone = await http("/auth/admin/login", { method: "POST", body: { phone: "+970590000005", password: env.DEMO_ADMIN_PASSWORD } });
  must(adminPhone.status === 400, `admin by phone gave ${adminPhone.status}`);
  const adminByPhoneMobile = await loginByPhone("+970590000005", env.DEMO_ADMIN_PASSWORD);
  must(adminByPhoneMobile.status === 401, `admin by phone on the mobile path gave ${adminByPhoneMobile.status}`);
  const unknown = await loginByPhone("+970590009999", "whatever-password");
  must(unknown.status === 401, `unknown phone gave ${unknown.status}`);
});
await check("F04", "role boundaries: other roles' endpoints are refused", async () => {
  await http("/admin/users", { token: tokens.passenger, expect: 403 });
  await http("/admin/users", { token: tokens.merchant, expect: 403 });
  await http("/admin/users", { token: tokens.driver, expect: 403 });
  await http("/driver/routes", { token: tokens.passenger, expect: 403 });
  await http("/merchant/orders", { token: tokens.driver, expect: 403 });
  await http("/admin/users", { expect: 401 });
});

const adminToken = () => tokens.admin;
await check("A04,A05", "admin dashboard, lists and overview data load", async () => {
  for (const path of ["/admin/dashboard", "/admin/users", "/admin/drivers", "/admin/requests", "/admin/orders", "/admin/routes", "/admin/driver-verifications", "/admin/incidents", "/admin/reports/summary"]) {
    await http(path, { token: adminToken(), expect: 200 });
  }
});
await check("A06,A07", "user search and filters narrow the list; detail leaks no secrets", async () => {
  const merchants = await http("/admin/users?role=merchant&account_status=pending", { token: adminToken(), expect: 200 });
  must(merchants.json.users.some((u) => u.phone === "+970590000006"), "pending merchant not found");
  const found = await http("/admin/users?search=Pending", { token: adminToken(), expect: 200 });
  must(found.json.users.length >= 1, "search found nothing");
  const detail = await http(`/admin/users/${merchants.json.users[0].id}`, { token: adminToken(), expect: 200 });
  must(!/password|token_hash|security_version/i.test(JSON.stringify(detail.json)), "secret field in detail");
});

let passengerId;
await check("A08", "suspend needs a reason, blocks sign-in, reactivate restores it", async () => {
  const me = await http("/me", { token: tokens.passenger, expect: 200 });
  passengerId = me.json.user.id;
  const bad = await http(`/admin/users/${passengerId}/status`, { method: "PATCH", token: adminToken(), body: { status: "suspended", expected_status: "active" } });
  must(bad.status === 400, `no-reason suspend gave ${bad.status}`);
  await http(`/admin/users/${passengerId}/status`, { method: "PATCH", token: adminToken(), body: { status: "suspended", reason: "QA check", expected_status: "active" }, expect: 200 });
  const blocked = await login(...E.passenger);
  must([401, 403].includes(blocked.status), `suspended login gave ${blocked.status}`);
  await http(`/admin/users/${passengerId}/status`, { method: "PATCH", token: adminToken(), body: { status: "active", expected_status: "suspended" }, expect: 200 });
  const back = await login(...E.passenger);
  must(back.status === 200, `reactivated login gave ${back.status}`);
  tokens.passenger = back.json.token;
});

// --- Approvals on the seeded accounts
const seededLogin = (email, password) => login(email, password);
const pendingMerchantEmail = "demo.pending.merchant@masari.app";
const pendingDriverEmail = "demo.pending.driver@masari.app";
const rejectedDriverEmail = "demo.rejected.driver@masari.app";
await check("F02", "pending merchant and pending driver cannot sign in", async () => {
  must([401, 403].includes((await seededLogin(pendingMerchantEmail, env.DEMO_MERCHANT_PASSWORD)).status), "pending merchant got in");
  must([401, 403].includes((await seededLogin(pendingDriverEmail, env.DEMO_DRIVER_PASSWORD)).status), "pending driver got in");
});
await check("F03", "rejected driver cannot sign in", async () => {
  must([401, 403].includes((await seededLogin(rejectedDriverEmail, env.DEMO_DRIVER_PASSWORD)).status), "rejected driver got in");
});
await check("A09", "merchant approval: needs the right state, then the merchant can sign in", async () => {
  const users = await http("/admin/users?role=merchant&account_status=pending", { token: adminToken(), expect: 200 });
  const merchant = users.json.users.find((u) => u.phone === "+970590000006");
  await http(`/admin/merchant-approvals/${merchant.id}/approve`, { method: "POST", token: adminToken(), body: {}, expect: 200 });
  const r = await seededLogin(pendingMerchantEmail, env.DEMO_MERCHANT_PASSWORD);
  must(r.status === 200, `approved merchant login ${r.status}`);
  await http(`/admin/merchant-approvals/${merchant.id}/approve`, { method: "POST", token: adminToken(), body: {}, expect: 409 });
});

let pendingDriverId;
let pendingDriver;
await check("A11,A12", "driver review: evidence can be recorded and shows up", async () => {
  const list = await http("/admin/driver-verifications?status=pending", { token: adminToken(), expect: 200 });
  pendingDriver = list.json.verifications.find((v) => v.candidate.phone === "+970590000008");
  must(pendingDriver, "seeded pending driver missing");
  pendingDriverId = pendingDriver.candidate.id;
  await http(`/admin/driver-verifications/${pendingDriverId}/evidence`, { method: "POST", token: adminToken(), body: { expected_revision: pendingDriver.revision, kind: "driver_licence", note: "QA sighting" }, expect: 201 });
  const after = await http(`/admin/driver-verifications/${pendingDriverId}`, { token: adminToken(), expect: 200 });
  must(after.json.verification.evidence.status === "recorded" && after.json.verification.evidence.items.length === 1, "evidence not shown");
  await http(`/admin/driver-verifications/${pendingDriverId}/evidence`, { method: "POST", token: adminToken(), body: { expected_revision: 99, kind: "insurance" }, expect: 409 });
});
await check("A13", "approve the pending driver (profile required, then success, driver can sign in)", async () => {
  await http(`/admin/driver-verifications/${pendingDriverId}/approve`, { method: "POST", token: adminToken(), body: { expected_revision: pendingDriver.revision }, expect: 400 });
  await http(`/admin/driver-verifications/${pendingDriverId}/approve`, { method: "POST", token: adminToken(), body: { expected_revision: pendingDriver.revision, profile: { vehicle_type: "sedan", seats_total: 4, parcel_capacity: 4 } }, expect: 200 });
  const r = await seededLogin(pendingDriverEmail, env.DEMO_DRIVER_PASSWORD);
  must(r.status === 200, `approved driver login ${r.status}`);
});
await check("A14", "rejected application can be reopened; history keeps the rejection", async () => {
  const list = await http("/admin/driver-verifications?status=rejected", { token: adminToken(), expect: 200 });
  const rejected = list.json.verifications.find((v) => v.candidate.phone === "+970590000007");
  must(rejected, "seeded rejected driver missing");
  await http(`/admin/driver-verifications/${rejected.candidate.id}/reopen`, { method: "POST", token: adminToken(), body: { expected_revision: rejected.revision }, expect: 400 });
  const reopened = await http(`/admin/driver-verifications/${rejected.candidate.id}/reopen`, { method: "POST", token: adminToken(), body: { expected_revision: rejected.revision, reason: "QA reopen" }, expect: 200 });
  const v = reopened.json.verification;
  must(v.status === "pending", `status ${v.status}`);
  must(v.history.some((h) => h.decision === "rejected") && v.history.some((h) => h.decision === "reopened"), "history incomplete");
});

// --- Sign-up with invitations (all three roles), documents, rejection
const phones = { passenger: "+970590003001", driverA: "+970590003002", driverB: "+970590003003", merchant: "+970590003004" };
async function invite(role, phone) {
  return (await http("/admin/invitations", { method: "POST", token: adminToken(), body: { role, phone, contact_email: `qa.${phone.slice(-4)}@example.com` }, expect: 201 })).json.code;
}
async function signUp({ role, phone, code, name }) {
  const consents = (await http("/onboarding/consents?locale=en", { expect: 200 })).json.documents;
  const started = (await http("/onboarding/attempts", { method: "POST", headers: { "idempotency-key": `qa-start-${phone.slice(-4)}-${Date.now()}` }, body: { invitation_code: code, role, phone, locale: "en" }, expect: 201 })).json;
  const continuation = `Onboarding ${started.onboarding_token}`;
  await new Promise((r) => setTimeout(r, 400));
  const wrong = await http(`/onboarding/attempts/${started.attempt.id}/verify`, { method: "POST", token: continuation, headers: { "idempotency-key": `qa-wrong-${phone.slice(-4)}-${Date.now()}` }, body: { otp: "000000" } });
  const otp = latestOtp(phone);
  const verified = (await http(`/onboarding/attempts/${started.attempt.id}/verify`, { method: "POST", token: continuation, headers: { "idempotency-key": `qa-ok-${phone.slice(-4)}-${Date.now()}` }, body: { otp }, expect: 200 })).json;
  const password = `Qa-long-passphrase-${phone.slice(-4)}`;
  const done = (await http(`/onboarding/attempts/${started.attempt.id}/complete`, {
    method: "POST", token: continuation, headers: { "idempotency-key": `qa-done-${phone.slice(-4)}-${Date.now()}` },
    body: { registration_grant: verified.registration_grant, display_name: name, password, locale: "en", adult_self_attestation: true, consents: consents.map((c) => ({ id: c.id, type: c.type, content_hash: c.content_hash })) },
    expect: 201
  })).json;
  return { wrongStatus: wrong.status, done, password, started };
}

const people = {};
await check("C01,C02,C03", "passenger signs up: wrong code refused, right code works, active at once", async () => {
  const code = await invite("passenger", phones.passenger);
  const wrongPhone = await http("/onboarding/attempts", { method: "POST", headers: { "idempotency-key": `qa-bad-${Date.now()}` }, body: { invitation_code: code, role: "passenger", phone: "+970590009998", locale: "en" } });
  must(wrongPhone.status === 404, `wrong phone gave ${wrongPhone.status}`); // C14
  const r = await signUp({ role: "passenger", phone: phones.passenger, code, name: "QA Passenger" });
  must(r.wrongStatus >= 400, "wrong OTP was accepted");
  must(r.done.account_status === "active", `status ${r.done.account_status}`);
  people.passenger = r;
  const signedIn = await loginByPhone(phones.passenger, r.password);
  must(signedIn.status === 200 && signedIn.json.user.role === "passenger", `phone sign-in gave ${signedIn.status} ${JSON.stringify(signedIn.json).slice(0, 80)}`);
  const me = await http("/me", { token: signedIn.json.token, expect: 200 });
  must(me.json.user.phone === phones.passenger, "wrong account");
  const wrongPw = await loginByPhone(phones.passenger, "not-the-password");
  must(wrongPw.status === 401, `wrong password gave ${wrongPw.status}`);
});
await check("C14", "an invitation cannot be reused", async () => {
  const code = await invite("passenger", "+970590003010");
  await signUp({ role: "passenger", phone: "+970590003010", code, name: "QA Reuse" });
  const again = await http("/onboarding/attempts", { method: "POST", headers: { "idempotency-key": `qa-reuse-${Date.now()}` }, body: { invitation_code: code, role: "passenger", phone: "+970590003010", locale: "en" } });
  must(again.status >= 400 || again.json?.attempt?.status !== "otp_sent", `reuse gave ${again.status}`);
});

const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
async function upload(token, kind, bytes, expect) {
  return http(`/onboarding/driver-documents?kind=${kind}`, { method: "POST", token: `Onboarding ${token}`, raw: bytes, headers: { "content-type": "application/octet-stream" }, expect });
}
await check("C04,C05,C06,C07,C08,C09", "driver signs up, uploads documents, wrong type refused, delete works, limit of six", async () => {
  const code = await invite("driver", phones.driverA);
  const r = await signUp({ role: "driver", phone: phones.driverA, code, name: "QA Driver A" });
  must(r.done.account_status === "pending", `status ${r.done.account_status}`);
  const token = r.done.onboarding_status_token;
  must(token, "no pending-review token");
  people.driverA = { ...r, token };
  const empty = await http("/onboarding/driver-documents", { token: `Onboarding ${token}`, expect: 200 });
  must(empty.json.documents.length === 0, "list not empty");
  await upload(token, "driver_licence", jpeg, 201);
  await upload(token, "vehicle_registration", pdf, 201);
  await upload(token, "driver_licence", Buffer.from("this is plain text pretending to be a photo"), 415);
  const list = await http("/onboarding/driver-documents", { token: `Onboarding ${token}`, expect: 200 });
  must(list.json.documents.length === 2, `have ${list.json.documents.length}`);
  // A required document (licence, registration, national ID) cannot be removed once the application is
  // submitted, so the delete check uses an optional "other" file.
  const extra = await upload(token, "other", jpeg, 201);
  await http(`/onboarding/driver-documents/${extra.json.document.id}`, { method: "DELETE", token: `Onboarding ${token}`, expect: 200 });
  await http(`/onboarding/driver-documents/${list.json.documents[1].id}`, { method: "DELETE", token: `Onboarding ${token}`, expect: 409 });
  for (let i = 0; i < 4; i += 1) await upload(token, "other", jpeg, 201); // 2 + 4 = 6
  const seventh = await upload(token, "other", jpeg);
  must(seventh.status === 409, `7th document gave ${seventh.status}`);
});
await check("C10,C11,C12,F05", "admin downloads the document; pending driver cannot sign in; approval opens sign-in and closes uploads", async () => {
  const list = await http("/admin/driver-verifications?status=pending", { token: adminToken(), expect: 200 });
  const v = list.json.verifications.find((x) => x.candidate.phone === phones.driverA);
  must(v && v.evidence.documents.length === 6, `admin sees ${v?.evidence.documents.length} documents`);
  const dl = await http(`/admin/driver-verifications/${v.candidate.id}/documents/${v.evidence.documents[0].id}`, { token: adminToken(), expect: 200 });
  must(dl.buffer.equals(jpeg), "downloaded bytes differ");
  must((dl.headers.get("content-disposition") ?? "").startsWith("attachment"), "not an attachment");
  const blocked = await loginByPhone(phones.driverA, people.driverA.password);
  must(blocked.status === 403, `pending login ${blocked.status}`);
  await http(`/admin/driver-verifications/${v.candidate.id}/approve`, { method: "POST", token: adminToken(), body: { expected_revision: v.revision, profile: { vehicle_type: "van", seats_total: 6, parcel_capacity: 10 } }, expect: 200 });
  const approvedLogin = await loginByPhone(phones.driverA, people.driverA.password);
  must(approvedLogin.status === 200 && approvedLogin.json.user.role === "driver", `approved driver phone sign-in gave ${approvedLogin.status}`);
  const after = await http("/onboarding/driver-documents", { token: `Onboarding ${people.driverA.token}` });
  must([401, 403, 409].includes(after.status), `upload area after approval gave ${after.status}`);
  await upload(people.driverA.token, "other", jpeg).then((r) => must([401, 403, 409].includes(r.status), `upload after approval gave ${r.status}`));
});
await check("A15,F03", "reject needs a reason; a rejected applicant is closed out", async () => {
  const code = await invite("driver", phones.driverB);
  const r = await signUp({ role: "driver", phone: phones.driverB, code, name: "QA Driver B" });
  const list = await http("/admin/driver-verifications?status=pending", { token: adminToken(), expect: 200 });
  const v = list.json.verifications.find((x) => x.candidate.phone === phones.driverB);
  await http(`/admin/driver-verifications/${v.candidate.id}/reject`, { method: "POST", token: adminToken(), body: { expected_revision: v.revision }, expect: 400 });
  await http(`/admin/driver-verifications/${v.candidate.id}/reject`, { method: "POST", token: adminToken(), body: { expected_revision: v.revision, reason: "QA rejection reason" }, expect: 200 });
  const up = await upload(r.done.onboarding_status_token, "other", jpeg);
  must([401, 403, 409].includes(up.status), `upload after rejection gave ${up.status}`);
  const rejectedLogin = await loginByPhone(phones.driverB, r.password);
  must([401, 403].includes(rejectedLogin.status), `rejected applicant sign-in gave ${rejectedLogin.status}`);
});
await check("C13,A10", "merchant signs up (pending); rejection needs a reason and disables the account", async () => {
  const code = await invite("merchant", phones.merchant);
  const r = await signUp({ role: "merchant", phone: phones.merchant, code, name: "QA Merchant" });
  must(r.done.account_status === "pending", `status ${r.done.account_status}`);
  const users = await http("/admin/users?role=merchant&account_status=pending", { token: adminToken(), expect: 200 });
  const m = users.json.users.find((u) => u.phone === phones.merchant);
  // Shop papers: upload, wrong kind refused, admin lists and downloads.
  const shopToken = `Onboarding ${r.done.onboarding_status_token}`;
  const shopUpload = (kind, bytes, expect) => http(`/onboarding/merchant-documents?kind=${kind}`, { method: "POST", token: shopToken, raw: bytes, headers: { "content-type": "application/octet-stream" }, expect });
  await shopUpload("commercial_register", jpeg, 201);
  await shopUpload("shop_photo", pdf, 201);
  await shopUpload("driver_licence", jpeg, 400);
  await shopUpload("shop_photo", Buffer.from("not a photo"), 415);
  await http("/onboarding/driver-documents", { token: shopToken, expect: 403 });
  const shopList = await http("/onboarding/merchant-documents", { token: shopToken, expect: 200 });
  must(shopList.json.documents.length === 2, `shop owner sees ${shopList.json.documents.length} documents`);
  const adminList = await http(`/admin/merchant-approvals/${m.id}/documents`, { token: adminToken(), expect: 200 });
  must(adminList.json.documents.length === 2, `admin sees ${adminList.json.documents.length} documents`);
  const shopDownload = await http(`/admin/merchant-approvals/${m.id}/documents/${adminList.json.documents[0].id}`, { token: adminToken(), expect: 200 });
  must(shopDownload.buffer.equals(jpeg), "downloaded shop bytes differ");
  await http(`/admin/merchant-approvals/${m.id}/documents`, { token: tokens.passenger, expect: 403 });
  await http(`/admin/merchant-approvals/${m.id}/reject`, { method: "POST", token: adminToken(), body: {}, expect: 400 });
  await http(`/admin/merchant-approvals/${m.id}/reject`, { method: "POST", token: adminToken(), body: { reason: "QA rejection" }, expect: 200 });
  const detail = await http(`/admin/users/${m.id}`, { token: adminToken(), expect: 200 });
  must(detail.json.user.account_status === "disabled", `status ${detail.json.user.account_status}`);
  const disabledLogin = await loginByPhone(phones.merchant, r.password);
  must([401, 403].includes(disabledLogin.status), `disabled merchant sign-in gave ${disabledLogin.status}`);
});
await check("C15", "an applicant can check their application status", async () => {
  const code = await invite("merchant", "+970590003011");
  const r = await signUp({ role: "merchant", phone: "+970590003011", code, name: "QA Merchant 2" });
  const status = await http("/onboarding/status", { token: `Onboarding ${r.done.onboarding_status_token}`, expect: 200 });
  must(status.json.onboarding_status === "pending_review", `status ${status.json.onboarding_status}`);
});
await check("E02", "driver performance endpoint answers with a safe shape", async () => {
  const r = await http("/driver/performance", { token: tokens.driver, expect: 200 });
  must(typeof r.json.offers_responded === "number" && "acceptance_rate" in r.json, "bad shape");
  await http("/driver/performance", { token: tokens.passenger, expect: 403 });
});
await check("E06", "the 11th unresolved report is refused", async () => {
  let last;
  for (let i = 0; i < 11; i += 1) last = await http("/incidents", { method: "POST", token: tokens.passenger, body: { category: "other", description: `QA report ${i + 1}` } });
  must(last.status === 429, `11th gave ${last.status}`);
});
await check("F06", "the capability list does not claim live tracking", async () => {
  const caps = await http("/capabilities", { token: tokens.passenger, expect: 200 });
  must(caps.json.live_tracking_available === false, "live tracking claimed");
});

await runNewFeatureChecks({ tokens });

// ---------------------------------------------------------------------------
// Mark everything created here as demo data so the next reset removes it.
console.log("== Cleanup");
try {
  const { prisma } = await import(pathToFileURL(resolve(root, "apps/api/dist/lib/prisma.js")).href);
  const marked = await prisma.user.updateMany({ where: { phone: { in: [...Object.values(phones), "+970590003010", "+970590003011"] } }, data: { demo_account: true } });
  console.log(`marked ${marked.count} QA accounts as demo data`);
  await prisma.$disconnect();
} catch (error) {
  console.log("cleanup note:", String(error.message).slice(0, 160));
}
powershellReset();

mkdirSync(stateDir, { recursive: true });
writeFileSync(resolve(stateDir, "check-results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
for (const f of failed) console.log(`  FAIL ${f.id} ${f.name}: ${f.why}`);
process.exit(failed.length ? 1 : 0);
