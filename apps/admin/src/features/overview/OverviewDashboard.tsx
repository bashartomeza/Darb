import { useMemo, type ReactNode } from "react";
import type {
  DashboardResponse,
  DriverProfile,
  DriverRoute,
  MerchantOrder,
  PassengerRequest,
  Trip
} from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import type { TranslationKey } from "../../i18n/translations";
import {
  AlertItem,
  Avatar,
  BarChart,
  BentoGrid,
  Button,
  Card,
  CardHeader,
  Column,
  DataTable,
  EmptyState,
  IconButton,
  KpiCard,
  MeterBar,
  RouteChip,
  Skeleton,
  StatusBadge,
  TechnicalValue
} from "../../ui";
import type { IconName } from "../../ui/Icon";
import type { Tone } from "../../ui/StatusBadge";
import { matchesSearch } from "../search";
import { activeTrips as selectActiveTrips, isActiveTripStatus } from "./overviewMetrics";
import type { OverviewResourceState, OverviewResourceStates } from "./overviewState";

const AWAITING_MATCH_STATUSES = new Set(["draft", "pending"]);
const UNBATCHED_ORDER_STATUSES = new Set(["draft", "submitted"]);
const TRIP_FLOW = ["created", "accepted", "pickup_started", "picked_up", "in_transit", "delivered", "completed", "cancelled"];

export type OverviewData = {
  dashboard: DashboardResponse | null;
  drivers: DriverProfile[];
  routes: DriverRoute[];
  requests: PassengerRequest[];
  orders: MerchantOrder[];
  trips: Trip[];
  resources: OverviewResourceStates;
};

type OperationRow = { trip: Trip; route: DriverRoute | undefined };

/** Alerts are derived only from statuses and flags present in current API contracts. */
export function deriveAlerts(data: Pick<OverviewData, "requests" | "routes" | "orders">) {
  const unmatchedRequests = data.requests.filter((request) => AWAITING_MATCH_STATUSES.has(request.status)).length;
  const unverifiedDriverRoutes = data.routes.filter(
    (route) => route.status === "active" && route.driver && route.driver.verified === false
  ).length;
  const unbatchedOrders = data.orders.filter((order) => UNBATCHED_ORDER_STATUSES.has(order.status)).length;
  return { unmatchedRequests, unverifiedDriverRoutes, unbatchedOrders };
}

function ResourceBoundary({
  state,
  onRetry,
  children,
  lines = 3
}: {
  state: OverviewResourceState;
  onRetry: () => void;
  children: ReactNode;
  lines?: number;
}) {
  const { t } = useLocale();
  if (!state.hasData && (state.phase === "idle" || state.phase === "loading")) {
    return <div className="overview-resource-state" role="status" aria-label={t("metricLoading")}><Skeleton lines={lines} /></div>;
  }
  if (!state.hasData && state.phase === "error") {
    return (
      <EmptyState
        compact
        icon="report"
        title={t("resourceLoadError")}
        description={t("resourceLoadErrorDescription")}
        action={<Button size="sm" variant="secondary" icon="refresh" onClick={onRetry}>{t("retry")}</Button>}
      />
    );
  }
  return (
    <>
      {state.phase === "loading" && <p className="overview-resource-note" role="status">{t("metricRefreshing")}</p>}
      {state.phase === "error" && <p className="overview-resource-note overview-resource-note--error" role="alert">{t("metricRefreshError")}</p>}
      {children}
    </>
  );
}

function MetricCard({
  metric,
  icon,
  tone,
  label,
  value,
  emptyLabel,
  state,
  unavailable = false,
  unavailableLabel = "incidentsNotConnected"
}: {
  metric: string;
  icon: IconName;
  tone: Tone;
  label: string;
  value?: number;
  emptyLabel: TranslationKey;
  state?: OverviewResourceState;
  unavailable?: boolean;
  unavailableLabel?: TranslationKey;
}) {
  const { t, number } = useLocale();
  const initialLoading = !unavailable && state && !state.hasData && (state.phase === "idle" || state.phase === "loading");
  let statusText: string | undefined;
  let statusTone: Tone = "neutral";

  if (unavailable) statusText = t(unavailableLabel);
  else if (state?.phase === "loading" && state.hasData) statusText = t("metricRefreshing");
  else if (state?.phase === "error") {
    statusText = state.hasData ? t("metricRefreshError") : t("metricLoadError");
    statusTone = "danger";
  } else if (state?.phase === "ready" && value === 0) statusText = t(emptyLabel);

  return (
    <KpiCard
      metricId={metric}
      icon={icon}
      tone={tone}
      label={label}
      value={unavailable || (!state?.hasData && state?.phase === "error") ? "—" : number(value ?? 0)}
      loading={Boolean(initialLoading)}
      loadingLabel={t("metricLoading")}
      status={statusText ? { text: statusText, tone: statusTone } : undefined}
    />
  );
}

function ResourceNote({ state }: { state: OverviewResourceState }) {
  const { t } = useLocale();
  if (state.phase === "error") {
    return <p className="overview-resource-note overview-resource-note--error" role="alert">{state.hasData ? t("metricRefreshError") : t("metricLoadError")}</p>;
  }
  if (state.phase === "loading") return <p className="overview-resource-note" role="status">{t("metricRefreshing")}</p>;
  return null;
}

export function OverviewDashboard({
  data,
  search,
  busy,
  onRefresh
}: {
  data: OverviewData;
  search: string;
  busy: boolean;
  onRefresh: () => void;
}) {
  const { t, status, number } = useLocale();
  const alerts = useMemo(() => deriveAlerts(data), [data.requests, data.routes, data.orders]);

  const activeRoutes = data.routes.filter((route) => route.status === "active");
  const activeTrips = selectActiveTrips(data.trips);

  const operations = useMemo<OperationRow[]>(() => {
    const byId = new Map(data.routes.map((route) => [route.id, route]));
    return data.trips
      .filter((trip) => isActiveTripStatus(trip.status))
      .map((trip) => ({ trip, route: byId.get(trip.driver_route_id) }))
      .filter(({ trip, route }) =>
        matchesSearch(
          [trip.id, trip.status, route?.origin_label, route?.destination_label, route?.driver?.user?.name, route?.driver?.user?.phone],
          search
        )
      );
  }, [data.routes, data.trips, search]);

  const tripsByStatus = useMemo(
    () =>
      TRIP_FLOW.map((flowStatus) => {
        const value = data.trips.filter((trip) => trip.status === flowStatus).length;
        return { id: flowStatus, value, title: `${status(flowStatus)}: ${value}` };
      }),
    [data.trips, status]
  );

  const seatCapacity = activeRoutes.reduce((total, route) => total + (route.seats_available ?? 0), 0);
  const parcelCapacity = activeRoutes.reduce((total, route) => total + (route.parcel_capacity_available ?? 0), 0);
  const totalCapacity = Math.max(1, seatCapacity + parcelCapacity);

  const columns: Column<OperationRow>[] = [
    {
      key: "driver",
      header: t("columnDriver"),
      cell: ({ route }) => (
        <div className="cell-stack">
          <Avatar name={route?.driver?.user?.name ?? "—"} />
          <div>
            <p className="cell-stack__title">{route?.driver?.user?.name ?? t("noData")}</p>
            <p className="cell-stack__sub technical">{route?.driver?.user?.phone ?? ""}</p>
          </div>
        </div>
      )
    },
    {
      key: "route",
      header: t("columnRoute"),
      cell: ({ route }) => route ? <RouteChip from={route.origin_label} to={route.destination_label} /> : <span className="muted">{t("noData")}</span>
    },
    {
      key: "status",
      header: t("columnStatus"),
      cell: ({ trip }) => <StatusBadge status={trip.status} icon={trip.status === "in_transit" ? "near_me" : undefined}>{status(trip.status)}</StatusBadge>
    },
    { key: "trip", header: t("columnTrip"), cell: ({ trip }) => <TechnicalValue>{trip.id}</TechnicalValue> },
    {
      key: "actions",
      header: t("columnActions"),
      align: "end",
      cell: ({ trip }) => <IconButton icon="more_vert" label={`${t("rowActionsLabel")} ${trip.id}`} disabled />
    }
  ];

  const alertStates = [data.resources.requests, data.resources.routes, data.resources.orders];
  const alertsHaveData = alertStates.some((state) => state.hasData);
  const alertsComplete = alertStates.every((state) => state.hasData);
  const alertsLoading = !alertsHaveData && alertStates.some((state) => state.phase === "idle" || state.phase === "loading");
  const alertsFailed = !alertsHaveData && alertStates.every((state) => state.phase === "error");
  const alertCount = alerts.unmatchedRequests + alerts.unverifiedDriverRoutes + alerts.unbatchedOrders;

  return (
    <>
      <section className="kpi-row" aria-label={t("overviewMetrics")}>
        <MetricCard metric="active-drivers" icon="directions_car" tone="info" label={t("activeDrivers")} value={data.dashboard?.counts.active_drivers} emptyLabel="noActiveDrivers" state={data.resources.dashboard} />
        <MetricCard metric="active-trips" icon="route" tone="neutral" label={t("activeTrips")} value={activeTrips.length} emptyLabel="noActiveTrips" state={data.resources.trips} />
        <MetricCard metric="pending-approvals" icon="verified" tone="warning" label={t("pendingApprovals")} value={data.dashboard?.counts.pending_driver_approvals} emptyLabel="noPendingApprovals" state={data.resources.dashboard} />
        <MetricCard metric="orders" icon="inventory_2" tone="success" label={t("ordersMetric")} value={data.dashboard?.counts.merchant_orders} emptyLabel="noOrders" state={data.resources.dashboard} />
        <MetricCard metric="requests" icon="person_pin_circle" tone="info" label={t("requestsMetric")} value={data.dashboard?.counts.passenger_requests} emptyLabel="noRequests" state={data.resources.dashboard} />
        <MetricCard metric="incidents" icon="report" tone="danger" label={t("incidentsMetric")} value={data.dashboard?.counts.open_incidents} emptyLabel="noOpenIncidents" state={data.resources.dashboard} />
      </section>

      <BentoGrid>
        <Card span={8} padded={false}>
          <CardHeader
            title={t("activeOperations")}
            action={<Button variant="ghost" size="sm" icon="refresh" onClick={onRefresh} disabled={busy}>{busy ? t("refreshingData") : t("refreshData")}</Button>}
          />
          <ResourceBoundary state={data.resources.trips} onRetry={onRefresh} lines={4}>
            <ResourceNote state={data.resources.routes} />
            <DataTable
              columns={columns}
              rows={operations}
              rowKey={({ trip }) => trip.id}
              empty={<EmptyState icon="local_shipping" compact title={search ? t("searchNoResults") : t("noOperations")} />}
            />
          </ResourceBoundary>
        </Card>

        <Card span={4}>
          <CardHeader title={t("criticalAlerts")} />
          {alertsLoading && <div className="overview-resource-state" role="status" aria-label={t("metricLoading")}><Skeleton /></div>}
          {alertsFailed && <EmptyState compact icon="report" title={t("resourceLoadError")} description={t("alertsUnavailableDescription")} action={<Button size="sm" variant="secondary" icon="refresh" onClick={onRefresh}>{t("retry")}</Button>} />}
          {!alertsLoading && !alertsFailed && (
            <div className="stack stack--tight">
              {alertStates.map((state, index) => <ResourceNote key={index} state={state} />)}
              {alerts.unmatchedRequests > 0 && <AlertItem tone="danger" title={t("alertUnmatchedRequestsTitle")} description={t("alertUnmatchedRequestsDescription", { count: number(alerts.unmatchedRequests) })} />}
              {alerts.unverifiedDriverRoutes > 0 && <AlertItem tone="warning" icon="verified_user" title={t("alertUnverifiedDriversTitle")} description={t("alertUnverifiedDriversDescription", { count: number(alerts.unverifiedDriverRoutes) })} />}
              {alerts.unbatchedOrders > 0 && <AlertItem tone="info" icon="inventory_2" title={t("alertPendingOrdersTitle")} description={t("alertPendingOrdersDescription", { count: number(alerts.unbatchedOrders) })} />}
              {alertCount === 0 && alertsComplete && <EmptyState icon="check" compact title={t("noAlertsTitle")} description={t("noAlertsDescription")} />}
            </div>
          )}
        </Card>

        <Card span={6}>
          <CardHeader title={t("tripVolume")} action={<span className="legend"><span className="legend__swatch" />{t("trips")}</span>} />
          <ResourceBoundary state={data.resources.trips} onRetry={onRefresh}>
            <BarChart bars={tripsByStatus} label={t("tripVolume")} />
          </ResourceBoundary>
        </Card>

        <Card span={6}>
          <CardHeader title={t("driverUtilizationChart")} />
          <ResourceBoundary state={data.resources.routes} onRetry={onRefresh}>
            <div>
              <MeterBar label={t("capacitySeats")} value={(seatCapacity / totalCapacity) * 100} display={number(seatCapacity)} tone="info" />
              <MeterBar label={t("capacityParcels")} value={(parcelCapacity / totalCapacity) * 100} display={number(parcelCapacity)} tone="warning" />
            </div>
          </ResourceBoundary>
        </Card>

        <Card span={6} padded={false}>
          <CardHeader title={t("passengerRequests")} badge={data.resources.requests.hasData ? <StatusBadge tone="warning">{number(data.requests.length)}</StatusBadge> : undefined} />
          <ResourceBoundary state={data.resources.requests} onRetry={onRefresh}>
            <div className="card__list">
              {data.requests.length === 0 && <EmptyState compact icon="person_pin_circle" title={t("noRequests")} />}
              {data.requests.slice(0, 5).map((request) => (
                <div className="card__row" key={request.id}>
                  <div><p className="card__row-title">{request.passenger?.name ?? t("noData")}</p><p className="card__row-detail"><RouteChip from={request.pickup_label} to={request.destination_label} /></p></div>
                  <StatusBadge status={request.status}>{status(request.status)}</StatusBadge>
                </div>
              ))}
            </div>
          </ResourceBoundary>
        </Card>

        <Card span={6} padded={false}>
          <CardHeader title={t("merchantOrders")} badge={data.resources.orders.hasData ? <StatusBadge tone="info">{number(data.orders.length)}</StatusBadge> : undefined} />
          <ResourceBoundary state={data.resources.orders} onRetry={onRefresh}>
            <div className="card__list">
              {data.orders.length === 0 && <EmptyState compact icon="inventory_2" title={t("noOrders")} />}
              {data.orders.slice(0, 5).map((order) => (
                <div className="card__row" key={order.id}>
                  <div><p className="card__row-title">{order.merchant?.name ?? order.pickup_label}</p><p className="card__row-detail">{order.pickup_label} · {number(order.parcels?.length ?? 0)} {t("parcels")}</p></div>
                  <StatusBadge status={order.status}>{status(order.status)}</StatusBadge>
                </div>
              ))}
            </div>
          </ResourceBoundary>
        </Card>
      </BentoGrid>
    </>
  );
}
