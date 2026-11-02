import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createQaLifecycle } from "../../lib/qa-lifecycle.mjs";

const [record, phase, mode = "tree"] = process.argv.slice(2);
const owner = createQaLifecycle({ env: { ...process.env, QA_LIFECYCLE_TEST_SECRET: "synthetic-secret-do-not-print" }, graceMs: 150, forceMs: 2_000 });
process.on("message", (message) => {
  if (message === "cancel") { process.emit("SIGTERM"); process.emit("SIGINT"); }
  if (message === "cancel-int") { process.emit("SIGINT"); process.emit("SIGTERM"); }
});
try {
  await writeFile(join(owner.runtime, "credential.txt"), "synthetic-secret-do-not-print");
  const child = owner.spawn(phase === "spawn-failure" ? `${process.execPath}.missing` : process.execPath, [fileURLToPath(new URL("./qa-lifecycle-child.mjs", import.meta.url)), record, mode], { stdio: mode === "orphan" ? ["ignore", "pipe", "pipe"] : "ignore" });
  process.send({ runtime: owner.runtime, pid: child.pid, phase });
  if (phase === "startup-failure") throw new Error("synthetic_startup_failure");
  if (phase === "spawn-failure") {
    try {
      if (await owner.wait(child) === 0) throw new Error("missing_executable_succeeded");
    } catch (error) { if (!error.message.startsWith("qa_child_start_failed:")) throw error; }
  }
  if (["normal", "timeout"].includes(phase)) {
    while (true) {
      try { if ((await readFile(record, "utf8")).trim().split("\n").length >= 2) break; } catch {}
      await owner.sleep(30);
    }
  }
  if (phase === "spawn-failure") { /* Startup failure already handled above. */ }
  else if (phase === "command") await owner.wait(child);
  else if (phase === "timeout") await owner.wait(child, { timeoutMs: 400 });
  else if (phase === "normal") await owner.sleep(30);
  else await owner.sleep(30_000);
} catch (error) {
  if (!owner.signal.aborted && !["synthetic_startup_failure", "qa_command_timeout"].includes(error.message)) throw error;
} finally {
  const first = owner.cleanup();
  const second = owner.cleanup();
  await Promise.all([first, second]);
  process.disconnect?.();
}
