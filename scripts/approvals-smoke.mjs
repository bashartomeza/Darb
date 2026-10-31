// Exercises Admin merchant approval and driver re-review over HTTP. Expects the
// accounts created by `seedApprovalsDemo.ts` (run it first, after a reset), and
// changes only those demo accounts.
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: resolve(import.meta.dirname, "../apps/api/.env"), quiet: true });

const apiBaseUrl = `${(process.env.DEMO_API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/v1`;
const allowed = (process.env.DEMO_RESET_ALLOWED_DATABASES ?? "").split(",").map((value) => value.trim()).filter(Boolean);
let databaseName = "";
try { databaseName = new URL(process.env.DATABASE_URL).pathname.replace(/^\//, ""); } catch {}
if (databaseName.toLowerCase() === "masari" || !allowed.includes(databaseName)) {
  throw new Error("Approvals smoke refuses a database that is not explicitly reset-safe");
}

const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function request(path, { token, method = "GET", body, expected = 200 } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000)
  });
  const text = await response.text();
  if (response.status !== expected) throw new Error(`${method} ${path}: expected ${expected}, received ${response.status} (${text.slice(0, 120)})`);
  return text ? JSON.parse(text) : null;
}

const login = (email, password, expected = 200) => request("/auth/login", { method: "POST", body: { email, password }, expected });

async function run() {
  const admin = (await login("demo.admin@masari.app", process.env.DEMO_ADMIN_PASSWORD)).token;
  const merchantPhone = "+970590000006";
  const driverPhone = "+970590000007";
  const merchantEmail = "demo.pending.merchant@masari.app";
  const driverEmail = "demo.rejected.driver@masari.app";

  // Merchant approval -------------------------------------------------------
  const pendingMerchants = await request("/admin/users?role=merchant&account_status=pending", { token: admin });
  const merchant = pendingMerchants.users.find((user) => user.phone === merchantPhone);
  assert(merchant, "seeded pending merchant is missing (run the approvals seed first)");
  assert(merchant.role_context.merchant_approval_connected === true, "merchant approval should be connected");
  await login(merchantEmail, process.env.DEMO_MERCHANT_PASSWORD, 403);
  await request(`/admin/merchant-approvals/${merchant.id}/reject`, { token: admin, method: "POST", body: {}, expected: 400 });
  await request(`/admin/merchant-approvals/${merchant.id}/approve`, { token: admin, method: "POST", body: {} });
  const merchantToken = (await login(merchantEmail, process.env.DEMO_MERCHANT_PASSWORD)).token;
  await request("/merchant/reports/summary", { token: merchantToken });
  await request(`/admin/merchant-approvals/${merchant.id}/approve`, { token: admin, method: "POST", body: {}, expected: 409 });

  // Driver re-review --------------------------------------------------------
  const rejected = await request("/admin/driver-verifications?status=rejected", { token: admin });
  const verification = rejected.verifications.find((item) => item.candidate.phone === driverPhone);
  assert(verification, "seeded rejected driver is missing");
  assert(verification.history.length === 1 && verification.history[0].decision === "rejected", "rejection history is missing");
  const userId = verification.candidate.id;
  await request(`/admin/driver-verifications/${userId}/reopen`, { token: admin, method: "POST", body: { expected_revision: verification.revision, reason: "x" }, expected: 400 });
  await request(`/admin/driver-verifications/${userId}/reopen`, { token: admin, method: "POST", body: { expected_revision: verification.revision + 5, reason: "Applicant sent a clear photo" }, expected: 409 });
  const reopened = (await request(`/admin/driver-verifications/${userId}/reopen`, {
    token: admin, method: "POST", body: { expected_revision: verification.revision, reason: "Applicant sent a clear photo" }
  })).verification;
  assert(reopened.status === "pending" && reopened.revision === verification.revision + 1, "reopened application should be pending at the next revision");
  assert(reopened.history.map((entry) => entry.decision).join() === "reopened,rejected", "history should keep the earlier rejection");
  await request(`/admin/driver-verifications/${userId}/reopen`, { token: admin, method: "POST", body: { expected_revision: reopened.revision, reason: "Applicant sent a clear photo" }, expected: 409 });

  const approved = (await request(`/admin/driver-verifications/${userId}/approve`, {
    token: admin, method: "POST", body: { expected_revision: reopened.revision, profile: { vehicle_type: "Demo sedan", seats_total: 4, parcel_capacity: 3 } }
  })).verification;
  assert(approved.status === "approved" && approved.history[0].decision === "approved", "approval after re-review failed");
  await login(driverEmail, process.env.DEMO_DRIVER_PASSWORD);
  const dashboard = await request("/admin/dashboard", { token: admin });
  assert(dashboard.counts.pending_driver_approvals === 1, "the seeded pending driver should still be waiting");
  return { ok: true };
}

run().then((result) => console.log(JSON.stringify(result))).catch((error) => {
  console.error(`[approvals:smoke] FAILED: ${error.message}`);
  process.exit(1);
});
