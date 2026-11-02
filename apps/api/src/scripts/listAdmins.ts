import { prisma } from "../lib/prisma.js";
import { listAdmins } from "../services/adminBootstrap.js";

try {
  const rows = await listAdmins(prisma);
  if (rows.length === 0) console.log("No admin accounts.");
  else {
    console.log("email\tstatus\tcreated_at\tlast_login_at");
    for (const row of rows) {
      console.log([row.email ?? "", row.account_status, row.created_at.toISOString(), row.last_login_at?.toISOString() ?? "never"].join("\t"));
    }
  }
} catch (error) {
  console.error(`admin:list failed: ${error instanceof Error ? error.message : "unknown"}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
