import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { AdminBootstrapError, createOrResetAdmin, validateAdminInput } from "../services/adminBootstrap.js";
import { parseCliArgs, promptHidden, readPasswordFile, readStdinText, stripTrailingNewline } from "./adminCliInput.js";

const USAGE = `Usage: npm run admin:create -w @masari/api -- --email <email> --name <name> [options]
  --email, --name        or ADMIN_EMAIL / ADMIN_NAME in the environment
  --password-file <path> read the password from a file (mode 0600 recommended)
  --password-stdin       read the password from standard input
  (default)              hidden interactive prompt
  --reset-password       existing admin: set a new password, bump security_version, revoke sessions
  --dry-run              validate and report; write nothing
  --allow-demo-database  override the demo/test database refusal
The password is never accepted as an argument and is never printed.`;

async function main() {
  const { flags, values } = parseCliArgs(process.argv.slice(2));
  if (flags.has("help")) {
    console.log(USAGE);
    return;
  }
  const email = values.get("email") ?? process.env.ADMIN_EMAIL;
  const name = values.get("name") ?? process.env.ADMIN_NAME;
  if (!email) throw new AdminBootstrapError("email_required");
  const resetPassword = flags.has("reset-password");
  const dryRun = flags.has("dry-run");
  validateAdminInput({ email, name });
  if (!resetPassword && !name) throw new AdminBootstrapError("name_required");

  let password: string;
  if (values.has("password-file")) password = readPasswordFile(values.get("password-file")!);
  else if (flags.has("password-stdin")) password = stripTrailingNewline(await readStdinText());
  else {
    password = await promptHidden("Password (hidden): ");
    const confirmation = await promptHidden("Repeat password: ");
    if (confirmation !== password) throw new AdminBootstrapError("password_mismatch");
  }

  const result = await createOrResetAdmin(prisma, {
    email,
    name,
    password,
    resetPassword,
    dryRun,
    guard: {
      demoFeaturesEnabled: config.demoFeaturesEnabled,
      databaseName: new URL(config.databaseUrl).pathname.replace(/^\//, ""),
      demoResetAllowedDatabases: config.demoResetAllowedDatabases,
      allowDemoDatabase: flags.has("allow-demo-database")
    }
  });
  const verb = result.action === "created" ? "create admin" : "reset admin password for";
  console.log(result.dryRun ? `[dry-run] would ${verb} ${result.email}; nothing written.` : `Done: ${verb} ${result.email}.`);
}

try {
  await main();
} catch (error) {
  console.error(`admin:create failed: ${error instanceof Error ? error.message : "unknown"}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
