// Adds three clearly-labelled demo accounts so the Admin approval screens have
// something to act on: a pending merchant, a pending driver, and a driver whose
// application was rejected (for the re-review demo). Safe to run repeatedly.
// Like demo reset, it only runs against an explicitly allow-listed database and
// the accounts are `demo_account`, so a protected reset removes them again.
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";

const databaseName = new URL(process.env.DATABASE_URL ?? "mysql://invalid/").pathname.slice(1);
const allowed = (process.env.DEMO_RESET_ALLOWED_DATABASES ?? "").split(",").map((value) => value.trim()).filter(Boolean);
if (databaseName.toLowerCase() === "masari" || !allowed.includes(databaseName)) {
  throw new Error("Approval demo seed refuses a database that is not explicitly reset-safe");
}
const merchantPassword = process.env.DEMO_MERCHANT_PASSWORD;
const driverPassword = process.env.DEMO_DRIVER_PASSWORD;
if (!merchantPassword || !driverPassword) throw new Error("DEMO_MERCHANT_PASSWORD and DEMO_DRIVER_PASSWORD are required");

const PHONES = { merchant: "+970590000006", rejectedDriver: "+970590000007", pendingDriver: "+970590000008" } as const;
const EMAILS: Record<string, string> = {
  [PHONES.merchant]: "demo.pending.merchant@masari.app",
  [PHONES.rejectedDriver]: "demo.rejected.driver@masari.app",
  [PHONES.pendingDriver]: "demo.pending.driver@masari.app"
};

async function account(phone: string, name: string, role: "merchant" | "driver", password: string) {
  await prisma.user.deleteMany({ where: { phone, demo_account: true } });
  await prisma.user.deleteMany({ where: { email: EMAILS[phone], demo_account: true } });
  return prisma.user.create({
    data: {
      name,
      phone,
      email: EMAILS[phone],
      email_verified_at: new Date(),
      phone_verified_at: new Date(),
      profile_state: "complete",
      password_hash: await bcrypt.hash(password, 10),
      role,
      account_status: "pending",
      review_submitted_at: new Date(),
      demo_account: true
    }
  });
}

const admin = await prisma.user.findFirst({ where: { role: "admin", demo_account: true }, select: { id: true } });
if (!admin) throw new Error("No demo admin found; run a protected demo reset first");

const merchant = await account(PHONES.merchant, "Demo Pending Merchant", "merchant", merchantPassword);

await account(PHONES.pendingDriver, "Demo Pending Driver", "driver", driverPassword).then((user) =>
  prisma.driverVerification.create({ data: { user_id: user.id, status: "pending" } })
);

const rejected = await account(PHONES.rejectedDriver, "Demo Rejected Driver", "driver", driverPassword);
const verification = await prisma.driverVerification.create({
  data: {
    user_id: rejected.id,
    status: "rejected",
    rejection_reason: "Licence photo was unreadable",
    revision: 2,
    reviewed_at: new Date(),
    reviewed_by_id: admin.id
  }
});
await prisma.driverVerificationDecision.create({
  data: {
    verification_id: verification.id,
    revision: 1,
    decision: "rejected",
    reason: "Licence photo was unreadable",
    decided_by_id: admin.id
  }
});

console.log(JSON.stringify({ ok: true, merchant: merchant.phone, pendingDriver: PHONES.pendingDriver, rejectedDriver: PHONES.rejectedDriver }));
await prisma.$disconnect();
