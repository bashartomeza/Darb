import { useEffect, useState } from "react";
import type { CancellationBody, PassengerParcelRow, PassengerParcelTrackingState } from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import { parcelSizeLabel } from "../../i18n/locale";
import type { TranslationKey } from "../../i18n/translations";
import { BentoGrid, Button, Card, CardHeader, Column, DataTable, EmptyState, RouteChip, Skeleton, StatusBadge } from "../../ui";
import type { Tone } from "../../ui/StatusBadge";
import { OrderRouteDetails, orderRouteSearchValues } from "../operatingRoutes/OrderRouteDetails";
import { CancelDialog } from "../cancellations/CancelDialog";
import { ADMIN_CANCELLABLE_PARCEL_STATES, isOneOf } from "../cancellations/cancellationModel";

type PassengerParcelsApi = {
  passengerParcels: (token: string) => Promise<{ parcels: PassengerParcelRow[] }>;
  /** When given, parcels not yet delivered get a cancel action that asks for a reason. */
  cancelMerchantOrder?: (token: string, id: string, body: CancellationBody) => Promise<unknown>;
};

export const PARCEL_STATE_LABEL: Record<PassengerParcelTrackingState, TranslationKey> = {
  searching: "parcelTrackSearching",
  assigned: "parcelTrackAssigned",
  picked_up: "parcelTrackPickedUp",
  in_transit: "parcelTrackInTransit",
  delivered: "parcelTrackDelivered",
  cancelled: "parcelTrackCancelled",
  failed: "parcelTrackFailed",
  expired: "parcelTrackExpired"
};

export const PARCEL_STATE_TONE: Record<PassengerParcelTrackingState, Tone> = {
  searching: "warning",
  assigned: "info",
  picked_up: "info",
  in_transit: "info",
  delivered: "success",
  cancelled: "neutral",
  failed: "danger",
  expired: "neutral"
};

/**
 * Parcels that ordinary passengers send. Shows tracking state only: the
 * receiver's name, phone and note are never returned by the admin endpoint.
 */
export function PassengerParcelsPanel({
  api,
  token,
  search = "",
  canAct = true
}: {
  api: PassengerParcelsApi;
  token: string;
  search?: string;
  canAct?: boolean;
}) {
  const { t, dateTime, locale } = useLocale();
  const [parcels, setParcels] = useState<PassengerParcelRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [cancelTarget, setCancelTarget] = useState<PassengerParcelRow | null>(null);
  const canCancel = Boolean(api.cancelMerchantOrder) && canAct;

  useEffect(() => {
    let current = true;
    api
      .passengerParcels(token)
      .then((result) => current && setParcels(result.parcels))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [api, token, reload]);

  async function confirmCancel(body: CancellationBody) {
    if (!cancelTarget || !api.cancelMerchantOrder) return;
    await api.cancelMerchantOrder(token, cancelTarget.id, body);
    setCancelTarget(null);
    setReload((value) => value + 1);
  }

  const needle = search.trim().toLowerCase();
  const rows = (parcels ?? []).filter(
    (parcel) =>
      !needle ||
      [parcel.id, parcel.sender.name, parcel.pickup_label, parcel.dropoff_label ?? "", parcel.tracking_state, ...orderRouteSearchValues(parcel)].some((value) =>
        value.toLowerCase().includes(needle)
      )
  );

  const columns: Column<PassengerParcelRow>[] = [
    { key: "sender", header: t("passengerParcelColumnSender"), cell: (parcel) => parcel.sender.name },
    {
      key: "route",
      header: t("columnRoute"),
      cell: (parcel) => (
        <div>
          <RouteChip from={parcel.pickup_label} to={parcel.dropoff_label ?? t("noData")} />
          <OrderRouteDetails order={parcel} />
        </div>
      )
    },
    { key: "size", header: t("passengerParcelColumnSize"), cell: (parcel) => parcelSizeLabel(locale, parcel.size) },
    {
      key: "state",
      header: t("passengerParcelColumnState"),
      cell: (parcel) => (
        <StatusBadge tone={PARCEL_STATE_TONE[parcel.tracking_state] ?? "neutral"}>
          {PARCEL_STATE_LABEL[parcel.tracking_state] ? t(PARCEL_STATE_LABEL[parcel.tracking_state]) : parcel.tracking_state}
        </StatusBadge>
      )
    },
    { key: "created", header: t("passengerParcelColumnCreated"), align: "end", cell: (parcel) => dateTime(parcel.created_at) },
    ...(canCancel
      ? [{
          key: "actions",
          header: t("columnActions"),
          align: "end" as const,
          cell: (parcel: PassengerParcelRow) => isOneOf(ADMIN_CANCELLABLE_PARCEL_STATES, parcel.tracking_state)
            ? <Button size="sm" variant="ghost" icon="block" onClick={() => setCancelTarget(parcel)}>{t("cancelParcelAction")}</Button>
            : null
        }]
      : [])
  ];

  return (
    <BentoGrid>
      <Card span={12}>
        <CardHeader title={t("passengerParcelsTitle")} />
        <p className="muted">{t("passengerParcelsScopeNote")}</p>
        {failed ? (
          <EmptyState title={t("passengerParcelsLoadFailed")} />
        ) : parcels === null ? (
          <Skeleton />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(parcel) => parcel.id}
            empty={<EmptyState title={t("passengerParcelsEmpty")} />}
          />
        )}
      </Card>
      <CancelDialog
        open={cancelTarget !== null}
        subject={cancelTarget ? t("cancelParcelSubject", { id: cancelTarget.id, owner: cancelTarget.sender.name }) : ""}
        onClose={() => setCancelTarget(null)}
        onConfirm={confirmCancel}
      />
    </BentoGrid>
  );
}
