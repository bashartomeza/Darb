import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

// The product was renamed from its old name to Darb (درب) on 2026-11-01.
// This guard fails if the old name comes back in any tracked file.
// The old words are built by concatenation so this file does not match itself.
const root = resolve(new URL("../../", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));

const oldLatin = "mas" + "ari";
const oldArabicForms = ["مس" + "اري", "مص" + "اري"];

// Places that must keep the old name on purpose.
const allowedPathPrefixes = [
  // Applied migrations are checksum-pinned history and must never be edited.
  "apps/api/prisma/migrations/",
  // Deletes on-device keys that still use the old prefix on older installs.
  "apps/mobile/lib/core/storage/retired_local_data.dart",
  "apps/mobile/test/retired_local_data_test.dart"
];
// The historic migration name may be referenced from anywhere (checksum and recovery lists).
const allowedTokens = ["20261102120000_rename_" + oldLatin + "_to_darb"];

function trackedFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split("\0").filter(Boolean);
}

function isAllowedPath(file) {
  return allowedPathPrefixes.some((prefix) => file === prefix || file.startsWith(prefix));
}

function stripAllowedTokens(text) {
  let out = text;
  for (const token of allowedTokens) out = out.split(token).join("");
  return out;
}

test("no tracked file name contains the old brand name", () => {
  const offenders = trackedFiles()
    .filter((file) => !isAllowedPath(file))
    .filter((file) => {
      const name = stripAllowedTokens(file).toLowerCase();
      return name.includes(oldLatin) || oldArabicForms.some((word) => name.includes(word));
    });
  assert.deepEqual(offenders, []);
});

test("no tracked text file contains the old brand name", () => {
  const offenders = [];
  for (const file of trackedFiles()) {
    if (isAllowedPath(file)) continue;
    let buffer;
    try {
      buffer = readFileSync(join(root, file));
    } catch {
      continue; // deleted in the working tree
    }
    if (buffer.includes(0)) continue; // binary (images, fonts)
    const text = stripAllowedTokens(buffer.toString("utf8"));
    if (text.toLowerCase().includes(oldLatin) || oldArabicForms.some((word) => text.includes(word))) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [], `Replace the old brand name with Darb / درب in: ${offenders.join(", ")}`);
});
