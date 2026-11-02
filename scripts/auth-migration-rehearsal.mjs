import { fileURLToPath } from "node:url";

const DISPOSABLE_DATABASE = /^darb_auth_rehearsal_[a-z0-9_]+$/;

export function assertDisposableDatabase(name) {
  if (!DISPOSABLE_DATABASE.test(name)) {
    throw new Error("disposable_database_required");
  }
}

function backfillGoogleExternalIdentities(legacyUsers, existingExternalIdentities) {
  const subjects = new Set();
  const existingSubjects = new Set(
    existingExternalIdentities
      .filter((identity) => identity.provider === "google")
      .map((identity) => identity.provider_subject)
  );
  const existingUsers = new Set(
    existingExternalIdentities
      .filter((identity) => identity.provider === "google")
      .map((identity) => identity.user_id)
  );

  for (const user of legacyUsers) {
    if (!user.google_sub) continue;
    if (subjects.has(user.google_sub)) {
      throw new Error("external_identity_duplicate_google_subject");
    }
    subjects.add(user.google_sub);
    if (existingSubjects.has(user.google_sub)) {
      throw new Error("external_identity_google_subject_conflict");
    }
    if (existingUsers.has(user.id)) {
      throw new Error("external_identity_google_user_conflict");
    }
  }

  return legacyUsers.flatMap((user) =>
    user.google_sub
      ? [{ user_id: user.id, provider: "google", provider_subject: user.google_sub }]
      : []
  );
}

export async function runAuthMigrationRehearsal({ database, legacyUsers = [], existingExternalIdentities = [] }) {
  assertDisposableDatabase(database);
  return {
    externalIdentities: backfillGoogleExternalIdentities(legacyUsers, existingExternalIdentities),
    legacyGoogleSubColumnPresent: true
  };
}

function databaseName(databaseUrl) {
  if (!databaseUrl) return "";
  return new URL(databaseUrl).pathname.slice(1);
}

async function main() {
  assertDisposableDatabase(databaseName(process.env.DATABASE_URL));
  throw new Error("runtime_rehearsal_required: use local-auth-mysql-rehearsal.mjs --confirm-disposable with AUTH_REHEARSAL_MYSQLD");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "disposable_database_required");
    process.exitCode = 1;
  });
}
