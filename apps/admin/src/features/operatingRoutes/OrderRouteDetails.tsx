import type { OrderRouteFields } from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import type { Locale } from "../../i18n/translations";

type Details = OrderRouteFields & { pickup_details?: string | null; dropoff_details?: string | null };

/** The order's route name in the UI language, or null for rows created before routes. */
export function orderRouteName(fields: OrderRouteFields | null | undefined, locale: Locale) {
  if (!fields) return null;
  const preferred = locale === "ar" ? fields.route_name_ar : fields.route_name_en;
  return preferred?.trim() || fields.route_name_en?.trim() || fields.route_name_ar?.trim() || null;
}

/** The chosen village / town in the UI language, falling back to the other language. */
export function orderPlaceName(ar: string | null | undefined, en: string | null | undefined, locale: Locale) {
  return (locale === "ar" ? ar : en)?.trim() || en?.trim() || ar?.trim() || null;
}

/** Values the top-bar search should also match for route-based orders. */
export function orderRouteSearchValues(fields: Details | null | undefined) {
  if (!fields) return [];
  return [
    fields.route_name_ar, fields.route_name_en, fields.pickup_details, fields.dropoff_details,
    fields.pickup_place_name_ar, fields.pickup_place_name_en, fields.dropoff_place_name_ar, fields.dropoff_place_name_en
  ].filter(
    (value): value is string => Boolean(value)
  );
}

/**
 * Route name plus the free-text pickup / drop-off a user typed. Renders nothing
 * when the row has none of them (older rows and older API builds).
 */
export function OrderRouteDetails({ order, showRouteName = true }: { order: Details | null | undefined; showRouteName?: boolean }) {
  const { t, locale } = useLocale();
  if (!order) return null;
  const name = showRouteName ? orderRouteName(order, locale) : null;
  const pickup = order.pickup_details?.trim();
  const dropoff = order.dropoff_details?.trim();
  const pickupPlace = orderPlaceName(order.pickup_place_name_ar, order.pickup_place_name_en, locale);
  const dropoffPlace = orderPlaceName(order.dropoff_place_name_ar, order.dropoff_place_name_en, locale);
  if (!name && !pickup && !dropoff && !pickupPlace && !dropoffPlace) return null;
  return (
    <div className="order-route-details">
      {name && <p className="cell-stack__title">{name}</p>}
      {pickupPlace && <p className="cell-stack__sub"><span className="order-route-details__label">{t("orderPickupPlace")}:</span> <bdi>{pickupPlace}</bdi></p>}
      {pickup && <p className="cell-stack__sub"><span className="order-route-details__label">{t("orderPickupDetails")}:</span> <bdi>{pickup}</bdi></p>}
      {dropoffPlace && <p className="cell-stack__sub"><span className="order-route-details__label">{t("orderDropoffPlace")}:</span> <bdi>{dropoffPlace}</bdi></p>}
      {dropoff && <p className="cell-stack__sub"><span className="order-route-details__label">{t("orderDropoffDetails")}:</span> <bdi>{dropoff}</bdi></p>}
    </div>
  );
}
