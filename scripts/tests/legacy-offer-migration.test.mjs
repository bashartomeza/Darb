import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../apps/api/prisma/migrations/${path}/migration.sql`, import.meta.url), "utf8").replaceAll("\r\n", "\n");

test("legacy lifecycle migration preserves both canonical offer shape constraints", () => {
  const previous = read("20260728130000_canonical_shared_trip_aggregation");
  const next = read("20261012165000_allow_legacy_offer_lifecycle_timestamps");
  const constraint = "ADD CONSTRAINT `matches_canonical_shape_chk` CHECK (";
  const canonical = (source) => {
    const start = source.indexOf(constraint);
    const branch = source.indexOf("\n    OR", start);
    const end = source.indexOf("\n  );", branch);
    return source.slice(branch, end);
  };
  assert.equal(canonical(next), canonical(previous));
  const legacy = next.slice(next.indexOf(constraint), next.indexOf("\n    OR"));
  for (const field of ["expires_at", "accepted_at", "rejected_at", "expired_at"]) {
    assert.equal(legacy.includes(`\`${field}\` IS NULL`), false);
  }
  for (const field of ["route_version_id", "dispatch_id", "reservation_id", "manifest_id", "canonical_assignment_key"]) {
    assert.ok(legacy.includes(`\`${field}\` IS NULL`));
  }
});
