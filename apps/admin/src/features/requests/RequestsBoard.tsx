import type { ReactNode } from "react";
import type { ApiClient, MerchantOrder, PassengerRequest } from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import { BentoGrid, Button, Card, CardHeader, Column, DataTable, EmptyState, RouteChip, Skeleton, StatusBadge, TechnicalValue } from "../../ui";
import { OrderRouteDetails, orderRouteSearchValues } from "../operatingRoutes/OrderRouteDetails";
import { Pager } from "../shared/Pager";
import { useDebouncedValue, usePagedList, type PagedPhase } from "../shared/usePagedList";

export const DELIVERIES_PAGE_SIZE = 25;

export type RequestsBoardApi = Pick<ApiClient, "requests" | "orders">;

function ListBody({
  phase,
  loaded,
  onRetry,
  children
}: {
  phase: PagedPhase;
  loaded: boolean;
  onRetry: () => void;
  children: ReactNode;
}) {
  const { t } = useLocale();
  if (!loaded && phase === "loading") {
    return <div className="overview-resource-state" role="status" aria-label={t("metricLoading")}><Skeleton lines={4} /></div>;
  }
  if (!loaded && phase === "error") {
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
      {phase === "loading" && <p className="overview-resource-note" role="status">{t("metricRefreshing")}</p>}
      {phase === "error" && <p className="overview-resource-note overview-resource-note--error" role="alert">{t("metricRefreshError")}</p>}
      {children}
    </>
  );
}

/**
 * Passenger requests and merchant orders, each loaded page by page with its
 * own loading, error and refresh state. The search box is sent to the API so
 * it covers every page, not just the one on screen.
 */
export function RequestsBoard({ api, token, search }: { api: RequestsBoardApi; token: string; search: string }) {
  const { t, status, number } = useLocale();
  const query = useDebouncedValue(search.trim());

  const requests = usePagedList<PassengerRequest>(async (page) => {
    const result = await api.requests(token, { page, limit: DELIVERIES_PAGE_SIZE, search: query });
    return { items: result.requests, total: result.total ?? result.requests.length };
  }, [token, query]);

  const orders = usePagedList<MerchantOrder>(async (page) => {
    const result = await api.orders(token, { page, limit: DELIVERIES_PAGE_SIZE, search: query });
    return { items: result.orders, total: result.total ?? result.orders.length };
  }, [token, query]);

  const requestColumns: Column<PassengerRequest>[] = [
    {
      key: "passenger",
      header: t("columnPassenger"),
      cell: (request) => (
        <div>
          <p className="cell-stack__title">{request.passenger?.name ?? t("noData")}</p>
          <p className="cell-stack__sub technical">{request.passenger?.phone ?? ""}</p>
        </div>
      )
    },
    {
      key: "route",
      header: t("columnRoute"),
      cell: (request) => (
        <div>
          <RouteChip from={request.pickup_label} to={request.destination_label} />
          <OrderRouteDetails order={request} />
        </div>
      )
    },
    { key: "seats", header: t("columnSeats"), cell: (request) => number(request.passenger_count) },
    {
      key: "status",
      header: t("columnStatus"),
      cell: (request) => <StatusBadge status={request.status}>{status(request.status)}</StatusBadge>
    },
    { key: "id", header: t("columnReference"), align: "end", cell: (request) => <TechnicalValue>{request.id}</TechnicalValue> }
  ];

  const orderColumns: Column<MerchantOrder>[] = [
    {
      key: "merchant",
      header: t("columnMerchant"),
      cell: (order) => (
        <div>
          <p className="cell-stack__title">{order.merchant?.name ?? t("noData")}</p>
          <p className="cell-stack__sub">{order.pickup_label}</p>
        </div>
      )
    },
    {
      key: "route",
      header: t("columnRoute"),
      cell: (order) => {
        const dropoffs = (order.parcels ?? []).map((parcel) => parcel.dropoff_details?.trim()).filter(Boolean);
        const details = { ...order, dropoff_details: dropoffs.length ? dropoffs.join(" · ") : null };
        return orderRouteSearchValues(details).length > 0
          ? <OrderRouteDetails order={details} />
          : <span className="muted">{t("noData")}</span>;
      }
    },
    { key: "parcels", header: t("parcels"), cell: (order) => number(order.parcels?.length ?? 0) },
    {
      key: "status",
      header: t("columnStatus"),
      cell: (order) => <StatusBadge status={order.status}>{status(order.status)}</StatusBadge>
    },
    { key: "id", header: t("columnReference"), align: "end", cell: (order) => <TechnicalValue>{order.id}</TechnicalValue> }
  ];

  return (
    <BentoGrid>
      <Card span={12} padded={false}>
        <CardHeader
          title={t("passengerRequests")}
          badge={requests.loaded ? <StatusBadge tone="warning">{number(requests.total)}</StatusBadge> : undefined}
          action={<Button variant="ghost" size="sm" icon="refresh" disabled={requests.phase === "loading"} onClick={() => void requests.reload()}>{t("refreshData")}</Button>}
        />
        <ListBody phase={requests.phase} loaded={requests.loaded} onRetry={() => void requests.reload()}>
          <DataTable
            columns={requestColumns}
            rows={requests.items}
            rowKey={(request) => request.id}
            empty={<EmptyState compact icon="person_pin_circle" title={query ? t("searchNoResults") : t("noRequests")} />}
          />
          <Pager page={requests.page} total={requests.total} limit={DELIVERIES_PAGE_SIZE} disabled={requests.phase === "loading"} onPage={requests.setPage} />
        </ListBody>
      </Card>

      <Card span={12} padded={false}>
        <CardHeader
          title={t("merchantOrders")}
          badge={orders.loaded ? <StatusBadge tone="info">{number(orders.total)}</StatusBadge> : undefined}
          action={<Button variant="ghost" size="sm" icon="refresh" disabled={orders.phase === "loading"} onClick={() => void orders.reload()}>{t("refreshData")}</Button>}
        />
        <ListBody phase={orders.phase} loaded={orders.loaded} onRetry={() => void orders.reload()}>
          <DataTable
            columns={orderColumns}
            rows={orders.items}
            rowKey={(order) => order.id}
            empty={<EmptyState compact icon="inventory_2" title={query ? t("searchNoResults") : t("noOrders")} />}
          />
          <Pager page={orders.page} total={orders.total} limit={DELIVERIES_PAGE_SIZE} disabled={orders.phase === "loading"} onPage={orders.setPage} />
        </ListBody>
      </Card>
    </BentoGrid>
  );
}
