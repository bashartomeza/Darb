import { useMemo, type ReactNode } from "react";
import type { DashboardActiveTrip, DashboardResponse, DriverRoute } from "../../api";
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
import type { OverviewResourceState, OverviewResourceStates } from "./overviewState";

const TRIP_FLOW = ["created", "accepted", "pickup_started", "picked_up", "in_transit", "delivered", "completed", "cancelled", "failed"] as const;

export type OverviewData = {
  dashboard: DashboardResponse | null;
  routes: DriverRoute[];
  resources: OverviewResourceStates;
};

/**
 * Trip figures as the API counted them in the database, so they stay right
 * however many trips there are. Null when the dashboard did not load or an
 * older API build sent none.
 */
export function tripFigures(dashboard: DashboardResponse | null) {
  const trips = dashboard?.trips;
  // Anything but the expected shape (an older API, a malformed reply) counts as unavailable.
  if (!trips || typeof trips.by_status !== "object" || trips.by_status === null || !Array.isArray(trips.active) || typeof trips.active_total !== "number") return null;
  return {
    byStatus: TRIP_FLOW.map((flowStatus) => ({ id: flowStatus, value: trips.by_status[flowStatus] ?? 0 })),
    activeTotal: trips.active_total,
    active: trips.active
  };
}

/**
 * Alert counts as the API computed them over every row (requests awaiting a
 * driver, active routes of unverified drivers, merchant orders not batched).
 * Null when the dashboard did not load or an older API build sent none.
 */
export function deriveAlerts(dashboard: DashboardResponse | null) {
  const alerts = dashboard?.alerts;
  if (!alerts) return null;
  return {
    unmatchedRequests: alerts.unmatched_requests,
    unverifiedDriverRoutes: alerts.unverified_driver_routes,
    unbatchedOrders: alerts.unbatched_orders
  };
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
  const alerts = useMemo(() => deriveAlerts(data.dashboard), [data.dashboard]);
  const recentRequests = data.dashboard?.recent?.passenger_requests ?? [];
  const recentOrders = data.dashboard?.recent?.merchant_orders ?? [];

  const activeRoutes = data.routes.filter((route) => route.status === "active");
  const trips = useMemo(() => tripFigures(data.dashboard), [data.dashboard]);

  const operations = useMemo<DashboardActiveTrip[]>(
    () =>
      (trips?.active ?? []).filter((trip) =>
        matchesSearch(
          [trip.id, trip.status, trip.driver_route.origin_label, trip.driver_route.destination_label, trip.driver_route.driver.user.name, trip.driver_route.driver.user.phone],
          search
        )
      ),
    [trips, search]
  );

  const tripsByStatus = useMemo(
    () => (trips?.byStatus ?? []).map((bar) => ({ ...bar, title: `${status(bar.id)}: ${bar.value}` })),
    [trips, status]
  );

  const seatCapacity = activeRoutes.reduce((total, route) => total + (route.seats_available ?? 0), 0);
  const parcelCapacity = activeRoutes.reduce((total, route) => total + (route.parcel_capacity_available ?? 0), 0);
  const totalCapacity = Math.max(1, seatCapacity + parcelCapacity);

  const columns: Column<DashboardActiveTrip>[] = [
    {
      key: "driver",
      header: t("columnDriver"),
      cell: (trip) => (
        <div className="cell-stack">
          <Avatar name={trip.driver_route.driver.user.name || "—"} />
          <div>
            <p className="cell-stack__title">{trip.driver_route.driver.user.name || t("noData")}</p>
            <p className="cell-stack__sub technical">{trip.driver_route.driver.user.phone ?? ""}</p>
          </div>
        </div>
      )
    },
    {
      key: "route",
      header: t("columnRoute"),
      cell: (trip) => <RouteChip from={trip.driver_route.origin_label} to={trip.driver_route.destination_label} />
    },
    {
      key: "status",
      header: t("columnStatus"),
      cell: (trip) => <StatusBadge status={trip.status} icon={trip.status === "in_transit" ? "near_me" : undefined}>{status(trip.status)}</StatusBadge>
    },
    { key: "trip", header: t("columnTrip"), align: "end", cell: (trip) => <TechnicalValue>{trip.id}</TechnicalValue> }
  ];

  const alertState = data.resources.dashboard;
  const alertsLoading = !alertState.hasData && (alertState.phase === "idle" || alertState.phase === "loading");
  const alertsFailed = !alertState.hasData && alertState.phase === "error";
  const alertCount = alerts ? alerts.unmatchedRequests + alerts.unverifiedDriverRoutes + alerts.unbatchedOrders : 0;

  return (
    <>
      <section className="kpi-row" aria-label={t("overviewMetrics")}>
        <MetricCard metric="active-drivers" icon="directions_car" tone="info" label={t("activeDrivers")} value={data.dashboard?.counts.active_drivers} emptyLabel="noActiveDrivers" state={data.resources.dashboard} />
        <MetricCard metric="active-trips" icon="route" tone="neutral" label={t("activeTrips")} value={trips?.activeTotal} emptyLabel="noActiveTrips" state={data.resources.dashboard} unavailable={Boolean(data.dashboard) && !trips} unavailableLabel="metricLoadError" />
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
          <ResourceBoundary state={data.resources.dashboard} onRetry={onRefresh} lines={4}>
            <DataTable
              columns={columns}
              rows={operations}
              rowKey={(trip) => trip.id}
              empty={<EmptyState icon="local_shipping" compact title={search ? t("searchNoResults") : t("noOperations")} />}
            />
            {trips && trips.activeTotal > trips.active.length && (
              <p className="muted" role="note">{t("activeOperationsNewest", { shown: number(trips.active.length), total: number(trips.activeTotal) })}</p>
            )}
          </ResourceBoundary>
        </Card>

        <Card span={4}>
          <CardHeader title={t("criticalAlerts")} />
          {alertsLoading && <div className="overview-resource-state" role="status" aria-label={t("metricLoading")}><Skeleton /></div>}
          {alertsFailed && <EmptyState compact icon="report" title={t("resourceLoadError")} description={t("alertsUnavailableDescription")} action={<Button size="sm" variant="secondary" icon="refresh" onClick={onRefresh}>{t("retry")}</Button>} />}
          {!alertsLoading && !alertsFailed && (
            <div className="stack stack--tight">
              <ResourceNote state={alertState} />
              {alerts && alerts.unmatchedRequests > 0 && <AlertItem tone="danger" title={t("alertUnmatchedRequestsTitle")} description={t("alertUnmatchedRequestsDescription", { count: number(alerts.unmatchedRequests) })} />}
              {alerts && alerts.unverifiedDriverRoutes > 0 && <AlertItem tone="warning" icon="verified_user" title={t("alertUnverifiedDriversTitle")} description={t("alertUnverifiedDriversDescription", { count: number(alerts.unverifiedDriverRoutes) })} />}
              {alerts && alerts.unbatchedOrders > 0 && <AlertItem tone="info" icon="inventory_2" title={t("alertPendingOrdersTitle")} description={t("alertPendingOrdersDescription", { count: number(alerts.unbatchedOrders) })} />}
              {alerts && alertCount === 0 && <EmptyState icon="check" compact title={t("noAlertsTitle")} description={t("noAlertsDescription")} />}
            </div>
          )}
        </Card>

        <Card span={6}>
          <CardHeader title={t("tripVolume")} action={<span className="legend"><span className="legend__swatch" />{t("trips")}</span>} />
          <ResourceBoundary state={data.resources.dashboard} onRetry={onRefresh}>
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
          <CardHeader title={t("recentPassengerRequests")} badge={data.dashboard ? <StatusBadge tone="warning">{number(data.dashboard.counts.passenger_requests)}</StatusBadge> : undefined} />
          <ResourceBoundary state={data.resources.dashboard} onRetry={onRefresh}>
            <div className="card__list">
              {recentRequests.length === 0 && <EmptyState compact icon="person_pin_circle" title={t("noRequests")} />}
              {recentRequests.map((request) => (
                <div className="card__row" key={request.id}>
                  <div><p className="card__row-title">{request.passenger?.name ?? t("noData")}</p><p className="card__row-detail"><RouteChip from={request.pickup_label} to={request.destination_label} /></p></div>
                  <StatusBadge status={request.status}>{status(request.status)}</StatusBadge>
                </div>
              ))}
            </div>
          </ResourceBoundary>
        </Card>

        <Card span={6} padded={false}>
          <CardHeader title={t("recentMerchantOrders")} badge={data.dashboard ? <StatusBadge tone="info">{number(data.dashboard.counts.merchant_orders)}</StatusBadge> : undefined} />
          <ResourceBoundary state={data.resources.dashboard} onRetry={onRefresh}>
            <div className="card__list">
              {recentOrders.length === 0 && <EmptyState compact icon="inventory_2" title={t("noOrders")} />}
              {recentOrders.map((order) => (
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
