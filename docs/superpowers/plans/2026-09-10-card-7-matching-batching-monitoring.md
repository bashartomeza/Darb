# Card 7 Matching & Batching Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development task-by-task and superpowers:test-driven-development for behavior changes. Steps use checkboxes. This planning phase does NOT authorize implementation.

**Goal:** Give Admins bounded, honest, read-only monitoring of production-supported legacy matching results and parcel batches.

**Architecture:** A dedicated Prisma query service owns shared eligibility predicates, safe projections and transactional observations. Six Admin-only GET endpoints feed Overview, Matching and Legacy Batches. Canonical fallback and algorithm invocation are absent.

**Tech Stack:** Existing Node 22.17.1/npm 10.9.2, TypeScript, Express 5, Prisma 7/MySQL, Zod 4, React 19, Vitest and Supertest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-10-card-7-matching-batching-monitoring-design.md`; read both documents.

## Global Constraints

- Production-supported legacy runtime records only; exclude canonical data in every environment.
- Exclude demo participants and seeded/unknown-source passenger requests. Do not claim complete test provenance.
- Six GET endpoints only; server-side Admin authorization; no matching/batching/domain writes.
- Pagination default 25, max 50; page 1–1000; exact ID search only; default 7-day and maximum 31-day creation range.
- Manual refresh with observation timestamp; no polling or fake realtime.
- Keep passenger requests and merchant orders separate, including combined Match rows.
- Stored score is Score, never confidence. Accepted is not completed. No inferred expiry, global success rate or exhaustive failure reasons.
- Safe projections only; no raw payloads/snapshots/fingerprints, unnecessary PII or coordinates.
- No algorithm, Maps/GPS, realtime engine, mobile, AI or Trip lifecycle changes.
- Card 7 introduces no Prisma/schema changes or migrations; the current production-readiness baseline contains 22 migrations.
- Never access real darb. Integration uses explicitly allowed disposable *_ci databases.
- No implementation or PR now. No merge of the eventual PR, rebase or force-push.

## Execution protocol

Branch `codex/card7-matching-batching-monitoring` was created in `.staging-data/card7-discovery` from freshly fetched production-readiness `798b1087865e38b7ed5d1b25f686c853708fdd0d`. PR #30 is merged at that base. Before future execution, fetch and check the base again. If it changed, inspect incoming changes, integrate with a normal merge commit and reassess the design before implementation.

After the user requests execution, use a fresh implementer per task, supplying this spec, global constraints, task and prerequisite interfaces. Run spec-compliance then code-quality review per task. Parent performs integration and whole-branch review. Do not concurrently edit shared App.tsx/api.ts files. Show failing behavior tests before code and green tests afterward. Commit only named task files, not unrelated untracked files. Parent self-review of the plan is mandatory even if another agent reviews it.

## File map

Create API files:
- `apps/api/src/services/adminMatchingMonitoring/contracts.ts`: DTOs, strict parsers/status definitions.
- `apps/api/src/services/adminMatchingMonitoring/policy.ts`: typed eligibility predicates and Prisma selects.
- `apps/api/src/services/adminMatchingMonitoring/service.ts`: bounded transactional reads and serializers.
- `apps/api/src/modules/adminMatchingMonitoring.ts`: six Admin GET routes.
- `apps/api/src/tests/adminMatchingMonitoringContracts.test.ts`.
- `apps/api/src/tests/adminMatchingMonitoringService.test.ts`.
- `apps/api/src/tests/adminMatchingMonitoringApi.test.ts`.
- `apps/api/src/tests/adminMatchingMonitoringIntegrationSafety.test.ts`.
- `apps/api/src/scripts/adminMatchingMonitoringIntegrationSafety.ts`: pure target guard before DB connection.
- `apps/api/src/scripts/adminMatchingMonitoringIntegration.ts`: disposable fixtures and HTTP/SQL verification.

Create Admin files:
- `apps/admin/src/features/monitoring/contracts.ts`: frontend wire types, no ORM import.
- `apps/admin/src/features/monitoring/monitoringState.ts` and `monitoringState.test.ts`: generation gate.
- `apps/admin/src/features/monitoring/MatchingBatchingMonitoring.tsx` and corresponding `.test.tsx`: tabs/Overview.
- `apps/admin/src/features/monitoring/MatchingResults.tsx` and corresponding `.test.tsx`: matching table/detail.
- `apps/admin/src/features/monitoring/LegacyBatches.tsx` and corresponding `.test.tsx`: batches/detail/member paging.

Modify:
- `apps/api/src/app.ts`: router mount and injected service dependency.
- `apps/admin/src/api.ts`, `apps/admin/src/api.test.ts`: six typed client methods using existing session handling.
- `apps/admin/src/App.tsx`: replace matchingBatching module entry.
- `apps/admin/src/navigation.ts`, `apps/admin/src/navigation.test.ts`: api backing, retain hash aliases.
- `apps/admin/src/i18n/translations.ts`: complete English/Arabic copy.
- `apps/admin/src/styles.css`: monitoring-only responsive styles where existing primitives are insufficient.
- `package.json`: one integration script, no dependency changes.
- `scripts/ci-mysql-integration.mjs`: include monitoring in existing Backend CI smoke loop.

Existing algorithm/demo feature modules, Prisma, Mobile, Maps, route management and security policy are not edit targets. Remove only unused demo imports from App after replacing its module entry. Documentation above remains on the branch.

## Shared interfaces

API contracts import generated entity enums from `../../generated/prisma/enums.js`. Frontend mirrors these as string unions. `Range={from:string;until:string}` contains UTC ISO strings. All wire dates are strings.

```ts
export type Observed<T> = {
  observed_at: string; scope: 'production_supported_legacy'; data: T;
};
export type Page<T> = Observed<{
  items: T[]; page: number; limit: number; total: number;
  has_more: boolean; range: Range | null;
}>;
export type DemandKind = 'passenger_only' | 'merchant_only' | 'combined';
export type PageQuery = { page: number; limit: number };
export type MatchQuery = PageQuery & Range & {
  status?: MatchStatus; demand_kind?: DemandKind; search?: string;
};
export type BatchQuery = PageQuery & Range & {
  status?: ParcelBatchStatus; search?: string;
};
export type MatchRow = {
  id: string; status: MatchStatus; created_at: string; score: string;
  method: 'darb_route_score' | 'unrecognized'; demand_kind: DemandKind;
  driver_route: { id: string; status: DriverRouteStatus };
  passenger_request: null | { id: string; status: RequestStatus; passenger_count: number };
  merchant_order: null | { id: string; status: MerchantOrderStatus; parcel_count: number };
  parcel_batch: null | { id: string; status: ParcelBatchStatus };
};
export type BatchRow = {
  id: string; status: ParcelBatchStatus; created_at: string;
  merchant_order: { id: string; status: MerchantOrderStatus; parcel_count: number };
  selected_driver_route: null | { id: string; status: DriverRouteStatus };
};
export type ParcelRow = { id: string; status: ParcelStatus };
export type CurrentOrderParcelsPage = Observed<Page<ParcelRow>['data'] & {
  contents_semantics: 'current_eligible_order_contents'; merchant_order_id: string;
}>;
export type Overview = {
  range: Range; pending_passenger_requests: number; submitted_merchant_orders: number;
  match_results_by_status: Record<MatchStatus, number>;
  batches_by_status: Record<ParcelBatchStatus, number>; active_batches: number;
  capabilities: {
    canonical_monitoring: 'unavailable'; failed_attempt_history: 'not_recorded';
    completed_batches: 'not_supported';
  };
};
export interface MonitoringService {
  overview(query: Range): Promise<Observed<Overview>>;
  matches(query: MatchQuery): Promise<Page<MatchRow>>;
  match(id: string): Promise<Observed<MatchRow>>;
  batches(query: BatchQuery): Promise<Page<BatchRow>>;
  batch(id: string): Promise<Observed<BatchRow>>;
  parcels(id: string, query: PageQuery): Promise<CurrentOrderParcelsPage>;
}
```

Parsing exports: `parseRange(input:unknown,now:Date):Range`, `parseMatchQuery(input:unknown,now:Date):MatchQuery`, `parseBatchQuery(input:unknown,now:Date):BatchQuery`, `parsePageQuery(input:unknown):PageQuery`, `parseMonitoringId(input:unknown):string`. Full queries validate strict keys before passing only from/until into parseRange.

Service factory: `createMonitoringService(db:PrismaClient,clock:()=>Date = ()=>new Date()):MonitoringService`. Router factory: `createAdminMatchingMonitoringRouter(service?:MonitoringService):Router`, defaulting to service over existing prisma. Add `adminMatchingMonitoringService?:MonitoringService` to AppDependencies. Parsing captures now; service read-start observed_at is equal or later, and normalized range is not recomputed mid-request.

Frontend request types permit server defaults without changing normalized service types: `RangeInput = Range | {from?:never;until?:never}`, `MatchQueryInput = Partial<Omit<MatchQuery,keyof Range>> & RangeInput`, `BatchQueryInput = Partial<Omit<BatchQuery,keyof Range>> & RangeInput`. These are exported by frontend contracts.ts. The browser omits both date parameters for default-range initial load/manual refresh; it echoes the server-returned range during paging. Explicit date selection sends both. This avoids using a fast client clock to manufacture a future until.

## Task 1: Contracts and eligibility

**Files:** create API contracts.ts, policy.ts and adminMatchingMonitoringContracts.test.ts.

**Produces:** shared DTOs/parsers; typed constants `eligiblePassenger`, `eligibleOrder`, `eligibleRoute`, `eligibleParcel`, `eligibleBatch`, `eligibleMatch` using corresponding Prisma WhereInput types; `matchSelect`, `batchSelect`, `parcelSelect` using corresponding Prisma Select types.

- [x] Write parser tests for defaults, limits, strict keys, arrays, dates and combined demand:
```ts
const now = new Date('2026-09-10T12:00:00.000Z');
expect(parseMatchQuery({}, now)).toEqual({ page: 1, limit: 25,
  from: '2026-09-03T12:00:00.000Z', until: '2026-09-10T12:00:00.000Z' });
expect(() => parseMatchQuery({ limit: '51' }, now)).toThrow();
expect(() => parseMatchQuery({ limit: ['25'] }, now)).toThrow();
expect(() => parseMatchQuery({ source: 'canonical' }, now)).toThrow();
expect(() => parseBatchQuery({ status: 'completed' }, now)).toThrow();
expect(parseMatchQuery({ demand_kind: 'combined', search: ' m1 ' }, now).search).toBe('m1');
```
- [x] Run `npm run test -w @darb/api -- src/tests/adminMatchingMonitoringContracts.test.ts`; confirm red before code.
- [x] Implement strict Zod parsing: numeric scalar strings only, integer bounds, paired UTC Z ranges, max31 days, no future until, blank search normalized absent, IDs/search max191. Preserve unknown-key rejection.
- [x] Implement typed predicates from spec section3 and selects from section6:
```ts
export const eligibleParcel = { operational_mode: 'legacy',
  canonical_entry_version: null, route_version_id: null } satisfies Prisma.ParcelWhereInput;
export const parcelSelect = { id: true, status: true } satisfies Prisma.ParcelSelect;
export const eligiblePassenger = { operational_mode: 'legacy',
  canonical_entry_version: null, route_version_id: null, source: 'manual',
  passenger: { is: { demo_account: false } } } satisfies Prisma.PassengerRequestWhereInput;
```
  Order requires merchant.is.demo_account=false and parcels.every=eligibleParcel. Route requires driver.is.user.is.demo_account=false, with no current-active requirement. Batch requires eligible order plus null-or-eligible route. Match requires canonical identifiers null, eligible route, at least one demand and independent null-or-eligible clauses for EACH demand/batch relation. One valid link cannot authorize a different excluded link. Use filtered `_count.parcels` instead of nested arrays.
- [x] Test predicate composition and exact select key sets; do not claim mocks prove SQL eligibility (Task7 does). Run focused tests/typecheck to green. Commit these three files: `feat(api): define production-only monitoring contracts`.

## Task 2: Transactional read service

**Files:** create service.ts and adminMatchingMonitoringService.test.ts.
**Consumes:** Task1 contracts/policy. **Produces:** createMonitoringService and six interface methods.

- [x] Write tests with a Prisma read mock whose `$transaction` calls the callback with read delegates; all mutation delegates throw. Define selected fixtures with `Prisma.MatchGetPayload<{select:typeof matchSelect}>`; no any casts. Include combined Match selected fixture with request_1/order_1, score Decimal('0.8750') and clock now:
```ts
const result = await service.matches(parseMatchQuery({}, now));
expect(result.data.items[0].demand_kind).toBe('combined');
expect(result.data.items[0].passenger_request?.id).toBe('request_1');
expect(result.data.items[0].merchant_order?.id).toBe('order_1');
expect(result.data.items[0].score).toBe('0.875');
expect(result.observed_at).toBe(now.toISOString());
```
  Score preserves decimal value, not trailing-zero display formatting. Test exact keys, method allowlist, null route, zero-filled maps, page/count and missing/excluded 404.
- [x] Run `npm run test -w @darb/api -- src/tests/adminMatchingMonitoringService.test.ts`; confirm red.
- [x] Implement all reads with shared eligibility and explicit serialization. Details use findFirst(id AND eligibility), missing -> HttpError(404,'not_found'). Each method captures observed_at before a RepeatableRead transaction with maxWait2000/timeout5000. Page/count share transaction; no N+1. Filters are typed WhereInput built from exact query fields:
```ts
const rows = await tx.match.findMany({
  where: { AND: [eligibleMatch, filters] }, select: matchSelect,
  orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
  skip: (query.page - 1) * query.limit, take: query.limit
});
```
  `filters:Prisma.MatchWhereInput` is local to matches: created_at gte/lt, optional status, demand-kind null/non-null clauses and exact-ID OR. Client filters never overwrite eligibility. Overview uses groupBy/count and zero-filled enum maps. active_batches sums created/assigned/picked_up/in_transit. Member parent authorization and page/count share a transaction; filter Parcel by order_id and eligibleParcel, sort id ASC. No Trip queries.
- [x] Map recognized DB unavailability/timeouts to sanitized HttpError(503,'monitoring_unavailable'), never zero counts. Test timestamps do not cause expiry, current-state overview counts ignore cohort range, and batch/order mismatches stay visible. Assert canonical delegates/domain mutations are unused, exact fields contain no sensitive markers, transactions have correct settings.
- [x] Run Task1/2 tests and API typecheck to green; commit exact files: `feat(api): add bounded legacy monitoring reads`.

## Task 3: Admin HTTP boundary

**Files:** create router and adminMatchingMonitoringApi.test.ts; modify app.ts.
**Consumes:** service/parsers. **Produces:** exactly six routes under `/api/v1/admin/matching-batching`: GET overview, matches, matches/:id, batches, batches/:id, batches/:id/parcels.

- [x] Copy only session-backed auth fixture setup from adminTrips.test.ts into the new suite. Inject a test-local `service` object satisfying MonitoringService with vi.fn methods. Add all-six-route role matrix: unauthenticated401, passenger/driver/merchant403, revoked/expired Admin401, active Admin200. Include:
```ts
const app = createApp(undefined, { adminMatchingMonitoringService: service });
await request(app).get('/api/v1/admin/matching-batching/overview').expect(401);
expect(service.overview).not.toHaveBeenCalled();
```
- [x] Run `npm run test -w @darb/api -- src/tests/adminMatchingMonitoringApi.test.ts`; confirm intended failures.
- [x] Add factory, router-level requireAuth/requireRole('admin'), six handlers and app dependency/mount. Existing Express5 error handling handles rejected async handlers:
```ts
router.get('/matches/:id', async (req, res) => {
  z.object({}).strict().parse(req.query);
  res.json(await service.match(parseMonitoringId(req.params.id)));
});
```
- [x] Apply the same strict empty-query validation to batches/:id. Test unknown/array query keys on both detail routes (including ?source=canonical) return400 before service reads. Test exact search, forbidden source toggles on directories, detail/member404 equivalence, 503 sanitization, and POST/PATCH/DELETE404 with no service writes. Both production and demo app configuration expose the same legacy-only service. Auth session touch is allowed; domain mutations are not.
- [x] Run new HTTP suite, existing environmentRoutes/httpSecurity and full API tests/typecheck. Commit exact files: `feat(api): expose Admin monitoring GET endpoints`.

## Task 4: Admin client and observation state

**Files:** create Admin contracts.ts, monitoringState.ts/.test.ts; modify api.ts/api.test.ts.
**Consumes:** API wire DTOs. **Produces:** matching frontend types and ApiClient methods:
- monitoringOverview(token:string,query?:Range):Promise<Observed<Overview>>
- monitoringMatches(token:string,query:MatchQueryInput):Promise<Page<MatchRow>>
- monitoringMatch(token:string,id:string):Promise<Observed<MatchRow>>
- monitoringBatches(token:string,query:BatchQueryInput):Promise<Page<BatchRow>>
- monitoringBatch(token:string,id:string):Promise<Observed<BatchRow>>
- monitoringParcels(token:string,id:string,query:PageQuery):Promise<CurrentOrderParcelsPage>

State exports `createObservationGate():{begin():number;isCurrent(generation:number):boolean;invalidate():void}` and `ObservationState<T>={last:Observed<T>|null;loading:boolean;error:string|null}`. For pages T is Page<TItem>['data'].

- [x] Write fetch-spy tests for six exact GET paths, URLSearchParams encoding, token headers, absent body and session callback. Test stale generations:
```ts
const gate = createObservationGate();
const old = gate.begin(); const current = gate.begin();
expect(gate.isCurrent(old)).toBe(false);
expect(gate.isCurrent(current)).toBe(true);
gate.invalidate(); expect(gate.isCurrent(current)).toBe(false);
```
- [x] Run `npm run test -w @darb/admin -- src/api.test.ts src/features/monitoring/monitoringState.test.ts`; confirm red.
- [x] Add wrappers inside createApiClient using its private apiRequest (do not bypass session handling):
```ts
monitoringMatch: (token: string, id: string) =>
  apiRequest<Observed<MatchRow>>(`/admin/matching-batching/matches/${encodeURIComponent(id)}`, { token }),
```
  Gate increments a counter on begin/invalidate. No timers. Mirror exact DTO property names; no ORM import on Admin.
- [x] Test 400/401/403/404/503 propagation and no mutation wrappers. Run focused tests/typecheck. Commit exact files: `feat(admin): add monitoring client and observation state`.

## Task 5: Overview and Matching UX

**Files:** create MatchingBatchingMonitoring.tsx/.test.tsx and MatchingResults.tsx/.test.tsx; modify App.tsx, navigation.ts/.test.ts, translations.ts and scoped styles.css as needed.
**Consumes:** client/types/gate. **Produces:** `MatchingBatchingMonitoring({api,token}:{api:ApiClient;token:string})` and `MatchingResults({api,token}:{api:ApiClient;token:string})` React components. Overview initial tab; Task6 connects Batches before feature completion.

- [x] Add React DOM tests using existing jsdom/React act/createRoot patterns and localized static rendering. Mock six monitoring methods; legacy action mocks throw if called. Assert separate request/order cards, current-state vs creation-cohort labels, unavailable notices, both combined links, Score label, no success-rate/confidence or algorithm controls. Extend existing navigation fixture with demoEnabled=false and require matchingBatching available.
- [x] Run `npm run test -w @darb/admin -- src/navigation.test.ts src/features/monitoring/MatchingBatchingMonitoring.test.tsx src/features/monitoring/MatchingResults.test.tsx`; confirm red.
- [x] Build table/detail and Overview using existing UI primitives. Matching filters are date/status/kind/exact-ID; change resets page1. Each endpoint has independent generation/state and last successful observed_at. Request function uses this pattern, with local state typed ObservationState<MatchRow>:
```tsx
const generation = gate.begin();
setState(previous => ({ ...previous, loading: true, error: null }));
api.monitoringMatch(token, selectedId).then(response => {
  if (gate.isCurrent(generation))
    setState({ last: response, loading: false, error: null });
});
```
  Add catch in that same function: ignore old generation; 401/403 clears last; 404 clears selected detail; other errors retain only same-selection data with stale indicator. Cleanup, token and selection changes invalidate gate and clear old selection before requests. No polling/subscriptions/render-time fetch. Omit date parameters for server-default range; echo response range on paging. Default-range manual refresh resets page1 and requests a new server range; explicit-range refresh retains selected dates and resets page1. Show 400 date validation clearly without silently changing an explicit selection.
- [x] Replace matchingBatching App case with new component using existing authenticated token narrowing; set navigation backing api, keep aliases. Remove only newly unused imports. Add complete EN/AR translations, RTL, accessible filters/table, focus trap/entry/return and responsive detail.
- [x] Test deferred response races, failed refresh timestamp retention, stale selection/session clearing, empty vs unavailable/error, zero counts, neutral Unknown status, page1000 narrow-filter instruction, Arabic and keyboard navigation. Run full Admin tests/typecheck/build; commit exact files: `feat(admin): monitor legacy matching results`.

## Task 6: Legacy Batches UX

**Files:** create LegacyBatches.tsx/.test.tsx; connect Batches tab in MatchingBatchingMonitoring.tsx; add translations/scoped styles.
**Consumes:** client/types/gate. **Produces:** `LegacyBatches({api,token}:{api:ApiClient;token:string})`.

- [x] Add tests with this allowed fixture and a separate 25+1 parcel page mock:
```ts
const batch: BatchRow = { id: 'b1', status: 'assigned',
  created_at: '2026-09-10T10:00:00.000Z',
  merchant_order: { id: 'o1', status: 'submitted', parcel_count: 26 },
  selected_driver_route: null };
```
  Render and assert BOTH different statuses, Current eligible order contents, No selected route, 25 rows then one row, and no completed/savings/timeline claims. Test list filters and independent detail/member timestamps.
- [x] Run `npm run test -w @darb/admin -- src/features/monitoring/LegacyBatches.test.tsx`; confirm red.
- [x] Implement directory/date/status/exact-ID filters, detail and independently paginated members. Invalidate both gates on parent change; clear member rows on parent404/auth failures. Never use Parcel.batch_id or query trips. Render only allowed fields:
```tsx
<tr key={row.id}><td>{row.id}</td><td>{statusLabel(row.status)}</td></tr>
```
  Local `statusLabel(status:ParcelStatus):string` maps translations with Unknown fallback. BatchStatus and MerchantOrderStatus use their own maps. Member pages retain failed-refresh data only for the same parent. No lifecycle controls.
- [x] Test old-parent response cannot repopulate drawer, page/filter resets, keyboard focus and EN/AR. Run full Admin tests/typecheck/build. Commit exact files: `feat(admin): monitor legacy parcel batches`.

## Task 7: Real MySQL proof and CI inclusion

**Files:** create two integration scripts and safety test; modify package.json/ci-mysql-integration.mjs.
**Consumes:** six routes and existing disposable CI auth setup. **Produces:** `test:integration:monitoring` script = `node apps/api/dist/scripts/adminMatchingMonitoringIntegration.js`; pure guard `assertMonitoringIntegrationTarget(appEnv:string|undefined,databaseUrl:string|undefined,allowed:string|undefined):void`.

- [x] Test absent/malformed URL, darb case-insensitive, non-_ci, unlisted DB and wrong environment; errors must not echo URLs:
```ts
expect(() => assertMonitoringIntegrationTarget('test','mysql://localhost/darb','darb')).toThrow();
expect(() => assertMonitoringIntegrationTarget('test','mysql://localhost/card7_ci','other_ci')).toThrow();
expect(() => assertMonitoringIntegrationTarget('test','mysql://localhost/card7_ci','card7_ci')).not.toThrow();
```
- [x] Run `npm run test -w @darb/api -- src/tests/adminMatchingMonitoringIntegrationSafety.test.ts`; confirm red.
- [x] Implement URL path decoding, strict alphanumeric/underscore DB name, case-insensitive darb rejection, _ci suffix, exact allowlist membership and demo/test environment. Call before dynamic Prisma import, no .env loading or connection logging:
```ts
assertMonitoringIntegrationTarget(process.env.APP_ENV, process.env.DATABASE_URL,
  process.env.DEMO_RESET_ALLOWED_DATABASES);
const { prisma } = await import('../lib/prisma.js');
```
- [x] Create test-owned rows with unique run IDs: 60 eligible matches including combined, 26 parcels linked through order_id with batch_id null, seed/manual passengers, demo driver/passenger/merchant actors, canonical-marker rows and excluded nested links. Use legally constrained rows/builders; never disable FKs. Compare all six responses against expected eligible totals/pages/status maps and exact key allowlists. Verify guessed excluded parent/member IDs404. Clean only this run's fixtures in FK order.
- [x] Snapshot only fixture-owned domain rows before GET sequence and compare after; authSession excluded from no-write assertion. Use controlled fixture status updates between concurrent read calls to prove within-response consistency while allowing differing observations. Verify max50, default25, tied timestamp ordering and shrinking pages.
- [x] Add root npm script and invoke it after route integration in existing CI smoke loop, with canonical flags disabled. Run local disposable MySQL test and Backend CI. Measure query counts/timing with representative 10,000 synthetic matches including exact-ID, status/date pagination and overview. Read-only EXPLAIN slow reads. Target each endpoint <5 seconds on the documented fixture; no N+1. A failure requires read-query optimization or a reported blocker, never schema/index changes. This is fixture evidence, not a production SLA or proof that Prisma timeout cancels every SQL query.
- [x] Run safety/API/Admin tests and typechecks. Commit exact files: `test: verify monitoring against disposable MySQL`.

## Implementation status\r\n\r\nTasks 1–7 are implemented and reviewed. Task 8 validation and handoff gates remain pending until exact-head local, hosted, and security evidence is complete.\r\n\r\n## Task 8: Full validation and handoff

**Files:** no planned production edits; fix only technically verified Card7 failures. Keep secrets/QA credentials/DB contents out of evidence.

- [ ] Run `npm ci`, `npm audit`, `npm audit --omit=dev`, `npm run security:audit`; require vulnerabilities0, all severity counts0, no exceptions or force fix.
- [ ] Run `npm run validate:all`: Prisma validate/generate, API/Admin tests/typechecks/build, security/tooling and Mobile format/analyze/test. Run `npm run test:integration:mysql` only in allowed disposable environment; it includes Card6 and new monitoring. Verify the latest base's 22 migration directories and no Card 7 Prisma diff. No real DB migration.
- [ ] Match Mobile CI release build from apps/mobile: `flutter build apk --release --dart-define=APP_ENV=production --dart-define=ENABLE_DEMO_FEATURES=false --dart-define=API_BASE_URL=https://api.staging.darb.invalid`; then root `npm run security:artifacts -- --apk apps/mobile/build/app/outputs/flutter-apk/app-release.apk`. Do not modify Mobile for monitoring.
- [ ] Human-smoke-ready disposable UI check: separate units/cohort labels, combined match detail, filters/pages/manual refresh, batch order contents, unauthorized clearing, Arabic RTL/keyboard. Monitoring must not issue algorithm mutations.
- [ ] Whole-branch spec/quality review and Codex Security diff review. Validate findings technically before fixes. External CodeRabbit review requires Card7-specific private-diff/minimal-context authorization; earlier PR30/35 authorization does not cover it. Do not transmit any code during planning. Never transmit secrets/untracked QA files/DB contents.
- [ ] After implementation and authorization to open a draft PR, require exact-final-head hosted Admin, Backend/MySQL, Mobile and Security PASS, CodeRabbit without valid unresolved blockers, and Codex Security without validated unresolved findings. Meaningful fixes require affected local tests and fresh exact-head CI/security review. Do not create a PR now or merge the eventual PR.
- [ ] Report exact head/evidence/migration count. READY_FOR_HUMAN_MERGE only with all required gates evidenced, otherwise BLOCKED with exact failures/missing evidence. This document's READY_FOR_IMPLEMENTATION is not a claim that those gates passed.

## Parent self-review checklist

- Spec1–3: Task1 eligibility; Tasks2–3 read/auth boundaries; Task7 real SQL exclusions.
- Spec4: Tasks1–4 six GET paths, strict bounded queries, matching types, transactions and observation time.
- Spec5–6: Tasks1–2/5–6 separate demand units, cohort vs current counts, score and explicit safe fields/nulls.
- Spec7–8: Tasks4–7 no invented lifecycle/history, current order contents, concurrency, localization/accessibility/privacy.
- No canonical fallback, Trip queries, mutation interface, dependency, schema/index migration or real database requirement.
- Commands match existing scripts; new integration command is explicitly created. Parent completed placeholder scan and compared types/signatures across tasks. Frontend input types intentionally permit server defaults; normalized service query types remain required.
- Independent documentation review identified the createApp dependency argument position and missing strict empty-query validation on details. Both were technically checked and corrected. Parent also corrected client-clock range defaults and cross-checked schema enum/relation names and migration count.

Status: internally consistent and self-reviewed; READY_FOR_IMPLEMENTATION upon a user request to execute. Documentation only; implementation not started.

## Execution amendment — 2026-09-11
User authorized implementation, final reviews, branch push and one draft PR; do not merge or begin Card 8. This supersedes planning-only stop statements above. Active batch metric excludes proposed even though it exists in the enum: verify exact four-state sum in tests. CurrentOrderParcelsPage is the response for both service.parcels and client.monitoringParcels; tests/fixtures must include contents_semantics and merchant_order_id. Admin copy says Current eligible order contents and disclaims historical membership. Cursor is unsupported under approved offset pagination and must fail strict unknown-key validation; test malformed cursor inputs. Self-review confirms these amendments supersede the earlier metric and parcel-page types consistently.
