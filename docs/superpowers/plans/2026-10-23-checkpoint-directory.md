# Checkpoint Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prepare a backend-owned, read-only Arabic checkpoint research directory without publishing the supplied data or enabling checkpoints.

**Architecture:** The user approved public code plus a version/hash manifest and synthetic fixtures, with the complete supplied dataset local and ignored until provider permission. A validated file-backed service is separate from the live coordinate-requiring checkpoint service. An authenticated, independently gated directory endpoint supplies names and cities to a session-bound mobile directory, using existing components. No database migration or provider request.

**Tech Stack:** Existing Express/TypeScript/Zod, Riverpod/Flutter, Vitest and Flutter tests.

**Spec:** Task19A user request and explicit approval of the public-code/local-data split.

## Global Constraints

- Base PR61 ec5f71d6fd6f0553f4c9313fa2773635e6ab3fb8, tree7223ac359dff5107dbca62f7f4cf07612f7f131e.
- Exactly173 local research listings across11 cities; research keys are not provider IDs.
- Raw dataset excluded from Git, mobile assets, build output and public diagnostics; hosted tests use synthetic fixtures.
- Directory capability defaults disabled. Unapproved data cannot be served even if the capability is toggled.
- No map markers, inferred traffic status, provider access, schema changes, activation, merge, deployment, history rewrite or CodeRabbit.
- Preserve Task18A transport, Task18B isolation, PRs50–61 and production-readiness.

## Review Focus

- Duplicate names in different cities retain separate immutable research keys.
- Malformed, changed or unapproved files fail closed without logging records or filesystem paths.
- Directory data cannot enter the live coordinate/status parser or map marker path.
- Session/capability loss and late responses cannot expose prior directory state.
- Public Git history, APK/Admin artifacts and CI logs contain no supplied directory rows.

## Task1: Backend directory boundary

- [ ] Add failing API/capability regressions against the existing app: defaultfalse, disabled404, enabled401 and role protection.
- [ ] Add a version/hash/count/city-total manifest, validated read-only file service, bounded file reading and research identity validation.
- [ ] Wire a separate default-disabled capability and authenticated GET endpoint; require independently approved publication metadata and never serialize precise coordinates/status claims.
- [ ] Add synthetic service tests for hash/count/city totals, duplicate names, missing IDs/coordinates, unknown status, malformed inputs and denied publication.
- [ ] Run focused tests and a separate local verification using all173 actual records without printing their content.

## Task2: Mobile directory

- [ ] Add failing real-repository/provider/widget tests for disabled entry, Arabic search/grouping, duplicate identities, unavailable traffic, no markers and session races.
- [ ] Add separate directory models/repository and actor+revision-bound provider using existing authenticated transport.
- [ ] Add a gated directory action/screen using existing MasariCard/MasariSection and neutral copy; keep the stable router and live checkpoint flow unchanged.
- [ ] Run focused Flutter tests, formatter and analyzer; preserve red diagnostics separately.

## Task3: Whole-branch verification and publication

- [ ] Run full API/Admin/Flutter/tooling, localization, typechecks, builds, migration integrity, disposable MySQL, full/production audits and source/artifact/public-data leakage scans.
- [ ] Obtain one fresh independent read-only source/security review; reproduce and fix any confirmed scoped finding with RED/GREEN.
- [ ] Commit verified source, verify final immutable scope/tree and absence of supplied rows, push a new branch and create one draft PR directly on PR61.
- [ ] Verify four exact-head hosted workflows and checkout tree; reconfirm protected PR heads/bases and production unchanged.
- [ ] Report exact evidence, source-only independent-review limits, local173 versus synthetic hosted coverage, and all external release blockers.
