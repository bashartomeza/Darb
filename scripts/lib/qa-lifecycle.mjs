import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, realpathSync } from "node:fs";
import { lstat, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export function createQaLifecycle({ env = process.env, graceMs = 1_500, forceMs = 5_000, onChild = () => {} } = {}) {
  const controller = new AbortController();
  const children = new Map();
  const runtime = mkdtempSync(join(tmpdir(), "masari-functional-"));
  chmodSync(runtime, 0o700);
  const ownedRuntime = realpathSync(runtime);
  let cleaning;
  let stopping;
  const cancel = (signal) => {
    if (controller.signal.aborted) return;
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    controller.abort(new Error("local_qa_cancelled"));
    // The final cleanup awaits and reports shutdown failures. Keep this eager
    // cancellation attempt from becoming an unhandled rejection meanwhile.
    void stopAll().catch(() => {});
  };
  const onTerm = () => cancel("SIGTERM");
  const onInt = () => cancel("SIGINT");
  process.on("SIGTERM", onTerm);
  process.on("SIGINT", onInt);
  const check = () => controller.signal.throwIfAborted();
  function start(executable, args, options = {}) {
    check();
    assert(!cleaning && !stopping, "qa_lifecycle_stopping");
    const command = process.platform === "win32" ? join(process.env.SYSTEMROOT ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe") : executable;
    const argv = process.platform === "win32" ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", fileURLToPath(new URL("./qa-owned-process.ps1", import.meta.url)), "-Payload", Buffer.from(JSON.stringify({ executable, args, ownerPid: process.pid })).toString("base64")] : args;
    const child = spawn(command, argv, { ...options, env: options.env ?? env, windowsHide: true, detached: process.platform !== "win32" });
    const entry = { child, error: undefined, result: undefined, stopping: undefined };
    entry.exited = new Promise(resolve => {
      child.once("error", () => resolve({ code: null }));
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    entry.closed = new Promise(resolve => {
      child.once("error", error => { entry.error = error; });
      child.once("close", (code, signal) => { entry.result = { code, signal }; resolve(entry.result); });
    });
    children.set(child, entry);
    onChild(child);
    return child;
  }
  async function taskkill(child, force) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    const tool = spawn(join(process.env.SYSTEMROOT ?? "C:\\Windows", "System32/taskkill.exe"), ["/PID", String(child.pid), "/T", ...(force ? ["/F"] : [])], { env, windowsHide: true, stdio: "ignore" });
    await new Promise(resolve => {
      const timer = setTimeout(() => { tool.kill("SIGKILL"); resolve(); }, forceMs);
      tool.once("error", () => { clearTimeout(timer); resolve(); });
      tool.once("close", () => { clearTimeout(timer); resolve(); });
    });
  }
  function groupSignal(child, signal) {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; }
  }
  const bounded = async (promise, ms) => {
    let timer;
    try { return await Promise.race([promise.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), ms); })]); }
    finally { clearTimeout(timer); }
  };
  function stop(child) {
    const entry = children.get(child);
    assert(entry, "qa_child_not_owned");
    return entry.stopping ??= (async () => {
      if (process.platform === "win32") {
        // The wrapper holds the only job handle; closing it also kills orphans.
        await taskkill(child, false);
        if (!(await bounded(entry.closed, graceMs))) {
          await taskkill(child, true);
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        }
      } else {
        groupSignal(child, "SIGTERM");
        await bounded(entry.closed, graceMs);
        groupSignal(child, "SIGKILL");
      }
      assert(await bounded(entry.closed, forceMs), "qa_owned_child_stop_timeout");
    })();
  }
  function stopAll() { return stopping ??= Promise.all([...children.keys()].map(stop)); }
  async function wait(child, { timeoutMs = 300_000 } = {}) {
    const entry = children.get(child);
    assert(entry, "qa_child_not_owned");
    let timer;
    let abort;
    try {
      check();
      const result = await Promise.race([
        entry.exited,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("qa_command_timeout")), timeoutMs); }),
        new Promise((_, reject) => { abort = () => reject(controller.signal.reason); controller.signal.addEventListener("abort", abort, { once: true }); }),
      ]);
      if (entry.error) throw new Error(`qa_child_start_failed:${entry.error.code ?? "unknown"}`);
      return result.code;
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", abort);
      await stop(child);
    }
  }
  async function cleanup() {
    return cleaning ??= (async () => {
      try {
        await stopAll();
        // The exact mkdtemp directory is the only recursive deletion target.
        // Refuse directory substitution/junctions and verify its canonical path.
        assert.equal(resolve(runtime), resolve(ownedRuntime), "qa_runtime_path_changed");
        const stat = await lstat(runtime);
        assert(stat.isDirectory() && !stat.isSymbolicLink(), "qa_runtime_not_owned_directory");
        assert.equal(await realpath(runtime), ownedRuntime, "qa_runtime_path_changed");
        await rm(ownedRuntime, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
      } finally {
        process.removeListener("SIGTERM", onTerm);
        process.removeListener("SIGINT", onInt);
      }
    })();
  }
  return { runtime, signal: controller.signal, check, spawn: start, wait, stop, cleanup, sleep: ms => delay(ms, undefined, { signal: controller.signal }) };
}
