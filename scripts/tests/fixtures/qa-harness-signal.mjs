// Windows does not deliver Node SIGTERM handlers via process.kill. This adapter
// models POSIX signal dispatch without changing the imported production harness.
import * as childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";
let phase = "setup";
let mobilePort;
let mobileChild;
let readinessCancelled = false;
const originalLog = console.log;
console.log = (...values) => {
  if (typeof values[0] === "string" && values[0].startsWith("START ")) phase = values[0].slice(6);
  originalLog(...values);
};
const originalSpawn = childProcess.default.spawn;
childProcess.default.spawn = (...args) => {
  let executable = String(args[0]);
  let commandArgs = args[1];
  const payloadIndex = args[1]?.indexOf("-Payload");
  if (payloadIndex >= 0) {
    const specification = JSON.parse(Buffer.from(args[1][payloadIndex + 1], "base64").toString("utf8"));
    executable = specification.executable;
    commandArgs = specification.args;
  }
  if (phase === "mobile") mobilePort = commandArgs[commandArgs.indexOf("--web-port") + 1];
  if (payloadIndex >= 0) {
    const stdio = args[2]?.stdio;
    args[2] = { ...args[2], stdio: stdio === "ignore" ? ["ignore", "pipe", "pipe"] : stdio };
  }
  const child = originalSpawn(...args);
  const startPhase = phase;
  const send = nativePid => {
    const message = { ownedPid: child.pid, nativePid, phase: startPhase, job: payloadIndex >= 0, nativeName: basename(executable) };
    if (startPhase === "mobile") mobileChild = message;
    if (child.pid && process.connected) process.send(message);
  };
  send(payloadIndex >= 0 ? undefined : child.pid);
  let diagnostic = "";
  child.stderr?.on("data", chunk => {
    diagnostic += chunk;
    const native = /OWNED native_child_pid=(\d+)/.exec(diagnostic);
    if (native) { send(Number(native[1])); diagnostic = ""; }
  });
  return child;
};
syncBuiltinESMExports();
function dispatchSignal(signal) {
  const shutdownDeadline = setTimeout(() => {
    console.error("qa_signal_cleanup_exceeded_8000ms");
    process.exitCode = 1;
  }, 8_000);
  shutdownDeadline.unref();
  if (process.listenerCount(signal)) process.emit(signal);
  else process.exit(signal === "SIGINT" ? 130 : 143);
}
process.on("message", dispatchSignal);
const originalFetch = globalThis.fetch;
globalThis.fetch = (...args) => {
  const request = originalFetch(...args);
  const url = new URL(args[0]);
  if (process.argv[2] === "readiness" && !readinessCancelled && mobileChild?.nativePid && url.hostname === "127.0.0.1" && url.port === String(mobilePort)) {
    // The real loopback fetch has started. Dispatch synchronously before its
    // promise can settle, so cached startup cannot move this past readiness.
    readinessCancelled = true;
    if (process.connected) process.send({ ...mobileChild, phase: "readiness", readinessPolling: true, cancellationAt: Date.now() });
    dispatchSignal("SIGTERM");
  }
  return request;
};
process.argv.push("--confirm-disposable", "--monitoring-only");
if (["admin", "mobile", "readiness"].includes(process.argv[2])) process.argv.push("--keep-running");
try { await import("../../local-functional-recovery-qa.mjs"); }
finally { process.disconnect?.(); }
