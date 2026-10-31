import { useEffect, useState } from "react";
import type { PassengerParcelRow, PassengerParcelTrackingState } from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import type { TranslationKey } from "../../i18n/translations";
import { BentoGrid, Card, CardHeader, Column, DataTable, EmptyState, RouteChip, Skeleton, StatusBadge } from "../../ui";
import type { Tone } from "../../ui/StatusBadge";

type PassengerParcelsApi = {
  passengerParcels: (token: string) => Promise<{ parcels: PassengerParcelRow[] }>;
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
export function PassengerParcelsPanel({ api, token, search = "" }: { api: PassengerParcelsApi; token: string; search?: string }) {
  const { t, dateTime } = useLocale();
  const [parcels, setParcels] = useState<PassengerParcelRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    api
      .passengerParcels(token)
      .then((result) => current && setParcels(result.parcels))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [api, token]);

  const needle = search.trim().toLowerCase();
  const rows = (parcels ?? []).filter(
    (parcel) =>
      !needle ||
      [parcel.id, parcel.sender.name, parcel.pickup_label, parcel.dropoff_label ?? "", parcel.tracking_state].some((value) =>
        value.toLowerCase().includes(needle)
      )
  );

  const columns: Column<PassengerParcelRow>[] = [
    { key: "sender", header: t("passengerParcelColumnSender"), cell: (parcel) => parcel.sender.name },
    {
      key: "route",
      header: t("columnRoute"),
      cell: (parcel) => <RouteChip from={parcel.pickup_label} to={parcel.dropoff_label ?? t("noData")} />
    },
    { key: "size", header: t("passengerParcelColumnSize"), cell: (parcel) => parcel.size },
    {
      key: "state",
      header: t("passengerParcelColumnState"),
      cell: (parcel) => (
        <StatusBadge tone={PARCEL_STATE_TONE[parcel.tracking_state] ?? "neutral"}>
          {PARCEL_STATE_LABEL[parcel.tracking_state] ? t(PARCEL_STATE_LABEL[parcel.tracking_state]) : parcel.tracking_state}
        </StatusBadge>
      )
    },
    { key: "created", header: t("passengerParcelColumnCreated"), align: "end", cell: (parcel) => dateTime(parcel.created_at) }
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
    </BentoGrid>
  );
}
