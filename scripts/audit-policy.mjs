import { spawnSync } from "node:child_process";
import { executable } from "./lib/process.mjs";

const npmFile = process.platform === "win32" && process.env.npm_execpath ? process.execPath : executable("npm");
const npmArgs = process.platform === "win32" && process.env.npm_execpath
  ? [process.env.npm_execpath, "audit", "--omit=dev", "--json"]
  : ["audit", "--omit=dev", "--json"];
const result = spawnSync(npmFile, npmArgs, { encoding: "utf8", shell: false });
if (result.error) throw result.error;
let report;
try { report = JSON.parse(result.stdout || "{}"); } catch { throw new Error("npm audit did not return valid JSON"); }
const vulnerabilities = report.vulnerabilities ?? {};
const blocking = [];
for (const [name, item] of Object.entries(vulnerabilities)) {
  if (["moderate", "high", "critical"].includes(item.severity)) blocking.push(`${name} (${item.severity})`);
}
if (blocking.length) {
  for (const item of blocking) console.error(`AUDIT ${item}`);
  process.exit(1);
}
console.log("Dependency audit policy passed: no moderate, high, or critical findings.");
