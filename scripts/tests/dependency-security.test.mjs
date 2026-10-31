import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const apiPackageJson = JSON.parse(readFileSync(resolve(root, "apps/api/package.json"), "utf8"));
const adminPackageJson = JSON.parse(readFileSync(resolve(root, "apps/admin/package.json"), "utf8"));
const lockfile = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));

test("security remediation keeps vulnerable dependency floors fixed", () => {
  assert.deepEqual(packageJson.overrides, {
    "@prisma/adapter-mariadb": {
      mariadb: "3.5.4"
    },
    "deepmerge-ts": "8.0.1",
    "body-parser": "2.4.0",
    "fast-uri": "3.1.9",
    mariadb: "3.5.4",
    mysql2: "3.23.1",
    prisma: {
      mysql2: "3.23.1"
    },
    qs: "6.16.1",
    vite: "8.1.6"
  });
  assert.equal(apiPackageJson.devDependencies.vitest, "4.1.12");
  assert.equal(adminPackageJson.devDependencies.vitest, "4.1.12");

  const expected = {
    "node_modules/deepmerge-ts": "8.0.1",
    "node_modules/body-parser": "2.4.0",
    "node_modules/mariadb": "3.5.4",
    "node_modules/mysql2": "3.23.1",
    "node_modules/qs": "6.16.1",
    "node_modules/vitest": "4.1.12"
  };
  // fast-uri is held at its fixed floor by the override. Prisma 7.10 dropped the tooling
  // that pulled it in, so it may be absent; if anything reintroduces it, it must be the fixed one.
  const fastUri = lockfile.packages["node_modules/fast-uri"]?.version;
  if (fastUri) assert.equal(fastUri, "3.1.9");
  for (const [path, version] of Object.entries(expected)) {
    assert.equal(lockfile.packages[path]?.version, version, `${path} must stay on ${version}`);
  }
});

// Vite bundles launch-editor; 8.1.6 is the patched 8.1 release for the
// October 2026 Windows command-injection advisory GHSA-587h-7wmj-h5pm.
test("Admin Vite manifest and bundled lock entry use the patched 8.1 release", () => {
  assert.equal(adminPackageJson.dependencies.vite, "8.1.6");
  assert.equal(lockfile.packages["apps/admin"].dependencies.vite, "8.1.6");
  assert.equal(lockfile.packages["node_modules/vite"].version, "8.1.6");
});

// Both October 2026 mocker advisories are fixed in the 4.1.12 backport.
test("Vitest mock registration and Windows traversal fixes remain installed", () => {
  assert.equal(lockfile.packages["node_modules/@vitest/mocker"].version, "4.1.12");
});
