import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(new URL("../../", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const migrationRoot = resolve(root, "apps/api/prisma/migrations");
const expected = {
  "20260713114812_mysql_baseline": "77249c976947c6ff53975f78d60cb268c7dc22fe157cfde4c1f90fc93ee4042d",
  "20260713114851_preserve_text_capacity": "7da499b45db3782c861e74ad146c2d359bbc25b6af06a97f413c6d0fc4af6eaa",
  "20260717094000_trusted_sessions": "0ff9b924bd942647727eb8db9825d44bbf0d72542b952884bf6ae39238ee22ce",
  "20260717195454_onboarding_foundation": "fa992faa0767fecb247c09948f2ef01dfc4acdb5f557ac6c616a70b160a418cd",
  "20260719120000_harden_onboarding_foundation": "908fcdd4404cfba8b3f4d3617d746e8bd605a91ae8e7e179913f25560bb9a7fa",
  "20260719123000_enforce_single_invitation_attempt": "87ca5c72bb496c1a7a68e96f01ff8047e33f2489a129c7db97377a8cc872086e",
  "20260719203000_public_onboarding_scopes": "33200cf1528fa8b68135373f0a6a195cae06955a16d3f0b7faf739104b9818d8",
  "20260721110000_canonical_route_catalog": "bba0b3807998394b35a20d68b0f5cbf637eb10f4bbf4a5e34cce253e8749adbc",
  "20260721170000_enforce_route_catalog_integrity": "9b6896aa311bc597db1cb17a39328017243497f6c90e5aa106062bf8c5c7edc2",
  "20260722130000_multi_route_operational_foundation": "f306c5a5122d9376dc8399703e1bbf834117f1ccda38937352bebcafdc8ae30c",
  "20260722143000_isolate_canonical_availability": "530aaac38e8f7e9533855bf7005832ee8b126bc3072706c9d77b34551e0b350c",
  "20260722180000_harden_multi_route_operations": "0a2f166377916bf44f2e45f7d70c7775dfc360b573367fa764f6ec5e15938684",
  "20260722200000_enforce_operational_mode_and_expiry_quarantine": "3d671ad02a5d6e58bc90e9a6779ce042d0653725339d05162d15de294d17930f",
  "20260726130000_canonical_matching_dispatch": "813ba595443e147dceaf391924a5ec4b0d30c2c1d88ca7d1fdc3898f94c699dc",
  "20260726170000_enforce_match_trip_availability_mode": "189a0ff189c52fcc84f343f0e535d1f84696c9e6f62271597cc52f0915e7a59a",
  "20260727110000_harden_canonical_assignment_integrity": "1ee6e63b4ba698fd122fe2680e88d7612c2fb27940e74501002ca449f69d3bbf",
  "20260728130000_canonical_shared_trip_aggregation": "5ea77b6a40bfcbd2be1ba1076eb30951b85f5e6dd34f6037b3265a835f847c90",
  "20260729120000_harden_canonical_shared_trip_integrity": "b27a28b17c6c090fad8520b97bde8c02463fb02f0195f2cb6736117f64af167c",
  "20260819150000_driver_verification_approval": "2f381773237f840cf896ee144d28ae0e77a8525b841a7f89bf45eb1bef874010",
  "20260820120000_global_e164_phone_constraints": "7822831a007d451c689fd8a2260567cf8c4728cacea847ae47b43e887ba67539",
  "20260821120000_consent_management_workflow": "675d82606bba96680dcb31d6bcf3bea85d01b50e445cd136f3670f528d483362",
  "20260910120000_email_google_self_service_auth": "dc8cf559995ff227aad3f604581e6f7253f09bb89f280d9c5da4c13d39241e94",
  "20260915130000_external_identity_profile_state": "f6b3712bb229fa5cc5e2e9fb39a9c9ac0de64f23506abdb00bf250faa9ae14a5",
  "20260915130100_backfill_legacy_google_external_identities": "45e06a478346579c680cbc787599e29d4e3c79b5e8c62d9596f42455820e6193",
  "20261006110000_complete_passenger_trip_lifecycle": "d7633c03f7d1cd3443413d00cb99b6212d2ba30027d1aba21c07e5a12a587537",
  "20261008190000_complete_capacity_batching_failure_states": "e76db39a4220df2abe2ba160ac32de05f95e0394513c27b23da733e345bb0efb",
  "20261012165000_allow_legacy_offer_lifecycle_timestamps": "0a349a0bf2367407e41f89642ae8c407e266fbc17d67d0cf83159e97acedb0be",
  "20261025120000_in_app_notifications": "d33876d062ee63dbc2c80062a4138d28d29a2c769a518b9726897d5f34fb0930",
  "20261025140000_incident_reports": "4f20abbd230778c86f1341a64cefcb83386660ca57da7065f431995b2ac423bb",
  "20261025160000_driver_verification_history": "01f0b3fef2ec9448cc7c230c33237ea905af651b2425412fe83ab09f21c4dcaf",
  "20261026120000_driver_verification_evidence": "1964710ac841601a357bb648240b4c3e05adc35aa500859c9714095976cd0911",
  "20261026140000_driver_verification_documents": "acba7207379fd242e0f4bdaa2ca94676b5ddcbb3a0fe8cd7a6e1c464af5594ed",
  "20261028120000_merchant_application_documents": "ae2aeea85b68474682f8b507ebff7b70e262ca299f7e5d8dfdbee5a75c85b1b7",
  "20261028150000_auth_action_short_codes": "87fc9171f040d9bcbe723114fbe1777340b844c1d65e6aac5c5c3a4cc4b9fadc",
  "20261029110000_driver_trust_score": "59202108da171623bca70a351b2246ee596074b560416fc733370f0ddca8e1df",
  "20261029120000_delivery_handover_confirmation": "04df0fffc973ed9b36d936374cb565b6673d3e91d1d2dfb76f9827849efaed73",
  "20261029120000_open_driver_merchant_signup": "c076dceb4db5d971435af47f00b7985ee1154fb0bb61f1d47d063280dd3f89cc",
  "20261029130000_passenger_parcels": "ead7a6cd023bbe8d416f6abc860b3fb45054937b6235a68ef712a9b1f6bf0244",
  "20261029140000_route_fares": "cb1bcb00e2340c8d208208bd6679f28e328543945d03091506ecdd73f9fd7423",
  "20261029150000_ai_uncertain_requests": "682f3b9137276b665025361346cf61608b3b0b2aac6ff37e9f2457420ff300b0",
  "20261029190000_driver_document_expiry": "6124b6e52b705c0995543241aa716b307d2c8e79252132be60e496c7a4e81edc",
  "20261029200000_email_otp_contact": "3a433d1c5c6f7edfb199c1b1ef6fb750c5811e71574e1dcb7858f159bba3e8bb"
};

function normalizedChecksum(path) {
  const normalized = readFileSync(path, "utf8").replaceAll("\r\n", "\n");
  return createHash("sha256").update(Buffer.from(normalized, "utf8")).digest("hex");
}

test("approved Prisma migration history remains byte-stable apart from line endings", () => {
  const names = readdirSync(migrationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(names, Object.keys(expected).sort());
  for (const [name, checksum] of Object.entries(expected)) {
    assert.equal(
      normalizedChecksum(resolve(migrationRoot, name, "migration.sql")),
      checksum,
      `${name} does not match its approved canonical checksum`
    );
  }
});
