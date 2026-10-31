import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, relative } from "node:path";
import { run } from "./lib/process.mjs";
import { inspectManifest, readApkManifest } from "./lib/apk-location-policy.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index++) {
  const item = process.argv[index];
  if (item === "--") continue;
  if (item.includes("=") && item.startsWith("--")) {
    const [key, ...value] = item.split("=");
    args.set(key, value.join("="));
  } else if (item.startsWith("--")) args.set(item, process.argv[++index]);
}
const positional = process.argv.slice(2).filter((value) => value !== "--" && !value.startsWith("--"));
if (!args.has("--admin-dir") && positional[0] && !positional[0].toLowerCase().endsWith(".apk")) args.set("--admin-dir", positional[0]);
if (!args.has("--apk")) {
  const apk = positional.find((value) => value.toLowerCase().endsWith(".apk"));
  if (apk) args.set("--apk", apk);
}
const roots = [];
const findings = [];
let temporary;
if (args.has("--admin-dir")) roots.push(resolve(args.get("--admin-dir")));
try {
  if (args.has("--apk")) {
    const apk = resolve(args.get("--apk"));
    for (const rule of inspectManifest(readApkManifest(apk))) findings.push({ rule, file: "AndroidManifest.xml" });
    temporary = mkdtempSync(join(tmpdir(), "masari-apk-scan-"));
    try {
      run("jar", ["-xf", apk], { cwd: temporary });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      run("tar", ["-xf", apk, "-C", temporary]);
    }
    roots.push(temporary);
  }
  if (!roots.length) throw new Error("Provide --admin-dir <path> and/or --apk <path>");

  const rules = [
    ["checkpoint partner credential", /\bar_partner_[A-Za-z0-9_]{20,}\b/],
    ["demo reset endpoint", /\/api\/v1\/demo\/reset/i],
    ["demo reset header", /x-demo-reset-key/i],
    ["full demo sequence", /Full Demo Sequence/],
    ["simulation mutation", /\/simulate\/(?:step|reset)/i],
    ["known demo credential label", /DEMO_(?:PASSENGER|DRIVER|MERCHANT|ADMIN)_(?:EMAIL|PASSWORD)/],
    ["route provider server secret", /ROUTE_PROVIDER_SECRET|MAPBOX_ACCESS_TOKEN|GOOGLE_MAPS_API_KEY|HERE_API_KEY|STADIA_API_KEY/i],
    ["Flutter background location dependency", /\b(?:background_locator|flutter_background_geolocation)\b/i]
  ];
  const rawNeedles = new Map([
    ["checkpoint partner credential", ["ar_partner_"]],
    ["demo reset endpoint", ["/api/v1/demo/reset"]],
    ["demo reset header", ["x-demo-reset-key"]],
    ["full demo sequence", ["Full Demo Sequence"]],
    ["simulation mutation", ["/simulate/step", "/simulate/reset"]],
    ["known demo credential label", ["DEMO_PASSENGER_EMAIL", "DEMO_PASSENGER_PASSWORD", "DEMO_DRIVER_EMAIL", "DEMO_DRIVER_PASSWORD", "DEMO_MERCHANT_EMAIL", "DEMO_MERCHANT_PASSWORD", "DEMO_ADMIN_EMAIL", "DEMO_ADMIN_PASSWORD"]],
    ["route provider server secret", ["ROUTE_PROVIDER_SECRET", "MAPBOX_ACCESS_TOKEN", "GOOGLE_MAPS_API_KEY", "HERE_API_KEY", "STADIA_API_KEY"]],
    ["Flutter background location dependency", ["background_locator", "flutter_background_geolocation"]]
  ]);
  // APKs contain large native libraries and DEX files. Decode them in bounded
  // chunks so the scanner cannot exhaust the Node heap while still checking
  // every byte for policy strings (including UTF-16 encoded values).
  const chunkSize = 1024 * 1024;
  const overlap = 256;
  const utf16DecodeLimit = 256 * 1024;
  const nonTextExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".9", ".ttf", ".otf", ".arsc", ".frag", ".z"]);
  function decodeUtf16Be(buffer) {
    const length = buffer.length - (buffer.length % 2);
    const swapped = Buffer.allocUnsafe(length);
    for (let index = 0; index < length; index += 2) {
      swapped[index] = buffer[index + 1];
      swapped[index + 1] = buffer[index];
    }
    return swapped.toString("utf16le");
  }
  function matchingRules(buffer, decodeUtf16) {
    const matched = new Set();
    for (let offset = 0; offset < buffer.length; offset += chunkSize) {
      const start = Math.max(0, offset - overlap);
      const end = Math.min(buffer.length, offset + chunkSize + overlap);
      const chunk = buffer.subarray(start, end);
      const contents = [chunk.toString("utf8")];
      // UTF-16 support is retained for text-sized artifacts and fixtures;
      // large APK binaries are scanned as UTF-8 to keep memory bounded.
      if (decodeUtf16) contents.push(
        chunk.toString("utf16le"),
        chunk.subarray(1).toString("utf16le"),
        decodeUtf16Be(chunk),
        decodeUtf16Be(chunk.subarray(1))
      );
      for (const [rule, pattern] of rules) {
        if (contents.some((content) => pattern.test(content))) matched.add(rule);
      }
    }
    return matched;
  }
  function rawMatchingRules(buffer) {
    const matched = new Set();
    for (const [rule, needles] of rawNeedles) {
      if (needles.some((needle) => buffer.includes(Buffer.from(needle)))) matched.add(rule);
    }
    return matched;
  }
  function walk(root, path = root) {
    for (const entry of readdirSync(path)) {
      const file = join(path, entry);
      if (statSync(file).isDirectory()) walk(root, file);
      else {
        const buffer = readFileSync(file);
        const matched = rawMatchingRules(buffer);
        if (nonTextExtensions.has(file.slice(file.lastIndexOf(".")).toLowerCase())) {
          for (const rule of matched) findings.push({ rule, file: relative(root, file) });
          continue;
        }
        const sampleLength = Math.min(buffer.length, 4096);
        let zeroBytes = 0;
        for (let index = 0; index < sampleLength; index++) if (buffer[index] === 0) zeroBytes++;
        const decodeUtf16 = buffer.length <= utf16DecodeLimit && zeroBytes / Math.max(sampleLength, 1) >= 0.1;
        for (const rule of matchingRules(buffer, decodeUtf16)) matched.add(rule);
        for (const rule of matched) findings.push({ rule, file: relative(root, file) });
      }
    }
  }
  for (const root of roots) walk(root);
  for (const finding of findings) console.error(`ARTIFACT ${finding.rule}: ${finding.file}`);
  if (findings.length) process.exitCode = 1;
  else console.log("Production artifact scan passed.");
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
