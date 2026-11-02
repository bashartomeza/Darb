import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ApiClient, ApiError } from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import { Button, Card, DataTable, EmptyState, Notice, StatusBadge, type Column } from "../../ui";
import { RouteDialog } from "../routes/RouteDialog";
import type { BatchQueryInput, BatchRow, CurrentOrderParcelsPage, DriverRouteStatus, MerchantOrderStatus, Page, ParcelBatchStatus, ParcelRow, ParcelStatus } from "./contracts";
import { createObservationGate, type ObservationState } from "./monitoringState";

const batchStatuses: ParcelBatchStatus[] = ["created", "proposed", "assigned", "picked_up", "in_transit", "delivered", "cancelled", "failed", "expired"];
const orderStatuses: MerchantOrderStatus[] = ["draft", "submitted", "batched", "matched", "assigned", "in_transit", "delivered", "completed", "cancelled", "failed", "expired"];
const routeStatuses: DriverRouteStatus[] = ["inactive", "active", "assigned", "on_trip", "completed"];
const parcelStatuses: ParcelStatus[] = ["pending", "batched", "assigned", "picked_up", "in_transit", "delivered", "cancelled", "failed", "expired"];

function errorStatus(error: unknown) { return (error as ApiError | undefined)?.status; }
function isTerminal(error: unknown) { return errorStatus(error) === 401 || errorStatus(error) === 403; }
export function utcInput(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function LegacyBatches({ api, token }: { api: ApiClient; token: string }) {
  const { direction, t, status: localizedStatus, dateTime, number } = useLocale();
  const listGate = useRef(createObservationGate());
  const detailGate = useRef(createObservationGate());
  const membersGate = useRef(createObservationGate());
  const [list, setList] = useState<ObservationState<Page<BatchRow>["data"]>>({ last: null, loading: true, error: null });
  const [detail, setDetail] = useState<ObservationState<BatchRow>>({ last: null, loading: false, error: null });
  const [members, setMembers] = useState<ObservationState<CurrentOrderParcelsPage["data"]>>({ last: null, loading: false, error: null });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ParcelBatchStatus | "">("");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [fromDraft, setFromDraft] = useState("");
  const [untilDraft, setUntilDraft] = useState("");
  const [explicitRange, setExplicitRange] = useState<{ from: string; until: string } | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const activeQuery = useRef<BatchQueryInput>({ page: 1, limit: 25 });
  const activeQueryIdentity = useRef(JSON.stringify(activeQuery.current));
  const memberIdentity = useRef<string | null>(null);
  const previousToken = useRef<string | null>(null);

  function queryFor(page: number, echoRange = false, overrides: Partial<{ status: ParcelBatchStatus | ""; search: string; range: typeof explicitRange }> = {}): BatchQueryInput {
    const nextStatus = overrides.status ?? statusFilter;
    const nextSearch = overrides.search ?? search;
    const nextRange = overrides.range === undefined ? explicitRange : overrides.range;
    const query: BatchQueryInput = { page, limit: 25 };
    if (nextStatus) query.status = nextStatus;
    if (nextSearch.trim()) query.search = nextSearch.trim();
    const range = nextRange ?? (echoRange ? list.last?.data.range : null);
    if (range) Object.assign(query, range);
    return query;
  }

  function messageFor(error: unknown) {
    if (errorStatus(error) === 400 && error instanceof Error && error.message === "validation_error") return t("monitoringRangeValidation");
    return error instanceof Error ? error.message : t("monitoringLoadFailed");
  }

  function clearTerminal(error: unknown) {
    listGate.current.invalidate();
    detailGate.current.invalidate();
    membersGate.current.invalidate();
    setSelectedId(null);
    setSelectedOrderId(null);
    setDetail({ last: null, loading: false, error: null });
    setMembers({ last: null, loading: false, error: null });
    setList({ last: null, loading: false, error: messageFor(error) });
  }

  function load(query: BatchQueryInput, retainSameQuery = false) {
    const generation = listGate.current.begin();
    const identity = JSON.stringify(query);
    const retain = retainSameQuery && identity === activeQueryIdentity.current;
    activeQuery.current = query;
    activeQueryIdentity.current = identity;
    setList((previous) => ({ last: retain ? previous.last : null, loading: true, error: null }));
    void api.monitoringBatches(token, query).then((response) => {
      if (listGate.current.isCurrent(generation)) setList({ last: response, loading: false, error: null });
    }).catch((error: unknown) => {
      if (!listGate.current.isCurrent(generation)) return;
      if (isTerminal(error)) { clearTerminal(error); return; }
      setList((previous) => ({ last: retain ? previous.last : null, loading: false, error: messageFor(error) }));
    });
  }

  function closeDetail() {
    detailGate.current.invalidate();
    membersGate.current.invalidate();
    memberIdentity.current = null;
    setSelectedId(null);
    setSelectedOrderId(null);
    setDetail({ last: null, loading: false, error: null });
    setMembers({ last: null, loading: false, error: null });
  }

  function loadDetail(id: string, retainSameParent = true) {
    const generation = detailGate.current.begin();
    setDetail((previous) => ({ last: retainSameParent && previous.last?.data.id === id ? previous.last : null, loading: true, error: null }));
    void api.monitoringBatch(token, id).then((response) => {
      if (detailGate.current.isCurrent(generation)) setDetail({ last: response, loading: false, error: null });
    }).catch((error: unknown) => {
      if (!detailGate.current.isCurrent(generation)) return;
      if (isTerminal(error)) { clearTerminal(error); return; }
      if (errorStatus(error) === 404) { closeDetail(); return; }
      setDetail((previous) => ({ last: retainSameParent && previous.last?.data.id === id ? previous.last : null, loading: false, error: messageFor(error) }));
    });
  }

  function loadMembers(id: string, orderId: string, page: number, retainSamePage = false) {
    const generation = membersGate.current.begin();
    const identity = `${id}:${page}`;
    const retain = retainSamePage && identity === memberIdentity.current;
    memberIdentity.current = identity;
    setMembers((previous) => ({ last: retain ? previous.last : null, loading: true, error: null }));
    void api.monitoringParcels(token, id, { page, limit: 25 }).then((response) => {
      if (!membersGate.current.isCurrent(generation)) return;
      if (response.data.contents_semantics !== "current_eligible_order_contents" || response.data.merchant_order_id !== orderId) {
        setMembers((previous) => ({ last: retain ? previous.last : null, loading: false, error: t("monitoringParcelContentsInvalid") }));
        return;
      }
      setMembers({ last: response, loading: false, error: null });
    }).catch((error: unknown) => {
      if (!membersGate.current.isCurrent(generation)) return;
      if (isTerminal(error)) { clearTerminal(error); return; }
      if (errorStatus(error) === 404) {
        setMembers({ last: null, loading: false, error: t("monitoringParcelsUnavailable") });
        return;
      }
      setMembers((previous) => ({ last: retain ? previous.last : null, loading: false, error: messageFor(error) }));
    });
  }

  function openDetail(row: BatchRow) {
    detailGate.current.invalidate();
    membersGate.current.invalidate();
    memberIdentity.current = null;
    setSelectedId(row.id);
    setSelectedOrderId(row.merchant_order.id);
    setDetail({ last: null, loading: true, error: null });
    setMembers({ last: null, loading: true, error: null });
    loadDetail(row.id, false);
    loadMembers(row.id, row.merchant_order.id, 1);
  }

  useEffect(() => {
    listGate.current.invalidate();
    detailGate.current.invalidate();
    membersGate.current.invalidate();
    memberIdentity.current = null;
    setSelectedId(null);
    setSelectedOrderId(null);
    setDetail({ last: null, loading: false, error: null });
    setMembers({ last: null, loading: false, error: null });
    if (previousToken.current !== null && previousToken.current === token) {
      load(activeQuery.current, true);
    } else {
      setStatusFilter(""); setSearchDraft(""); setSearch("");
      setFromDraft(""); setUntilDraft(""); setExplicitRange(null); setValidation(null);
      activeQuery.current = { page: 1, limit: 25 };
      activeQueryIdentity.current = JSON.stringify(activeQuery.current);
      setList({ last: null, loading: true, error: null });
      load(activeQuery.current);
    }
    previousToken.current = token;
    return () => { listGate.current.invalidate(); detailGate.current.invalidate(); membersGate.current.invalidate(); };
  }, [api, token]);

  function changeStatus(next: ParcelBatchStatus | "") {
    setStatusFilter(next);
    load(queryFor(1, false, { status: next }));
  }
  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const next = searchDraft.trim();
    setSearch(next);
    load(queryFor(1, false, { search: next }));
  }
  function applyRange() {
    if (!fromDraft || !untilDraft) { setValidation(t("monitoringSelectBothDates")); return; }
    const from = utcInput(fromDraft);
    const until = utcInput(untilDraft);
    if (!from || !until) { setValidation(t("monitoringRangeValidation")); return; }
    const range = { from, until };
    setValidation(null);
    setExplicitRange(range);
    load(queryFor(1, false, { range }));
  }
  function resetRange() {
    setFromDraft(""); setUntilDraft(""); setExplicitRange(null); setValidation(null);
    load(queryFor(1, false, { range: null }));
  }

  const data = list.last?.data;
  const selected = detail.last?.data;
  const memberData = members.last?.data;
  const currentPage = data?.page ?? 1;
  const recognized = (value: string, allowed: readonly string[]) => allowed.includes(value);
  const statusBadge = (value: string, allowed: readonly string[]) => {
    const known = recognized(value, allowed);
    return <StatusBadge status={known ? value : undefined}>{known ? localizedStatus(value) : t("monitoringUnknown")}</StatusBadge>;
  };
  const statusLabel = (status: ParcelStatus): string => parcelStatuses.includes(status) ? localizedStatus(status) : t("monitoringUnknown");
  const columns: Column<BatchRow>[] = [
    { key: "id", header: t("monitoringBatchId"), cell: (row) => <span className="technical-value">{row.id}</span> },
    { key: "created", header: t("monitoringCreated"), cell: (row) => dateTime(row.created_at) },
    { key: "status", header: t("monitoringBatchStatus"), cell: (row) => statusBadge(row.status, batchStatuses) },
    { key: "order", header: t("monitoringOrderId"), cell: (row) => <span className="technical-value">{row.merchant_order.id}</span> },
    { key: "parcels", header: t("monitoringCurrentParcelCount"), cell: (row) => number(row.merchant_order.parcel_count) },
    { key: "route", header: t("monitoringSelectedRoute"), cell: (row) => row.selected_driver_route ? <span className="technical-value">{row.selected_driver_route.id}</span> : t("monitoringNoSelectedRoute") },
    { key: "action", header: t("monitoringDetails"), align: "end", cell: (row) => <Button data-testid={`open-batch-${row.id}`} variant="ghost" size="sm" onClick={() => openDetail(row)}>{t("monitoringView")}</Button> }
  ];

  return (
    <section className="legacy-batches" dir={direction}>
      <div className="monitoring-toolbar">
        <div><h2>{t("monitoringBatchesTitle")}</h2>{list.last && <><p className="monitoring-observed">{t("monitoringObserved", { time: "" })}<time dateTime={list.last.observed_at}>{dateTime(list.last.observed_at)}</time></p>{data?.range && <p data-testid="batches-range" className="monitoring-range technical-value">{dateTime(data.range.from)} – {dateTime(data.range.until)}</p>}</>}</div>
        <Button data-testid="batches-refresh" variant="outline" icon="refresh" onClick={() => load(queryFor(1, false), true)}>{list.loading ? t("monitoringRefreshing") : t("monitoringRefresh")}</Button>
      </div>
      <Card>
        <form data-testid="batch-filters" className="monitoring-filters monitoring-batch-filters" onSubmit={submitSearch}>
          <label className="field">{t("monitoringExactId")}<input name="search" value={searchDraft} maxLength={191} onChange={(event) => setSearchDraft(event.target.value)} /></label>
          <label className="field">{t("monitoringBatchStatus")}<select name="status" value={statusFilter} onChange={(event) => changeStatus(event.target.value as ParcelBatchStatus | "")}><option value="">{t("all")}</option>{batchStatuses.map((value) => <option key={value} value={value}>{localizedStatus(value)}</option>)}</select></label>
          <label className="field">{t("monitoringFrom")}<input name="from" type="datetime-local" value={fromDraft} onChange={(event) => setFromDraft(event.target.value)} /></label>
          <label className="field">{t("monitoringUntil")}<input name="until" type="datetime-local" value={untilDraft} onChange={(event) => setUntilDraft(event.target.value)} /></label>
          <div className="button-row monitoring-filter-actions"><Button type="submit" variant="primary">{t("monitoringSearch")}</Button><Button data-testid="batches-apply-range" variant="outline" onClick={applyRange}>{t("monitoringApplyRange")}</Button><Button variant="ghost" onClick={resetRange}>{t("monitoringServerDefaultRange")}</Button></div>
        </form>
        {validation && <Notice kind="error">{validation}</Notice>}
        <p className="muted">{t("monitoringExactSearchHelp")}</p>
      </Card>
      {list.error && list.last && <Notice kind="error">{t("monitoringStaleData")}: {list.error}</Notice>}
      {!data && list.loading && <div className="monitoring-state" role="status">{t("monitoringLoading")}</div>}
      {!data && !list.loading && <EmptyState title={t("monitoringBatchesUnavailable")} description={list.error ?? t("monitoringLoadFailed")} />}
      {data && <Card padded={false} className="monitoring-table-card"><DataTable columns={columns} rows={data.items} rowKey={(row) => row.id} empty={<EmptyState compact title={t("monitoringNoBatches")} description={t("monitoringNoBatchesDescription")} />} /></Card>}
      {data && <div className="monitoring-pagination"><span>{t("pageOf", { page: number(currentPage), pages: number(Math.max(1, Math.ceil(data.total / data.limit))) })}</span><div className="button-row"><Button variant="outline" disabled={currentPage <= 1 || list.loading} onClick={() => load(queryFor(currentPage - 1, true))}>{t("previousPage")}</Button><Button data-testid="batches-next" variant="outline" disabled={!data.has_more || currentPage >= 1000 || list.loading} onClick={() => load(queryFor(currentPage + 1, true))}>{t("nextPage")}</Button></div>{currentPage >= 1000 && data.has_more && <p className="monitoring-page-cap">{t("monitoringPageCap")}</p>}</div>}
      {data && <p className="muted">{t("monitoringOffsetObservationNote")}</p>}

      <RouteDialog open={Boolean(selectedId)} title={t("monitoringBatchDetail")} description={selectedId ?? undefined} dir={direction} onClose={closeDetail}>
        {detail.loading && !selected && <div role="status">{t("monitoringLoading")}</div>}
        {detail.error && <Notice kind="error">{selected ? `${t("monitoringStaleData")}: ${detail.error}` : detail.error}</Notice>}
        {selected && <div className="monitoring-detail">
          <div><span>{t("monitoringBatchId")}</span><strong className="technical-value">{selected.id}</strong></div>
          <div><span>{t("monitoringBatchStatus")}</span>{statusBadge(selected.status, batchStatuses)}</div>
          <div><span>{t("monitoringCreated")}</span><strong>{dateTime(selected.created_at)}</strong></div>
          <section><h3>{t("monitoringMerchantOrder")}</h3><p className="technical-value">{selected.merchant_order.id}</p><p>{t("monitoringCurrentStatus")}: {statusBadge(selected.merchant_order.status, orderStatuses)}</p><p>{t("monitoringCurrentParcelCount")}: {number(selected.merchant_order.parcel_count)}</p></section>
          <div><span>{t("monitoringSelectedRoute")}</span>{selected.selected_driver_route ? <><strong className="technical-value">{selected.selected_driver_route.id}</strong>{statusBadge(selected.selected_driver_route.status, routeStatuses)}</> : <strong>{t("monitoringNoSelectedRoute")}</strong>}</div>
          <p data-testid="batch-detail-observed" className="monitoring-observed">{t("monitoringObserved", { time: "" })}<time dateTime={detail.last?.observed_at}>{dateTime(detail.last?.observed_at)}</time></p>
          <Button data-testid="batch-detail-refresh" variant="outline" icon="refresh" onClick={() => loadDetail(selected.id)}>{t("monitoringRefreshDetail")}</Button>
        </div>}

        <section className="monitoring-members" aria-labelledby="current-order-contents-title">
          <div className="monitoring-toolbar">
            <div><h3 id="current-order-contents-title">{t("monitoringCurrentEligibleContents")}</h3><p className="muted">{t("monitoringCurrentContentsDisclaimer")}</p>{members.last && <p data-testid="batch-members-observed" className="monitoring-observed">{t("monitoringObserved", { time: "" })}<time dateTime={members.last.observed_at}>{dateTime(members.last.observed_at)}</time></p>}</div>
            {selectedId && selectedOrderId && <Button data-testid="members-refresh" variant="outline" icon="refresh" onClick={() => loadMembers(selectedId, selectedOrderId, memberData?.page ?? 1, true)}>{members.loading ? t("monitoringRefreshing") : t("monitoringRefresh")}</Button>}
          </div>
          {members.error && members.last && <Notice kind="error">{t("monitoringStaleData")}: {members.error}</Notice>}
          {!memberData && members.loading && <div role="status">{t("monitoringLoading")}</div>}
          {!memberData && !members.loading && members.error && <Notice kind="error">{members.error}</Notice>}
          {memberData && memberData.items.length > 0 && <Card padded={false} className="monitoring-table-card"><div className="table-scroll"><table className="data-table"><thead><tr><th scope="col">{t("monitoringParcelId")}</th><th scope="col">{t("monitoringCurrentStatus")}</th></tr></thead><tbody>{memberData.items.map((row: ParcelRow) => <tr key={row.id}><td className="technical-value">{row.id}</td><td>{statusLabel(row.status)}</td></tr>)}</tbody></table></div></Card>}
          {memberData && memberData.items.length === 0 && <EmptyState compact title={t("monitoringNoParcels")} description={t("monitoringNoParcelsDescription")} />}
          {memberData && <div className="monitoring-pagination"><span>{t("pageOf", { page: number(memberData.page), pages: number(Math.max(1, Math.ceil(memberData.total / memberData.limit))) })}</span><div className="button-row"><Button variant="outline" disabled={memberData.page <= 1 || members.loading} onClick={() => selectedId && selectedOrderId && loadMembers(selectedId, selectedOrderId, memberData.page - 1)}>{t("previousPage")}</Button><Button data-testid="members-next" variant="outline" disabled={!memberData.has_more || memberData.page >= 1000 || members.loading} onClick={() => selectedId && selectedOrderId && loadMembers(selectedId, selectedOrderId, memberData.page + 1)}>{t("nextPage")}</Button></div>{memberData.page >= 1000 && memberData.has_more && <p className="monitoring-page-cap">{t("monitoringPageCap")}</p>}</div>}
        </section>
      </RouteDialog>
    </section>
  );
}
