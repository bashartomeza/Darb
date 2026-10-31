# Checkpoint research directory (disabled)

This names/cities directory is separate from the coordinate-requiring live
`GET /api/v1/checkpoints` adapter. It does not call a provider. It is not a
traffic feed, route destination catalog or claim of authenticated-feed completeness.

The user approved public implementation, a version/hash/count manifest and
synthetic fixtures only. The supplied173-row JSON stays in ignored local storage;
it is not committed, embedded in Flutter, shipped in build artifacts or printed
in CI. Its SHA-256 and city totals are pinned in
`apps/api/data/checkpoint-directory.v1.manifest.json`.

## Local verification

After `npm run build --workspace @masari/api`, run
`node scripts/verify-checkpoint-directory.mjs <ignored-local-file.json>`.
This validates all173 records,11 city totals, unique research keys, the separate
cross-city duplicate, absent IDs/coordinates, unknown traffic and blocked publication.
It emits aggregate results only. Hosted CI uses synthetic names/records and
does not claim to have imported or verified the unavailable private input.

## Backend boundary

- `CHECKPOINT_DIRECTORY_ENABLED` defaults false; `CHECKPOINT_DIRECTORY_FILE`
  names an owner-managed local JSON file and is required only if enabled.
- Disabled `GET /api/v1/checkpoint-directory` returns404. Enabled requests
  require the existing valid session, complete-profile checks and Passenger or
  Driver role. Mutation endpoints are absent.
- `GET /api/v1/capabilities?include=checkpoint-directory` explicitly opts into
  `checkpoint_directory_available`. The ordinary capability response is unchanged
  because older Flutter clients reject unknown fields.
- The directory is available only when the pinned manifest, file-level metadata
  AND every record have independently approved publication state. The supplied
  manifest/records remain blocked. Toggling the capability alone cannot expose them.
- Reads validate the byte hash, versioned schema, unique research identities,
  counts, city associations and local1,000,000-byte resource bound. Errors are
  sanitized503 responses without paths, source records or parser details.
- Responses are `Cache-Control: no-store`. They contain research identities,
  exact names/cities, provenance and explicitly unavailable traffic. Coordinates
  and provider IDs remain null, map readiness false. Research keys are never
  presented as AweenRayeh API IDs.

The file is immutable for the lifetime of the backend service. An owner-approved
future catalog revision requires a new manifest/hash and backend restart. The
reserved source fields allow later verified coordinate/ID enrichment on the
backend; this names-only version deliberately rejects coordinate/status injection
and does not enable map pins. No database migration or mobile asset update is needed
to replace server catalog data. Enrichment is a later reviewed schema version.

## Mobile boundary

The directory action is hidden without its separate capability. It uses the
existing authenticated actor binding/revision to fence capability and catalog
reads, including pre-send and post-response checks. Account/session changes
select a distinct provider instance; old results and captured search state
cannot be reused by the next session. The screen uses existing Masari surfaces,
Arabic names grouped by city, Arabic substring search, and neutral unavailable
traffic text. It has no map or navigation destination conversion.

## External gates

The user-supplied documentation summary describes
`GET /v1/partner/checkpoints` with `X-Api-Key`, stable IDs, city/name and directional
update timestamps; it does not establish coordinates, traffic states or a complete
approved contract. No provider request or credential inspection occurs here.

Provider reuse/public redistribution approval, authorized-access evidence,
authoritative contract verification, historical credential revocation confirmation
and CP-F03 freshness/safety policies remain external decisions. No timestamp is
interpreted as open/closed/congested. No external integration is enabled.

CHECKPOINT_PROVIDER = UNVERIFIED_BLOCKED
CREDENTIAL_ROTATION = PENDING_OWNER_CONFIRMATION
CHECKPOINT_STALE_POLICY = APPROVED_FOR_DEMO_ONLY (docs/checkpoints/freshness-policy.md; production needs a named safety approver)
CHECKPOINT_DIRECTORY_PUBLICATION = BLOCKED_PENDING_PROVIDER_PERMISSION
MERGE_GATE = BLOCKED_PENDING_USER_APPROVAL
PRODUCTION_DEPLOYMENT = NOT_AUTHORIZED
