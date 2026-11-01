# ADR-021: Canonical place catalog and search architecture

- Status: proposed; design only
- Date: 2026-08-08
- Milestone: M7D1C

## Context

M7D1B proved that no evaluated generic provider met Darb's public-place search gate of at least 95% in Arabic, English, and overall. Nominatim reached 85.0% overall, Google Places Text Search 80.0% top-1, Photon 75.0%, Pelias 41.7%, and Google Geocoding v4 35.0% for named-public-place search. Provider output therefore cannot be the authority for transport stops or approved public places.

Darb also needs bilingual aliases, deterministic search, reviewable coordinates, duplicate handling, and stable route history. Provider content may have retention and attribution restrictions. Private homes and user location history are a separate privacy domain and cannot enter a public place catalog.

## Considered alternatives

1. **Use the best generic provider as the source of truth.** Rejected because every tested source failed the quality gate, terms differ, and provider changes could silently rewrite canonical transport data.
2. **Automatically import external suggestions into the catalog.** Rejected because discovery confidence is not human verification and provider content may not be retainable.
3. **Keep adding names and coordinates directly to the existing `Stop` table.** Rejected as the long-term model because it lacks aliases, field-level provenance, review workflow, duplicate redirects, and reusable search semantics.
4. **Introduce a dedicated search cluster immediately.** Rejected for beta scale. Indexed MySQL retrieval plus bounded deterministic application-side ranking is sufficient until measured load or corpus size proves otherwise.
5. **Use mutable place rows with audit events only.** Rejected for approved content because a coordinate or canonical-name edit could silently change new route authoring and make an old decision difficult to reconstruct.

## Decision

Darb will own an authoritative catalog of approved public places. A place becomes canonical only after an authorized reviewer who did not propose the searchable content approves an immutable revision whose bilingual identity, type, locality context, coordinate precision, and field-level provenance satisfy policy. Only an active approved revision participates in normal canonical search.

The conceptual model uses a stable `CanonicalPlace`, immutable `CanonicalPlaceRevision` records, independently lifecycle-managed `PlaceAlias` records, field-level `PlaceProvenance`, and isolated `PlaceExternalReference` tokens. Approval state belongs to a revision; operational active/deprecated/merged state belongs to the stable place. A merged place redirects to one surviving canonical place and is never destructively deleted.

Search is deterministic and canonical-first. It uses conservative Arabic and English normalization, exact and approved-alias tiers before prefix/token and bounded fuzzy tiers, explicit locality/corridor context, and a stable final tie-breaker. Exact collisions do not silently select a place. Generated transliterations are suggestions only; they rank below approved aliases and cannot make content canonical.

External discovery is a separate, explicit, provider-neutral operation returning ephemeral, visibly non-canonical suggestions. It cannot write canonical records, and operators may not re-key restricted provider content as a provenance workaround. Google remains a conditional discovery fallback only. Google content is restricted; a permitted Place ID may be retained only under a reviewed refresh policy and cannot confer ownership of names or coordinates.

Coordinates require an approved retainable source, precision, provenance, verifier, and verification time. Commercial discovery coordinates are not copied automatically. OSM-derived names or coordinates remain `LEGAL_REVIEW_REQUIRED` until licensing, attribution, derivation, and distribution obligations are approved. This ADR does not resolve canonical route-geometry storage rights.

Existing immutable route history remains authoritative. A future implementation may link a newly created immutable `Stop` projection to the exact approved place revision from which it was authored. Existing stops and published route versions are not backfilled automatically or mutated. A changed place coordinate affects only a newly reviewed stop/route version. Trips continue to retain bounded immutable route snapshots.

## Consequences

- `GENERIC_GEOCODER_AS_SOURCE_OF_TRUTH=NOT_APPROVED`.
- `CANONICAL_PLACE_CATALOG_DIRECTION=APPROVED`.
- Search behavior is reproducible, testable, bilingual, and reviewable.
- Catalog curation and dual-control approval add operational work.
- Aliases, coordinates, merges, and deprecations require audit events and non-destructive history.
- Only Masari-owned or explicitly retainable canonical data may be distributed for offline search.
- MySQL remains the beta storage/retrieval foundation; a search engine requires later evidence and approval.
- M7D1C changes no application code, Prisma schema, migration, API, Flutter, Admin behavior, or production provider configuration.

## Unresolved questions

- Legal approval for each OSM/ODbL-derived place-data workflow and its attribution architecture.
- The exact initial Phase A catalog, named reviewers, and capability separation.
- Final alias uniqueness constraints and fuzzy thresholds after fixture-based tuning.
- Whether public IDs should be opaque stable keys or curated slugs.
- The reviewed retention/refresh policy for any external provider reference.
- Renderer selection, Valhalla production architecture, production SRE ownership, and TCO remain outside M7D1C.

## Implementation gate

Implementation is prohibited until this design is independently reviewed and human-approved, the initial authoritative dataset and acceptance fixtures are approved, coordinate and external-reference policies receive legal/security review, admin capabilities and dual-control rules are assigned, and a separately authorized schema/migration plan is accepted. M7D2 and M7E remain blocked.

The complete design is in [Canonical Palestinian Place Catalog and Search Architecture](../maps/canonical-place-catalog-search-architecture.md).
