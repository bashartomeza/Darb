import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [record, mode = "stubborn"] = process.argv.slice(2);
appendFileSync(record, `${process.pid}\n`);
if (mode === "tree") {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), record], { stdio: "ignore", windowsHide: true });
  child.unref();
}
if (mode === "orphan") {
  spawn(process.execPath, [fileURLToPath(import.meta.url), record], { stdio: "inherit", windowsHide: true }).unref();
  setTimeout(() => process.exit(0), 150);
} else {
  process.on("SIGTERM", () => {});
  process.on("SIGINT", () => {});
  setInterval(() => {}, 1_000);
}
