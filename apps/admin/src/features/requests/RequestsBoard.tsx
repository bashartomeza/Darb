import { useMemo } from "react";
import type { MerchantOrder, PassengerRequest } from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import { BentoGrid, Card, CardHeader, Column, DataTable, EmptyState, RouteChip, StatusBadge, TechnicalValue } from "../../ui";
import { matchesSearch } from "../search";
import { OrderRouteDetails, orderRouteSearchValues } from "../operatingRoutes/OrderRouteDetails";

/** Passenger requests and merchant orders, both from the production admin API. */
export function RequestsBoard({
  requests,
  orders,
  search
}: {
  requests: PassengerRequest[];
  orders: MerchantOrder[];
  search: string;
}) {
  const { t, status, number } = useLocale();

  const visibleRequests = useMemo(
    () =>
      requests.filter((request) =>
        matchesSearch([request.id, request.status, request.pickup_label, request.destination_label, request.passenger?.name, ...orderRouteSearchValues(request)], search)
      ),
    [requests, search]
  );

  const visibleOrders = useMemo(
    () =>
      orders.filter((order) =>
        matchesSearch(
          [
            order.id,
            order.status,
            order.pickup_label,
            order.merchant?.name,
            ...orderRouteSearchValues(order),
            ...(order.parcels ?? []).map((parcel) => parcel.dropoff_details ?? undefined)
          ],
          search
        )
      ),
    [orders, search]
  );

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
    { key: "id", header: t("columnTrip"), align: "end", cell: (request) => <TechnicalValue>{request.id}</TechnicalValue> }
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
    { key: "id", header: t("columnTrip"), align: "end", cell: (order) => <TechnicalValue>{order.id}</TechnicalValue> }
  ];

  return (
    <BentoGrid>
      <Card span={12} padded={false}>
        <CardHeader
          title={t("passengerRequests")}
          badge={<StatusBadge tone="warning">{number(visibleRequests.length)}</StatusBadge>}
        />
        <DataTable
          columns={requestColumns}
          rows={visibleRequests}
          rowKey={(request) => request.id}
          empty={<EmptyState compact icon="person_pin_circle" title={search ? t("searchNoResults") : t("noData")} />}
        />
      </Card>

      <Card span={12} padded={false}>
        <CardHeader
          title={t("merchantOrders")}
          badge={<StatusBadge tone="info">{number(visibleOrders.length)}</StatusBadge>}
        />
        <DataTable
          columns={orderColumns}
          rows={visibleOrders}
          rowKey={(order) => order.id}
          empty={<EmptyState compact icon="inventory_2" title={search ? t("searchNoResults") : t("noData")} />}
        />
      </Card>
    </BentoGrid>
  );
}
