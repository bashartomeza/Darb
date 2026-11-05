import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parse } from "yaml";

const root = resolve(new URL("../", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const workflowDir = resolve(root, ".github/workflows");
const required = new Map([
  ["ci-backend.yml", ["mysql", "npm ci", "npm run db:migrate", "npm run test:integration:mysql", "-m pytest apps/api/ai_services/tests"]],
  ["ci-admin.yml", ["npm run typecheck:admin", "npm run test:admin", "npm run security:artifacts"]],
  ["ci-mobile.yml", ["flutter pub get", "flutter analyze", "flutter test", "flutter build apk"]],
  ["ci-security.yml", ["npm run security:scan", "npm run security:audit", "npm run test:tooling"]]
]);

for (const [name, markers] of required) {
  const path = resolve(workflowDir, name);
  if (!existsSync(path)) throw new Error(`Missing workflow: ${name}`);
  const source = readFileSync(path, "utf8");
  const document = parse(source);
  if (!document || typeof document !== "object" || !document.jobs) throw new Error(`${name}: jobs are required`);
  for (const marker of markers) {
    if (!source.includes(marker)) throw new Error(`${name}: required step marker is missing: ${marker}`);
  }
  if (/mysql:\/\/[^\s"']+:[^\s"']+@(?!127\.0\.0\.1|localhost)/i.test(source)) {
    throw new Error(`${name}: non-local database credential literal is prohibited`);
  }
  for (const match of source.matchAll(/(?:node|pwsh|bash)\s+([^\s"']+\.(?:mjs|ps1|sh))/g)) {
    const referenced = resolve(root, match[1]);
    if (!existsSync(referenced)) throw new Error(`${name}: referenced script does not exist: ${match[1]}`);
  }
}

for (const name of readdirSync(workflowDir).filter((entry) => /\.ya?ml$/.test(entry))) {
  parse(readFileSync(resolve(workflowDir, name), "utf8"));
}
console.log(`${required.size} GitHub Actions workflows parsed and passed structural checks.`);
