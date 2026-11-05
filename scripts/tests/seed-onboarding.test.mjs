import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import http from "node:http";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(new URL("../../", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const script = resolve(root, "scripts/test-env/seed-onboarding.mjs");

/** A stand-in API that records every request and reports the given database safety. */
function fakeApi({ demoResetAvailable }) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    req.resume();
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/v1/auth/login") return res.end(JSON.stringify({ token: "admin-token" }));
      if (req.url === "/api/v1/capabilities") {
        return res.end(JSON.stringify(demoResetAvailable === undefined ? {} : { demo_reset_available: demoResetAvailable }));
      }
      if (req.url === "/api/v1/admin/consent-releases/current") return res.end(JSON.stringify({ ready: true }));
      res.statusCode = 500;
      res.end("{}");
    });
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done({ server, requests, port: server.address().port })));
}

function run(env) {
  const child = spawn(process.execPath, [script], {
    cwd: root,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DEMO_ADMIN_PASSWORD: "test-only", ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  return new Promise((done) => child.once("exit", (code) => done({ code, output })));
}

const disposable = { DATABASE_URL: "mysql://127.0.0.1:3306/darb_demo", DEMO_RESET_ALLOWED_DATABASES: "darb_demo" };

test("seed-onboarding refuses an API that does not report a disposable database, before writing", async () => {
  for (const demoResetAvailable of [false, undefined]) {
    const { server, requests, port } = await fakeApi({ demoResetAvailable });
    try {
      const result = await run({ ...disposable, TEST_API_BASE_URL: `http://127.0.0.1:${port}` });
      assert.notEqual(result.code, 0);
      assert.match(result.output, /does not report a disposable database/);
      assert.deepEqual(requests, ["POST /api/v1/auth/login", "GET /api/v1/capabilities"]);
    } finally {
      server.close();
    }
  }
});

test("seed-onboarding proceeds against an API on a disposable database", async () => {
  const { server, requests, port } = await fakeApi({ demoResetAvailable: true });
  try {
    const result = await run({ ...disposable, TEST_API_BASE_URL: `http://127.0.0.1:${port}` });
    assert.equal(result.code, 0, result.output);
    assert.ok(requests.includes("GET /api/v1/admin/consent-releases/current"));
  } finally {
    server.close();
  }
});

test("test-env PowerShell scripts hold no literal tab (a mistyped \\t inside a path)", () => {
  const directory = resolve(root, "scripts/test-env");
  for (const name of readdirSync(directory).filter((entry) => /\.psm?1$/.test(entry))) {
    assert.ok(!readFileSync(resolve(directory, name), "utf8").includes("\t"), `${name} contains a tab character`);
  }
});

test("seed-onboarding refuses a local DATABASE_URL on the permanent database without calling the API", async () => {
  const { server, requests, port } = await fakeApi({ demoResetAvailable: true });
  try {
    const result = await run({
      DATABASE_URL: "mysql://127.0.0.1:3306/darb",
      DEMO_RESET_ALLOWED_DATABASES: "darb",
      TEST_API_BASE_URL: `http://127.0.0.1:${port}`
    });
    assert.notEqual(result.code, 0);
    assert.deepEqual(requests, []);
  } finally {
    server.close();
  }
});
