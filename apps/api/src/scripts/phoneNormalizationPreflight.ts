import { prisma } from "../lib/prisma.js";
import { analyzePhoneNormalization } from "../lib/phone.js";

async function main() {
  const rows = await prisma.user.findMany({ select: { id: true, phone: true } });
  const users = rows.filter(
    (row): row is { id: string; phone: string } => row.phone !== null
  );
  const result = analyzePhoneNormalization(users);
  console.log(`Phone normalization preflight: total=${result.total}, valid=${result.valid}, invalid=${result.invalid}, collisions=${result.collisions}`);
  if (result.invalid > 0 || result.collisions > 0) process.exitCode = 1;
}

main()
  .catch(() => {
    console.error("Phone normalization preflight failed without exposing phone values.");
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
