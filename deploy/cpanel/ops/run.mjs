// Runs one command with the server environment (.env + DATABASE_URL), e.g.
//   node ops/run.mjs npx prisma migrate deploy
//   node ops/run.mjs node dist/scripts/createAdmin.js
// Secrets go to the child process only; nothing is printed.
import { spawnSync } from "node:child_process";
import { appRoot, databaseUrlFromEnv, loadServerEnv } from "./env.mjs";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Usage: node ops/run.mjs <command> [args...]");
  process.exit(2);
}
loadServerEnv();
process.env.DATABASE_URL ??= databaseUrlFromEnv();
const result = spawnSync(command, args, { cwd: appRoot, stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
