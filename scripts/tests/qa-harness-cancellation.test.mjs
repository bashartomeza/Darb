import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const fixture = fileURLToPath(new URL("./fixtures/qa-harness-signal.mjs", import.meta.url));
const childFixture = fileURLToPath(new URL("./fixtures/qa-lifecycle-child.mjs", import.meta.url));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const hasMysql = Boolean(process.env.FUNCTIONAL_QA_MYSQLD);
const matrix = process.env.FUNCTIONAL_QA_CANCELLATION_MATRIX === "true";
const availablePhases = ["mysql_initialize", "mysql_server", "api", "admin", "mobile", "readiness"];
const phases = process.env.FUNCTIONAL_QA_CANCELLATION_PHASES?.split(",") ?? (matrix ? availablePhases : ["mysql_initialize"]);
assert(phases.every(phase => availablePhases.includes(phase)), "unknown cancellation test phase");

for (const phase of phases) {
  test(`real tool cancellation during ${phase} removes only owned processes and private resources`, { skip: !hasMysql || (["admin", "mobile", "readiness"].includes(phase) && !process.env.FUNCTIONAL_QA_FLUTTER_ROOT), timeout: 240_000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), "qa-real-cancel-test-"));
    const controlFile = join(directory, "unrelated.txt");
    await writeFile(controlFile, "unrelated-control");
    const control = spawn(process.execPath, [childFixture, join(directory, "control.pid")], { windowsHide: true, stdio: "ignore" });
    const ownedPids = [];
    let runtime;
    const child = spawn(process.execPath, [fixture, phase], { env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let output = "";
    const exited = new Promise(resolve => child.once("exit", code => resolve(code)));
    child.stdout.on("data", chunk => {
      output += chunk;
      if (!runtime) {
        runtime = /(?:Private runtime|Evidence directory): (.+)/.exec(output)?.[1]?.trim();
        if (runtime) console.log(`owned ${phase} runtime: ${runtime}`);
      }
    });
    child.stderr.on("data", chunk => { output += chunk; });
    let sent = false;
    let selection;
    let selectedNative;
    let readyAtCancellation = false;
    let cancellationAt;
    let adapterError;
    child.on("message", message => {
      ownedPids.push(message.ownedPid);
      const selected = phase === "readiness" ? message.readinessPolling : message.nativePid && message.phase === phase;
      if (!selection && selected) selection = (async () => {
        selectedNative = message.nativePid;
        ownedPids.push(selectedNative);
        readyAtCancellation = output.includes('"localQaReady":true');
        sent = true;
        cancellationAt = message.cancellationAt ?? Date.now();
        if (phase !== "readiness" && child.connected) child.send("SIGTERM");
      })().catch(error => { adapterError = error; child.kill("SIGKILL"); });
    });
    t.after(async () => {
      // ChildProcess guards against signaling a PID after the owned root exits.
      // Windows job supervisors observe harness death and stop descendants.
      child.kill("SIGKILL");
      control.kill("SIGKILL");
      // Verify the resolved exact generated target before recursive deletion.
      if (runtime && dirname(resolve(runtime)) === resolve(tmpdir()) && /^masari-functional-[a-zA-Z0-9]+$/.test(basename(runtime))) {
        const stat = await lstat(runtime).catch(error => { if (error.code !== "ENOENT") throw error; });
        if (stat) {
          assert(stat.isDirectory() && !stat.isSymbolicLink());
          assert.equal(await realpath(runtime), resolve(runtime));
          await rm(resolve(runtime), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
        }
      }
      assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
      await rm(resolve(directory), { recursive: true, force: true });
    });
    const status = await Promise.race([exited, delay(230_000, undefined, { ref: false }).then(() => assert.fail("harness_cancellation_timeout"))]);
    if (adapterError) throw adapterError;
    assert(sent && runtime && selectedNative, `harness did not reach requested tool startup: ${output}`);
    assert.equal(status, 143, output);
    const shutdownMs = Date.now() - cancellationAt;
    assert(shutdownMs <= 8_000, "signal shutdown exceeded its separate 8000ms budget");
    if (phase === "readiness") assert(!readyAtCancellation, "cancellation arrived after readiness completed");
    await assert.rejects(access(runtime), { code: "ENOENT" }, "cancelled harness left its private runtime and owned MySQL data behind");
    const deadline = Date.now() + 8_000;
    while (ownedPids.some(alive) && Date.now() < deadline) await delay(50);
    assert(!ownedPids.some(alive), "an owned process survived cancellation");
    assert(alive(control.pid), "unrelated control process was killed");
    assert.equal(await readFile(controlFile, "utf8"), "unrelated-control");
    assert(!/mysql:\/\/(?!\[REDACTED\])/.test(output), "unredacted database URL in harness output");
    console.log(`verified native ${phase}; shutdown_ms=${shutdownMs}; owned children stopped; unrelated control survived; private runtime removed`);
  });
}
