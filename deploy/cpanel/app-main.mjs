// Real startup code (an ES module). app.cjs is the file Passenger loads and imports this one.
// It loads ./.env, builds DATABASE_URL from the DB_* parts when it is not set (so the
// owner can paste the database password as-is, without URL-encoding), then starts the API.
// The API also serves the Admin site from ./admin (ADMIN_STATIC_DIR).
import { databaseUrlFromEnv, loadServerEnv } from "./ops/env.mjs";

loadServerEnv();
process.env.DATABASE_URL ??= databaseUrlFromEnv();

await import("./dist/server.js");
