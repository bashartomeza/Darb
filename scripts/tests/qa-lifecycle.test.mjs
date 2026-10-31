import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, lstat, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createQaLifecycle } from "../lib/qa-lifecycle.mjs";

const fixture = fileURLToPath(new URL("./fixtures/qa-lifecycle-owner.mjs", import.meta.url));
const childFixture = fileURLToPath(new URL("./fixtures/qa-lifecycle-child.mjs", import.meta.url));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(check, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await delay(30); }
  assert.fail("condition_timeout");
}
async function pids(record) { try { return (await readFile(record, "utf8")).trim().split("\n").map(Number); } catch { return []; } }
async function removeGenerated(directory) {
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert(/^(?:qa-lifecycle-(?:test-|orphan-test-|parent-test-)|masari-functional-)[a-zA-Z0-9]+$/.test(basename(directory)));
  assert(!(await lstat(directory)).isSymbolicLink());
  assert.equal(await realpath(directory), resolve(directory));
  await rm(resolve(directory), { recursive: true, force: true });
}

// Breaks caught: late/missing signal handlers, untracked commands/descendants,
// unbounded waits, repeated cleanup, deletion of a sibling resource, secret output.
for (const phase of ["mysql-startup", "api-startup", "admin-startup", "mobile-startup", "readiness", "interrupt", "command", "normal", "startup-failure", "spawn-failure", "timeout"]) {
  test(`owned tree and private runtime are cleaned during ${phase}`, { timeout: 40_000 }, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "qa-lifecycle-test-"));
    const controlFile = join(directory, "unrelated.txt");
    await writeFile(controlFile, "unrelated-control");
    const control = spawn(process.execPath, [childFixture, join(directory, "control.pid")], { windowsHide: true, stdio: "ignore" });
    const record = join(directory, "owned.pids");
    const owner = spawn(process.execPath, [fixture, record, phase], { windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let output = "";
    owner.stdout.on("data", value => { output += value; });
    owner.stderr.on("data", value => { output += value; });
    let status;
    const exited = new Promise(resolve => owner.once("exit", (code, signal) => { status = { code, signal }; resolve(); }));
    t.after(async () => {
      owner.kill("SIGKILL"); control.kill("SIGKILL");
      await removeGenerated(directory);
    });
    let ready;
    owner.on("message", message => { ready = message; });
    await until(() => ready || status);
    assert(ready, `ownership lifecycle did not start: ${output}`);
    if (!["startup-failure", "spawn-failure"].includes(phase)) {
      await until(async () => (await pids(record)).length === 2);
      if (!["normal", "timeout"].includes(phase)) {
        if (process.platform === "win32") owner.send(phase === "interrupt" ? "cancel-int" : "cancel");
        else owner.kill(phase === "interrupt" ? "SIGINT" : "SIGTERM");
      }
    }
    await Promise.race([exited, delay(8_000, undefined, { ref: false }).then(() => assert.fail(`cleanup_not_bounded: ${output}`))]);
    assert.equal(status.code, ["normal", "startup-failure", "spawn-failure", "timeout"].includes(phase) ? 0 : phase === "interrupt" ? 130 : 143, output);
    await until(async () => (await pids(record)).every(pid => !alive(pid)));
    await assert.rejects(access(ready.runtime), { code: "ENOENT" });
    assert(alive(control.pid), "unrelated control process was killed");
    assert.equal(await readFile(controlFile, "utf8"), "unrelated-control");
    assert(!output.includes("synthetic-secret-do-not-print"));
  });
}

test("a successful transient root cannot leave its descendant behind", { timeout: 40_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "qa-lifecycle-orphan-test-"));
  const record = join(directory, "owned.pids");
  const owner = spawn(process.execPath, [fixture, record, "command", "orphan"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let output = "";
  owner.stderr.on("data", value => { output += value; });
  t.after(async () => { owner.kill("SIGKILL"); await removeGenerated(directory); });
  const status = await new Promise(resolve => owner.once("exit", resolve));
  assert.equal(status, 0, output);
  assert.equal((await pids(record)).length, 2);
  await until(async () => (await pids(record)).every(pid => !alive(pid)));
});

test("runtime substitution cannot recursively delete a sibling resource", async t => {
  const directory = await mkdtemp(join(tmpdir(), "qa-lifecycle-test-"));
  const controlFile = join(directory, "unrelated.txt");
  await writeFile(controlFile, "unrelated-control");
  const owner = createQaLifecycle();
  await removeGenerated(owner.runtime);
  await symlink(directory, owner.runtime, process.platform === "win32" ? "junction" : "dir");
  t.after(async () => { await unlink(owner.runtime); await removeGenerated(directory); });
  await assert.rejects(owner.cleanup(), /qa_runtime_not_owned_directory|qa_runtime_path_changed/);
  assert.equal(await readFile(controlFile, "utf8"), "unrelated-control");
});

test("Windows job children stop if their harness is forcibly terminated", { skip: process.platform !== "win32", timeout: 40_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "qa-lifecycle-parent-test-"));
  const record = join(directory, "owned.pids");
  const owner = spawn(process.execPath, [fixture, record, "readiness"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let runtime;
  owner.on("message", message => { runtime = message.runtime; });
  const exited = new Promise(resolve => owner.once("exit", resolve));
  t.after(async () => {
    owner.kill("SIGKILL");
    if (runtime) await removeGenerated(runtime);
    await removeGenerated(directory);
  });
  await until(async () => (await pids(record)).length === 2);
  owner.kill("SIGKILL");
  await exited;
  await until(async () => (await pids(record)).every(pid => !alive(pid)));
  // A hard OS kill cannot run JavaScript's finally to remove private files.
  await access(join(runtime, "credential.txt"));
});
