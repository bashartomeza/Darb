/**
 * The guard the real-MySQL integration scripts run before touching a database: the
 * target must be a CI database (name ending in `_ci`), never `darb`, and explicitly on
 * DEMO_RESET_ALLOWED_DATABASES. Returns the database name, or throws before any query.
 */
export function requireDisposableIntegrationDatabase(
  env: { DATABASE_URL?: string; DEMO_RESET_ALLOWED_DATABASES?: string },
  scriptName: string
) {
  let database = "";
  try {
    database = decodeURIComponent(new URL(env.DATABASE_URL ?? "").pathname.slice(1));
  } catch {
    database = "";
  }
  const allowed = (env.DEMO_RESET_ALLOWED_DATABASES ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!database.endsWith("_ci") || database.toLowerCase() === "darb" || !allowed.includes(database)) {
    throw new Error(
      `${scriptName} refuses this database: use a disposable *_ci database listed in DEMO_RESET_ALLOWED_DATABASES`
    );
  }
  return database;
}
