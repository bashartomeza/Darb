import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AdminForwardTripStatus,
  AdminTripDetail,
  AdminTripKind,
  AdminTripListItem,
  AdminTripPage,
  ApiClient,
  ApiError,
  TripStatus,
} from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import {
  AlertItem,
  BentoGrid,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  Skeleton,
  StatusBadge,
  TechnicalValue,
  type Column,
} from "../../ui";

type Props = { api: ApiClient; token: string; search: string; canAct?: boolean };
export type TripStatusIntent = {
  trip: AdminTripListItem;
  expectedStatus: TripStatus;
  nextStatus: AdminForwardTripStatus;
};

export function createTripStatusIntent(trip: AdminTripListItem): TripStatusIntent | null {
  if (trip.kind !== "legacy" || !trip.supported_admin_transition) return null;
  return { trip, expectedStatus: trip.status, nextStatus: trip.supported_admin_transition };
}

export function createLatestRequestGate() {
  let latest = 0;
  return {
    begin: () => ++latest,
    isCurrent: (request: number) => request === latest,
    invalidate: () => { latest += 1; },
  };
}

export async function executeTripStatusMutation(options: {
  api: ApiClient;
  token: string;
  intent: TripStatusIntent;
  reloadTrips: () => Promise<void>;
  reloadDetail: () => Promise<void>;
}): Promise<{ kind: "success" } | { kind: "conflict" | "error"; error: ApiError }> {
  const reload = () => Promise.all([options.reloadTrips(), options.reloadDetail()]);
  try {
    await options.api.advanceAdminTrip(
      options.token,
      options.intent.trip.id,
      options.intent.nextStatus,
      options.intent.expectedStatus,
    );
    await reload();
    return { kind: "success" };
  } catch (caught) {
    const error = caught as ApiError;
    if (error.status === 409) {
      await reload();
      return { kind: "conflict", error };
    }
    return { kind: "error", error };
  }
}

export function TripsManagement({ api, token, search, canAct = true }: Props) {
  const { t } = useLocale();
  const [statusFilter, setStatusFilter] = useState<TripStatus | "all">("all");
  const [kindFilter, setKindFilter] = useState<AdminTripKind | "all">("all");
  const [page, setPage] = useState(1);
  const limit = 25;
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [data, setData] = useState<AdminTripPage>({ trips: [], page: 1, limit, total: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminTripDetail | null>(null);
  const [detailPhase, setDetailPhase] = useState<"loading" | "ready" | "error">("ready");
  const [pending, setPending] = useState<TripStatusIntent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = useMemo(() => search.trim().slice(0, 100), [search]);
  const listRequests = useRef(createLatestRequestGate());
  const detailRequests = useRef(createLatestRequestGate());
  const criteriaKey = `${statusFilter}\u0000${kindFilter}\u0000${query}`;
  const previousCriteria = useRef(criteriaKey);

  async function loadTrips() {
    if (!token) return;
    const request = listRequests.current.begin();
    setPhase("loading");
    try {
      const result = await api.adminTrips(token, statusFilter, kindFilter, page, limit, query);
      if (!listRequests.current.isCurrent(request)) return;
      setData(result);
      setPhase("ready");
    } catch {
      if (!listRequests.current.isCurrent(request)) return;
      setPhase("error");
    }
  }

  async function loadDetail(id: string) {
    const request = detailRequests.current.begin();
    setSelectedId(id);
    setDetailPhase("loading");
    try {
      const result = (await api.adminTrip(token, id)).trip;
      if (!detailRequests.current.isCurrent(request)) return;
      setDetail(result);
      setDetailPhase("ready");
    } catch {
      if (!detailRequests.current.isCurrent(request)) return;
      setDetail(null);
      setDetailPhase("error");
    }
  }

  useEffect(() => {
    if (previousCriteria.current !== criteriaKey) {
      previousCriteria.current = criteriaKey;
      if (page !== 1) {
        setPage(1);
        return;
      }
    }
    void loadTrips();
  }, [token, criteriaKey, page]);

  async function submit() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    const outcome = await executeTripStatusMutation({
      api,
      token,
      intent: pending,
      reloadTrips: loadTrips,
      reloadDetail: () => loadDetail(pending.trip.id),
    });
    if (outcome.kind === "success") setPending(null);
    else if (outcome.kind === "conflict") setError(t("tripStatusConflictReloaded"));
    else setError(t("resourceLoadErrorDescription"));
    setBusy(false);
  }

  const pages = Math.max(1, Math.ceil(data.total / data.limit));
  return <TripsManagementView
    phase={phase} data={data} page={page} pages={pages} query={query} statusFilter={statusFilter} kindFilter={kindFilter}
    selectedId={selectedId} detail={detail} detailPhase={detailPhase} pending={pending} busy={busy} error={error} canAct={canAct}
    onStatusFilterChange={setStatusFilter} onKindFilterChange={setKindFilter} onPageChange={setPage}
    onLoadDetail={(id) => void loadDetail(id)} onCloseDetail={() => { detailRequests.current.invalidate(); setSelectedId(null); setDetail(null); setError(null); }}
    onRefresh={() => void loadTrips()} onBeginStatus={(intent) => setPending(intent)} onSubmitStatus={() => void submit()}
    onCancelStatus={() => { setPending(null); setError(null); }}
  />;
}

export type TripsManagementViewProps = {
  phase: "loading" | "ready" | "error";
  data: AdminTripPage;
  page: number;
  pages: number;
  query: string;
  statusFilter: TripStatus | "all";
  kindFilter: AdminTripKind | "all";
  selectedId: string | null;
  detail: AdminTripDetail | null;
  detailPhase: "loading" | "ready" | "error";
  pending: TripStatusIntent | null;
  busy: boolean;
  error: string | null;
  canAct: boolean;
  onStatusFilterChange: (value: TripStatus | "all") => void;
  onKindFilterChange: (value: AdminTripKind | "all") => void;
  onPageChange: (value: number) => void;
  onLoadDetail: (id: string) => void;
  onCloseDetail: () => void;
  onRefresh: () => void;
  onBeginStatus: (intent: TripStatusIntent) => void;
  onSubmitStatus: () => void;
  onCancelStatus: () => void;
};

function DeliveryConfirmationBadge({ confirmation }: { confirmation: AdminTripListItem["delivery_confirmation"] }) {
  const { t, number } = useLocale();
  if (!confirmation || !confirmation.required) return <span className="muted">{t("noData")}</span>;
  if (confirmation.flagged) {
    const key = confirmation.methods.includes("receiver_unavailable") ? "deliveryMethod_receiver_unavailable" : "deliveryMethod_admin_override";
    return <StatusBadge tone="warning">{t(key)}</StatusBadge>;
  }
  if (confirmation.confirmed_orders < confirmation.total_orders) {
    return <StatusBadge tone="neutral">{t("deliveryPending", { done: number(confirmation.confirmed_orders), total: number(confirmation.total_orders) })}</StatusBadge>;
  }
  return <StatusBadge tone="success">{t("deliveryMethod_receiver_code")}</StatusBadge>;
}

const kindKey = (kind: AdminTripKind) => `tripKind_${kind}` as const;

export function TripsManagementView(props: TripsManagementViewProps) {
  const { t, status, dateTime, number, direction } = useLocale();
  const { phase, data, page, pages, query, statusFilter, kindFilter, selectedId, detail, detailPhase, pending, busy, error, canAct } = props;
  const columns: Column<AdminTripListItem>[] = [
    { key: "trip", header: t("columnTrip"), cell: (trip) => <div><TechnicalValue>{trip.id}</TechnicalValue>{trip.demo_context && <StatusBadge tone="warning">{t("demo")}</StatusBadge>}<p className="cell-stack__sub">{dateTime(trip.created_at)}</p></div> },
    { key: "kind", header: t("tripSource"), cell: (trip) => <StatusBadge tone={trip.kind === "legacy" ? "neutral" : "info"}>{t(kindKey(trip.kind))}</StatusBadge> },
    { key: "status", header: t("columnStatus"), cell: (trip) => <StatusBadge status={trip.status}>{status(trip.status)}</StatusBadge> },
    { key: "route", header: t("columnRoute"), cell: (trip) => <div><p className="cell-stack__title">{trip.driver_route.origin_label} → {trip.driver_route.destination_label}</p><p className="cell-stack__sub">{trip.driver_route.driver.user.name}</p></div> },
    { key: "participants", header: t("tripParticipants"), cell: (trip) => <span>{trip.passenger_request?.passenger.name ?? trip.merchant_order?.merchant.name ?? (trip.canonical_manifest ? number(trip.canonical_manifest.member_count) : t("noData"))}</span> },
    { key: "delivery", header: t("deliveryConfirmation"), cell: (trip) => <DeliveryConfirmationBadge confirmation={trip.delivery_confirmation} /> },
    { key: "location", header: t("storedLocation"), cell: (trip) => trip.has_stored_location ? t("available") : t("notAvailable") },
    { key: "actions", header: t("columnActions"), align: "end", cell: (trip) => <Button size="sm" variant={selectedId === trip.id ? "secondary" : "ghost"} icon="search" onClick={() => props.onLoadDetail(trip.id)}>{t("reviewDetails")}</Button> },
  ];

  const limitation = detail?.status === "created"
    ? t("tripCreatedNoAction")
    : detail?.kind === "canonical"
      ? t("tripCanonicalReadOnly")
      : detail?.kind === "shared"
        ? t("tripSharedReadOnly")
        : !detail?.supported_admin_transition
          ? t("tripLifecycleComplete")
          : null;
  const intent = detail ? createTripStatusIntent(detail) : null;

  return <div className="trips-management" dir={direction}>
    <BentoGrid>
      <Card span={12} padded={false}>
        <CardHeader title={t("tripDirectory")} badge={<StatusBadge tone="info">{number(data.total)}</StatusBadge>} action={<div className="card__actions trips-management__filters">
          <label className="field field--inline">{t("columnStatus")}<select value={statusFilter} onChange={(event) => props.onStatusFilterChange(event.target.value as TripStatus | "all")}><option value="all">{t("all")}</option>{(["created", "accepted", "pickup_started", "picked_up", "in_transit", "delivered", "completed", "cancelled", "failed"] as TripStatus[]).map((value) => <option key={value} value={value}>{status(value)}</option>)}</select></label>
          <label className="field field--inline">{t("tripSource")}<select value={kindFilter} onChange={(event) => props.onKindFilterChange(event.target.value as AdminTripKind | "all")}><option value="all">{t("all")}</option><option value="legacy">{t("tripKind_legacy")}</option><option value="canonical">{t("tripKind_canonical")}</option><option value="shared">{t("tripKind_shared")}</option></select></label>
          <Button size="sm" variant="ghost" icon="refresh" onClick={props.onRefresh}>{t("refreshTrips")}</Button>
        </div>} />
        {phase === "loading" && <div role="status" className="overview-resource-state"><Skeleton lines={4} /></div>}
        {phase === "error" && <EmptyState compact icon="report" title={t("resourceLoadError")} description={t("resourceLoadErrorDescription")} />}
        {phase === "ready" && <><DataTable columns={columns} rows={data.trips} rowKey={(trip) => trip.id} empty={<EmptyState compact icon="local_shipping" title={query ? t("searchNoResults") : t("tripDirectoryEmpty")} />} />{pages > 1 && <div className="card__actions trips-management__pagination"><Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => props.onPageChange(page - 1)}>{t("previousPage")}</Button><span className="muted">{t("pageOf", { page: number(page), pages: number(pages) })}</span><Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => props.onPageChange(page + 1)}>{t("nextPage")}</Button></div>}</>}
      </Card>

      {selectedId && detailPhase === "loading" && <Card span={12}><Skeleton lines={6} /></Card>}
      {selectedId && detailPhase === "error" && <Card span={12}><EmptyState compact icon="report" title={t("tripDetailLoadFailed")} description={t("resourceLoadErrorDescription")} /></Card>}
      {detail && <Card span={12} className="trips-management__detail">
        <CardHeader title={t("tripDetail")} badge={<StatusBadge status={detail.status}>{status(detail.status)}</StatusBadge>} action={<Button size="sm" variant="ghost" onClick={props.onCloseDetail}>{t("closeReview")}</Button>} />
        <div className="trip-detail-grid">
          <div className="stack stack--tight"><p><strong>{t("columnTrip")}</strong> <TechnicalValue>{detail.id}</TechnicalValue> {detail.demo_context && <StatusBadge tone="warning">{t("demo")}</StatusBadge>}</p><p><strong>{t("tripSource")}</strong> {t(kindKey(detail.kind))}</p><p><strong>{t("columnDriver")}</strong> {detail.driver_route.driver.user.name} · <TechnicalValue>{detail.driver_route.driver.user.phone}</TechnicalValue></p><p>{detail.driver_route.driver.vehicle_type} · {number(detail.driver_route.driver.seats_total)} · {number(detail.driver_route.driver.parcel_capacity)}</p><p><strong>{t("columnRoute")}</strong> {detail.driver_route.origin_label} → {detail.driver_route.destination_label}</p>{detail.route_version && <p>{detail.route_version.name_ar} / {detail.route_version.name_en} · v{number(detail.route_version.version_number)}</p>}<p><strong>{t("createdAt")}</strong> {dateTime(detail.created_at)}</p></div>
          <div className="stack stack--tight"><p><strong>{t("tripParticipants")}</strong></p>{detail.passenger_request && <p>{detail.passenger_request.passenger.name} · {number(detail.passenger_request.passenger_count)}</p>}{detail.merchant_order && <p>{detail.merchant_order.merchant.name} · {number(detail.merchant_order._count.parcels)}</p>}{detail.canonical_manifest && <><p>{t("sharedManifestMembers", { count: number(detail.canonical_manifest.member_count) })}</p>{detail.canonical_manifest.members?.map((member) => <p key={member.id}>{member.passenger_request?.passenger.name ?? member.merchant_order?.merchant.name ?? member.demand_type}</p>)}</>}{!detail.passenger_request && !detail.merchant_order && !detail.canonical_manifest && <p>{t("noData")}</p>}</div>
          {detail.delivery_confirmation?.required && <div className="stack stack--tight"><p><strong>{t("deliveryConfirmation")}</strong></p><DeliveryConfirmationBadge confirmation={detail.delivery_confirmation} />{detail.delivery_confirmation.reasons.map((reason, index) => <p key={index}>{t("deliveryReasonLabel")}: {reason}</p>)}</div>}
          <div className="stack stack--tight"><p><strong>{t("latestStoredLocation")}</strong></p>{detail.latest_stored_location ? <><TechnicalValue>{`${detail.latest_stored_location.lat}, ${detail.latest_stored_location.lng}`}</TechnicalValue><p>{t("storedLocationSource")}: <TechnicalValue>{detail.latest_stored_location.source}</TechnicalValue></p><p>{dateTime(detail.latest_stored_location.recorded_at)}</p></> : <p>{t("storedLocationUnavailable")}</p>}</div>
        </div>
        {limitation && <AlertItem tone="info" title={t("tripLifecyclePolicy")} description={limitation} />}
        <AlertItem tone="info" title={t("tripCancellationDisabled")} description={t("tripCancellationExplanation")} />
        {intent && canAct && <Button variant="action" icon="check" onClick={() => props.onBeginStatus(intent)}>{t("tripMoveTo", { status: status(intent.nextStatus) })}</Button>}
      </Card>}

      {pending && <Card span={12}><CardHeader title={t("confirmTripTransition")} /><p>{t("tripTransitionConfirm", { id: pending.trip.id, status: status(pending.nextStatus) })}</p>{error && <p role="alert" className="overview-resource-note overview-resource-note--error">{error}</p>}<div className="card__actions"><Button variant="action" disabled={busy} onClick={props.onSubmitStatus}>{busy ? t("saving") : t("confirm")}</Button><Button variant="ghost" disabled={busy} onClick={props.onCancelStatus}>{t("cancel")}</Button></div></Card>}
    </BentoGrid>
  </div>;
}
