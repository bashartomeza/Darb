# Checkpoints on the map: sources and how to provide them

Every Darb map (passenger, driver, merchant) draws checkpoints from one
endpoint, `GET /api/v1/checkpoints`, through the shared layer in
`apps/mobile/lib/core/maps/map_overlays.dart`. The app asks for checkpoints only
when `GET /api/v1/capabilities` reports `checkpoints_available: true`; otherwise
each map shows a small **"Checkpoint data unavailable"** note instead of an
empty-looking map. No checkpoint, name or coordinate is ever invented by the app
or the server.

Marker colours (`SemanticColors`, `checkpoint_map_markers.dart`): open green
`#3A7C07`, congested orange `#FA5F12`, closed red `#EB3223`, unknown grey
`#64748B`.

## Source 1: AweenRayeh partner API + OpenStreetMap positions (recommended)

The partner feed (`GET https://db.aweenrayeh.com/v1/partner/checkpoints`,
`X-Api-Key`) gives `id`, `city`, `checkpoint` (Arabic name) and the
entering/leaving "last changed" times. It has **no coordinates and no
open/closed state** (test keys: up to 7 checkpoints per city, 30 requests per
minute, 15 s edge cache).

With `PARTNER_CHECKPOINT_MAP_ENABLED=true` (requires
`AWEENRAYEH_LIMITED_DIRECTORY_ENABLED=true` and `AWEENRAYEH_PARTNER_API_KEY`)
the API serves `GET /checkpoints` from that feed
(`apps/api/src/services/partnerCheckpointMap.ts`):

- Each partner row is matched to the committed OpenStreetMap extract
  `apps/api/data/osm-checkpoints.json` by **normalised Arabic name** (diacritics,
  tatweel, alef/hamza/ya/ta-marbuta variants and generic words such as "حاجز",
  "معبر", "نقطة تفتيش" are ignored; "a - b" names try each part). Tiers, in
  order: exact name, the name without the article "ال" ("جبع" = "الجبع"), then a
  spelling variant that differs only in long vowels ("الكونتينر" = "الكونتينار",
  "شومرون" = "شمرون"; at least four consonants). Each pin records which tier
  matched in `position_match`. A match must lie
  within 40 km of the row's city (both cities for rows like "أريحا - طوباس"), and
  same-named places more than 1 km apart are treated as ambiguous.
- Only a row with exactly one such place gets a pin. Every other row is returned
  in `unplaced` with a reason and listed in the app under **"Checkpoints without
  a map position"** with its status and last-changed times.
- Status comes from the partner's `entering_status` / `leaving_status`
  ("سالك" open, "مغلق" closed, "أزمة متوسطة" / "أزمة خانقة" congested). Both
  directions are passed through as written; the pin takes the worst direction
  (closed, then congested) and is green only when both are "سالك". A missing or
  unfamiliar value stays `unknown` (grey); a "last changed" time is never read
  as a state. Timestamps are shown as published, without timezone conversion.
- Roles: passengers and drivers (the same rule as the limited directory the rows
  come from). Merchants see the "unavailable" note.
- Positions are © OpenStreetMap contributors, ODbL 1.0
  (<https://www.openstreetmap.org/copyright>). The map's attribution reads
  "© OpenStreetMap contributors" and each pin placed this way says so in its
  details.

### Providing the key locally

1. `pwsh -NoProfile -File scripts/provider-key/set-partner-key.ps1` stores the key
   in Windows Credential Manager (`Darb/AweenRayehPartnerKey`). It is never
   written to a file or printed.
2. `pwsh -NoProfile -File scripts/test-env/start.ps1` sees the stored key and
   passes it only to the API process, together with
   `AWEENRAYEH_LIMITED_DIRECTORY_ENABLED=true` and
   `PARTNER_CHECKPOINT_MAP_ENABLED=true`. It prints which checkpoint sources are
   active, never the key.

Demo reset no longer deletes the partner key budget (the
`checkpoint_partner_budget` abuse-counter rows), so the provider's rate limit is
kept across resets and the gate can run in the demo stack.

### Refreshing the OpenStreetMap positions

```
node scripts/checkpoints/fetch-osm-checkpoints.mjs
```

queries Overpass (`overpass-api.de`, then `overpass.kumi.systems`, then
`overpass.private.coffee`, with backoff) for `barrier=checkpoint` and
`military=checkpoint` inside the West Bank box (31.2, 34.85, 32.6, 35.6) and
rewrites `apps/api/data/osm-checkpoints.json` with only id, name, Arabic name and
position plus source, date and licence fields. Review the diff and commit it;
restart the API to load it. To improve matches, fix names in OpenStreetMap itself
(e.g. add `name:ar`), then refresh.

## Source 2: coordinate feed (`CHECKPOINTS_URL`)

The original adapter (`docs/api/checkpoints.md`) for a feed that already has
coordinates and states. Set in `apps/api/.env`:

```
CHECKPOINTS_URL=https://...        # HTTPS only
CHECKPOINTS_API_KEY=...            # at least 20 characters, never a placeholder
```

`start.ps1` turns on `CHECKPOINTS_ENABLED` (and `MAPS_ENABLED`) only when both are
present. When enabled it takes precedence over the partner source.

## Source 3: research directory file (names only, no pins)

`CHECKPOINT_DIRECTORY_ENABLED` / `CHECKPOINT_DIRECTORY_FILE`
(`docs/api/checkpoint-directory.md`) is a names/cities list without coordinates;
it never produces map pins. `start.ps1` enables it when the owner-managed file
exists at `.staging-data/test-env/checkpoint-directory.json` (git-ignored). The
original file is not in the repository and must not be recreated from guesses.

## Community reports next to checkpoints

A recent (6 h), not-disputed community report within 300 m of a checkpoint is
shown as **"Community says: open / closed / congested (unverified)"** in the
checkpoint's details and as a coloured ring and badge around its pin
(`communityCheckpointNotes`). It never changes the official status; votes only
change the report's own "disputed" / "well supported" standing.

## Current coverage (measured 2026-11-01)

One read of the test-mode partner feed (70 rows, 10 cities) against the committed
extract (69 OpenStreetMap checkpoints, of which only about a dozen carry an Arabic
name) places **5 rows**: تياسير, جبع, الكونتينر, دير شرف, شافي شومرون. The other 65
are listed as unplaced (`no_name_match`): OpenStreetMap has no Arabic-named
checkpoint for them. Coverage grows by adding `name:ar` to the checkpoints in
OpenStreetMap and re-running the fetch script, or by an owner-approved
coordinate source; positions are never guessed.
