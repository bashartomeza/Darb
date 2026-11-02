import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const prohibitedPathRules = [
  ["environment file", /(^|\/)\.env(?:\.|$)/i, (path) => /\.env(?:\.[^/]+)?\.(?:example|sample|template)$/i.test(path) || /(^|\/)\.env\.example$/i.test(path)],
  ["private key or keystore", /(?:\.jks|\.keystore|\.p12|\.pfx|\.pem|\.key)$/i],
  ["Android key properties", /(^|\/)key\.properties$/i],
  ["database dump", /(?:\.sql|\.dump)(?:\.gz)?$/i, (path) => /(^|\/)prisma\/migrations\/[^/]+\/migration\.sql$/i.test(path)],
  ["release archive", /(?:\.zip|\.apk|\.aab)$/i],
  ["build cache", /(^|\/)(?:node_modules|dist|build|\.dart_tool|\.gradle)(\/|$)/i]
];

const contentRules = [
  ["checkpoint partner credential", /\bar_partner_[A-Za-z0-9_]{20,}\b/],
  ["private key header", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["credentialed database URL", /mysql:\/\/[^<\s:"']+:[^<\s@"']+@/i,
    (path) => /(^|\/)(?:apps\/api\/src\/tests\/|apps\/api\/vitest\.config\.ts$|\.github\/workflows\/ci-backend\.yml$)/i.test(path)]
];

export function scanTracked(paths) {
  const findings = [];
  for (const path of paths) {
    for (const [rule, pattern, exception] of prohibitedPathRules) {
      if (pattern.test(path) && !(exception?.(path))) findings.push({ rule, path });
    }
    if ([".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2"].includes(extname(path).toLowerCase())) continue;
    let content;
    try { content = readFileSync(path, "utf8"); } catch { continue; }
    for (const [rule, pattern, exception] of contentRules) {
      if (pattern.test(content) && !(exception?.(path))) findings.push({ rule, path });
    }
  }
  return findings;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const result = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("Unable to enumerate Git-tracked files");
  const findings = scanTracked(result.stdout.split("\0").filter(Boolean));
  for (const finding of findings) console.error(`SECURITY ${finding.rule}: ${finding.path}`);
  if (findings.length) process.exit(1);
  console.log("Tracked-file and high-confidence secret scan passed.");
}
