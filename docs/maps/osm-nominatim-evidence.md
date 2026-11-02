# M7D1B independent self-hosted Nominatim evidence

Evidence date: 2026-08-07. Classification: `TEST FIXTURE DATA — NOT USER LOCATION DATA`. Routing and geocoding are separate decisions. The public OSM Nominatim endpoint was not used.

## Reproducible import

Nominatim `5.3.2-0` ran from `mediagis/nominatim@sha256:7923a8e67197fc6d4f4ecb7c0e8bbedffeddcfdf4519596fe946e46a28f5a9f8` against the same checksum-verified PBF. PostgreSQL 16.14, PostGIS 3.4 and osm2pgsql 1.11.0 used eight import threads, full style, no Wikipedia/TIGER/postcode extras, no replication and `FREEZE=true`. HTTP was bound only to `127.0.0.1:18080`; PostgreSQL was not published.

The independent import ran from the first OSM import message at `19:30:26` to HTTP readiness at `19:35:58`, about 332 seconds. `nominatim admin --check-database` passed connection, version, content, tokenizer, indexing and index validity. `pg_database_size` was about 1.19 GB; the PostgreSQL data directory occupied about 3.2 GB because `pg_wal` retained about 2.1 GB. Peak observed import memory remained approximately 3 GiB. These are developer-machine observations, not capacity sizing.

Use [the service script](../../scripts/maps/m7d1b-services.ps1) with `-Action nominatim-import`, then [the evidence harness](../../scripts/maps/m7d1b-live-evidence.mjs) with `--mode=geocode`. The import wrapper redirects Bash xtrace to a non-retained descriptor; the rerun found zero `useradd`, `ALTER USER`, or `NOMINATIM_PASSWORD` trace patterns. Cleanup requires the explicit `-Action cleanup -ConfirmCleanup` guard.

## Corrected initial eight-query analysis

The original PPU expectation was wrong. Correcting PPU to the official Dahiat Al-Baladiyah campus changes the strict top-result outcome from 4/8 to 5/8.

| Fixture / language | Top result | Expected area | Strict result | Reason |
|---|---|---|---|---|
| Hebron / Arabic | Hebron administrative boundary | match | PASS | correct city |
| Hebron / English | Hebron administrative boundary | match | PASS | correct city |
| PPU main / Arabic | PPU Abu Rumman campus | Hebron but not main campus | FAIL | ambiguous multi-campus name; insufficient campus context |
| PPU main / English | PPU Building C at `31.5073157,35.0908933` | match | PASS | the old fixture expectation was wrong |
| Bab Al-Zawiya Square / Arabic | Bab Al-Zawiya Mosque | nearby but wrong feature | FAIL | related-feature ranking; square is third |
| Bab Al-Zawiya Square / English | no result | no | FAIL | missing/insufficient English name alias |
| Bethlehem / Arabic | Bethlehem administrative boundary | match | PASS | correct city |
| Bethlehem / English | Bethlehem administrative boundary | match | PASS | correct city |

Strict corrected initial quality is 5/8 (`62.5%`): Arabic 2/4 (`50%`), English 3/4 (`75%`). Fair query formulation—language preference, a bounded viewbox, PPU campus context and city context—raises this small set to 7/8 (`87.5%`), Arabic 4/4 and English 3/4; English Bab Al-Zawiya still returns no result. This diagnosis distinguishes fixture expectation error, ambiguity, related-feature ranking and missing English naming instead of treating all failures alike.

## Expanded representative dataset

The committed public dataset contains 30 location concepts and 60 top-result queries: nine city centres plus universities, public buildings, squares and landmarks across Hebron, Bethlehem, Ramallah/Al-Bireh, Nablus, Jericho, Jenin, Tulkarm and Qalqilya. It contains no home, user address, merchant recipient, phone-associated place, GPS or private location. Gaza is not included and no cross-region feasibility is inferred.

Queries use `accept-language`, the committed West Bank viewbox, structured city fields where suitable and canonical aliases/context where justified. Acceptance was declared before execution: the top result must fall inside the public expected bounding box and match the expected category and type. Related features do not pass merely because they are nearby.

| Quality | Accepted | Total | Rate | Gate |
|---|---:|---:|---:|---|
| Arabic | 26 | 30 | 86.7% | FAIL `<95%` |
| English | 25 | 30 | 83.3% | FAIL `<95%` |
| Overall | 51 | 60 | 85.0% | FAIL `<95%` |

Representative failures include: Qalqilya city ranking a residential landuse instead of a city/boundary; English Bab Al-Zawiya no result; Mahmoud Darwish Museum ranking its park; Qalqilya Zoo absent in both languages; Arabic Freedom Theatre absent; and English Bethlehem Peace Center ranking its restaurant. These are genuine ranking/name/tag/coverage problems, not transport failures and not repairable by a per-fixture fake lookup table.

A 200-query warm sequential rerun used an explicit 5,000 ms timeout and monotonic timing: p50 `14.858 ms`, p95 `18.885 ms`, maximum `54.968 ms`, zero errors. This is local database latency only.

## Operations and decision

Self-hosting requires PostgreSQL/PostGIS administration, update/replication design, backups, restore tests, security patching, index maintenance, boundary review, observability and disk/WAL planning. `NOMINATIM_OPERATIONAL_COMPLEXITY=HIGH`.

The expanded quality gate fails in both languages. Further fixture-specific tuning is not justified. Later same-fixture comparisons of Pelias, Photon, Google address Geocoding v4, and Google Places Text Search also failed the 95% gates. `GEOCODING_CANDIDATE=NO_GEOCODER_APPROVED_YET`; `NOMINATIM_GEOCODING_CANDIDATE=FAIL`; `GENERIC_GEOCODER_AS_SOURCE_OF_TRUTH=NOT_APPROVED`. The recommended next design direction is a Darb-owned canonical Palestinian place catalog and search architecture; routing remains independently separable.
