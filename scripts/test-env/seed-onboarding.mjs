// Prepares sign-up testing on the disposable demo database: installs clearly
// labelled placeholder legal text (so onboarding is available) and creates one
// invitation per role for fixed test phone numbers. Codes are written to
// .staging-data/test-env/invitations.txt. Safe to repeat.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const env = Object.fromEntries(
  readFileSync(resolve(root, "apps/api/.env"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2].replace(/^"|"$/g, "")])
);
const base = `${process.env.TEST_API_BASE_URL ?? "http://localhost:3000"}/api/v1`;

const databaseName = new URL(process.env.DATABASE_URL ?? "mysql://invalid/").pathname.slice(1);
const allowed = (process.env.DEMO_RESET_ALLOWED_DATABASES ?? "").split(",").map((value) => value.trim()).filter(Boolean);
if (databaseName.toLowerCase() === "masari" || !allowed.includes(databaseName)) {
  throw new Error("Refusing: set DATABASE_URL and DEMO_RESET_ALLOWED_DATABASES to the disposable demo database.");
}

async function call(path, { method = "GET", token, body, expected = 200 } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  if (response.status !== expected) throw new Error(`${method} ${path}: expected ${expected}, got ${response.status} ${text.slice(0, 120)}`);
  return text ? JSON.parse(text) : null;
}

const admin = (await call("/auth/login", { method: "POST", body: { email: "demo.admin@masari.app", password: env.DEMO_ADMIN_PASSWORD } })).token;

const current = await call("/admin/consent-releases/current", { token: admin });
if (!current.ready) {
  const documents = ["terms", "privacy", "adult_self_attestation"].flatMap((type) =>
    ["ar", "en"].map((locale) => ({ type, locale, content: `TEST/DEMO ONLY - ${type} (${locale}) - placeholder, not legal text` }))
  );
  const version = `test-${new Date().toISOString().slice(0, 10)}`;
  const created = (await call("/admin/consent-releases", {
    method: "POST", token: admin, expected: 201,
    body: { version, intended_effective_at: new Date(Date.now() - 60_000).toISOString(), documents }
  })).release;
  const approved = (await call(`/admin/consent-releases/${version}/approve`, {
    method: "POST", token: admin, body: { expected_revision: created.revision, legal_approval_confirmed: true }
  })).release;
  await call(`/admin/consent-releases/${version}/activate`, {
    method: "POST", token: admin,
    body: { expected_revision: approved.revision, expected_current_release_id: null, activation_confirmed: true }
  });
}

const people = [
  { role: "passenger", phone: "+970590002001" },
  { role: "driver", phone: "+970590002002" },
  { role: "merchant", phone: "+970590002003" }
];
const lines = [];
// Masari sends no SMS: each invitation records the email its one-time code is sent to.
// DEMO_CODE_INBOX (the tester's own mailbox) when set, otherwise a placeholder address (codes are still in the log file).
for (const person of people) {
  const contact_email = process.env.DEMO_CODE_INBOX || `${person.role}.demo@example.com`;
  const result = await call("/admin/invitations", { method: "POST", token: admin, expected: 201, body: { ...person, contact_email } });
  lines.push(`${person.role.padEnd(10)} phone ${person.phone}   code email ${contact_email}   invitation code ${result.code}`);
}
const dir = resolve(root, ".staging-data/test-env");
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, "invitations.txt"), lines.join("\n") + "\n");
console.log(lines.join("\n"));
