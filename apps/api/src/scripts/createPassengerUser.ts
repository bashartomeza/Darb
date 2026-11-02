import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";

const EMAIL = "zainab@gmail.com";
const PASSWORD = "Test@123456789";
const NAME = "Zainab";

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const now = new Date();
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: {
      name: NAME,
      password_hash: passwordHash,
      role: "passenger",
      account_status: "active",
      profile_state: "complete",
      email_verified_at: now
    },
    create: {
      name: NAME,
      email: EMAIL,
      email_verified_at: now,
      password_hash: passwordHash,
      profile_state: "complete",
      role: "passenger",
      account_status: "active",
      security_version: 1,
      demo_account: false
    }
  });
  console.log(
    JSON.stringify(
      {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        account_status: user.account_status,
        profile_state: user.profile_state,
        email_verified: Boolean(user.email_verified_at)
      },
      null,
      2
    )
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
