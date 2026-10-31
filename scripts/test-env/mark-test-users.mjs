// Marks accounts created by test sign-ups (the fixed +97059000200x / +97059000300x
// numbers, the open sign-up tester numbers and the automated check numbers) as demo data, so the protected demo reset can remove them. Only runs
// against an explicitly allow-listed disposable database.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../..");
const databaseName = new URL(process.env.DATABASE_URL ?? "mysql://invalid/").pathname.slice(1);
const allowed = (process.env.DEMO_RESET_ALLOWED_DATABASES ?? "").split(",").map((value) => value.trim()).filter(Boolean);
if (databaseName.toLowerCase() === "masari" || !allowed.includes(databaseName)) {
  throw new Error("Refusing: not an explicitly allow-listed disposable database.");
}
process.env.APP_ENV ??= "demo";
const { prisma } = await import(pathToFileURL(resolve(root, "apps/api/dist/lib/prisma.js")).href);
const result = await prisma.user.updateMany({
  where: { demo_account: false, OR: [{ phone: { startsWith: "+9705900020" } }, { phone: { startsWith: "+9705900030" } },
    // open sign-up testers (+97059000400x) and the automated new-feature checks (+97059005xxxx, 6, 8)
    { phone: { startsWith: "+9705900040" } }, { phone: { startsWith: "+97059005" } }, { phone: { startsWith: "+97059006" } }, { phone: { startsWith: "+97059008" } }, { email: { endsWith: "@example.com" } }] },
  data: { demo_account: true }
});
console.log(`Marked ${result.count} test sign-up account(s) as demo data.`);
await prisma.$disconnect();
