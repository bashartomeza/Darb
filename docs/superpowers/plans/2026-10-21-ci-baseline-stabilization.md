# CI baseline stabilization implementation plan and issue ledger

**Goal:** Restore the integration CI baseline independently of Draft PRs #50 and #51.
**Authority:** User request: independent provenance, narrowly scoped draft baseline PR, full verification; no merge/deployment, schema/history changes, credentials, provider calls, CodeRabbit or redesign.
**Architecture:** Preserve existing runtime contracts. Repair only reproduced inherited CI defects, with selective comparison to #50 rather than copying its feature changes.
**Toolchain:** Node 22.17.1, pinned Flutter, actual disposable MySQL 8.0.

## Exact starting references

- Integration: b372cc3cdc916ef03f1a64da3800786312cb76c4 (fetched 2026-10-21).
- Merchant #51: e5b53f1976a67ee809a24a269ce286e758c0a903.
- Recovery #50: 566fd120f47d66fec6f60588ab11c0be53c8f2bb.
- Isolated branch: codex/ci-baseline-stabilization-20261021.

## Plan

- [ ] Reproduce baseline/#51 failures and compare relevant #50 paths; retain safe logs and source hashes.
- [ ] Review missing migration SQL and immutable history before correcting only obsolete test inventory.
- [ ] Repair monitoring fixture contract and any newly exposed confirmed failures using actual MySQL and unchanged budgets.
- [ ] Repair formatter/analyzer and existing compact driver summary layout without changing design or assertions.
- [ ] Pin minimally disruptive patched Vite and consistent lock; regression for dependency floor.
- [ ] Run full API/Admin/Flutter/analyzer/tooling/build/artifact/security/audit/MySQL checks.
- [ ] Independent source/security review of final patch, focused commits, draft PR, exact-head four hosted workflows.

## Review focus

Never print historical provider credentials or private connection values. Fixtures must satisfy current auth/phone/status contracts and clean only run-owned rows. Preserve canonical exclusions and read-only monitoring. Preserve all migration bytes and existing expected hashes. Leave #50/#51 source and refs unchanged. Record overlapping minimal #50 hunks and future merge implications explicitly.

## Evidence

Ignored local evidence: `.staging-data/ci-baseline-evidence` (redacted logs only). Detailed classifications/results will be recorded after reproduction; no passing claims inferred from earlier runs.

## Provenance and root causes (observed 2026-10-21)

| Failure | Integration / #51 | #50 now | Correction |
| --- | --- | --- | --- |
| Monitoring setup | Actual MySQL P2000, fixture phone length 40 > varchar(32) | PASS actual MySQL | Valid bounded phones, complete verified fixture profiles |
| Stale monitoring fixture contracts | Source: past preferred time can be expired by worker; six-value cycle against nine batch statuses | Corrected | Future preferred time while retaining historical created date; cover all nine statuses with exact counts |
| Monitoring volume after setup repair | Actual MySQL service matches limit25: 15,421ms; seven SQL statements; two SELECTs 7,647 / 7,656ms; 10,000ms budget and read transaction timeout unchanged | PASS same actual MySQL run | Reuse #50's independent top-level invalid-parcel exclusions; preserve optional relations and both order identities |
| Six formatter files | RED on both exact heads | PASS | Formatter only outside explicit lint/layout repairs |
| Seven analyzer findings | Same seven RED on both exact heads | PASS | Remove debug print/unused fields, lowerCamelCase helper, supported Flutter APIs |
| Four driver widget tests | Same four RED on both exact heads; 6px bottom overflow | PASS (24 tests) | Replace fixed66 with minHeight72, retaining controls/text/styles and assertions |
| Migration inventory | RED on both exact heads; actual 27 migrations vs expected26 | PASS | Add reviewed missing expected entry only |
| Vite audit | Both full/production audits RED on all three exact heads | Also RED now | Vite8.1.6 patch + root override for plugin/Vitest, update only Vite lock graph |

No listed failure was introduced by #51. None is established as environment-only. npm10 dedupe dry-run itself failed (`edgesOut`); focused `npm update vite` under exact override resolved the graph without forced audit fixes.

Ruling: a standalone green integration baseline necessarily includes minimal hunks already present in #50. Reuse those reviewed hunks rather than independently reimplementing them. This is limited to monitoring, formatting/lint/layout and migration inventory; no booking/auth/router/map/provider functional fixes are copied. Future integration of #50 must reconcile shared formatted files and the monitoring script; identical policy/inventory hunks should resolve identically. #50 and #51 remain untouched.

Migration review: `20261012165000_allow_legacy_offer_lifecycle_timestamps` changes only legacy lifecycle NULL restrictions. Both canonical CHECK arms are unchanged from the prior constraint. Independently verified normalized checksum: `0a349a0bf2367407e41f89642ae8c407e266fbc17d67d0cf83159e97acedb0be`. Existing26 expected checksums and all27 SQL files remain unchanged.

Vite source: https://github.com/vitejs/launch-editor/security/advisories/GHSA-587h-7wmj-h5pm lists8.1.6 as patched; the same patch closes both associated bundled launch-editor advisories. Initial install left8.1.3 hoisted for plugin/Vitest; exact root override plus focused update removes that copy.

Provider compatibility remains UNVERIFIED_BLOCKED; credential revocation/rotation remains PENDING_OWNER_CONFIRMATION. Existing provider boundary remediation belongs to #50; this CI PR does not enable or validate upstream integration. No provider requests or credential reuse.
