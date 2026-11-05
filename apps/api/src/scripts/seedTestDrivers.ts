import { prisma } from "../lib/prisma.js";
import { removeTestDrivers, requireTestAccountConfirmation, seedTestDrivers } from "../services/testDriverSeed.js";
import { parseCliArgs } from "./adminCliInput.js";

const USAGE = `Usage: node dist/scripts/seedTestDrivers.js --confirm-test-accounts [options]
  Creates driver1@darb.ps ... driver20@darb.ps (one approved, online test driver per predefined route).
  --confirm-test-accounts  required: acknowledges these are TEST accounts
  --credentials-file <p>   where passwords of new/reset accounts are written (mode 0600; required to write)
  --force                  overwrite an existing credentials file
  --reset-passwords        give existing test drivers a new password (default: keep them)
  --dry-run                report what would change; write nothing
  --remove                 delete the test drivers this script created
Passwords go only to the credentials file and are never printed. Output is counts only.`;

async function main() {
  const { flags, values } = parseCliArgs(process.argv.slice(2));
  if (flags.has("help")) {
    console.log(USAGE);
    return;
  }
  requireTestAccountConfirmation(flags);
  const dryRun = flags.has("dry-run");
  if (flags.has("remove")) {
    const result = await removeTestDrivers(prisma, { dryRun });
    console.log(`${dryRun ? "[dry-run] would remove" : "removed"}: matched=${result.matched} removed=${result.removed} suspended=${result.suspended} skipped_not_ours=${result.skippedNotOwned}`);
    return;
  }
  const result = await seedTestDrivers(prisma, {
    dryRun,
    resetPasswords: flags.has("reset-passwords"),
    credentialsFile: values.get("credentials-file"),
    force: flags.has("force")
  });
  console.log(
    `${dryRun ? "[dry-run] would apply" : "applied"}: drivers=${result.total} created=${result.created} updated=${result.updated} unchanged=${result.unchanged} ` +
      `routes_created=${result.routesCreated} routes_replaced=${result.routesReplaced} routes_kept=${result.routesKept} routes_busy=${result.routesBusy} ` +
      `consents_recorded=${result.consentsRecorded} consent_release=${result.consentRelease} passwords_written=${result.passwordsWritten}`
  );
}

try {
  await main();
} catch (error) {
  console.error(`drivers:seed-test failed: ${error instanceof Error ? error.message : "unknown"}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
