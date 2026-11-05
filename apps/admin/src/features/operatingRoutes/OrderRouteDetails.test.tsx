import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PassengerRequest } from "../../api";
import { LocaleProvider } from "../../i18n/LocaleContext";
import type { Locale } from "../../i18n/translations";
import { OrderRouteDetails, orderRouteName } from "./OrderRouteDetails";

function render(locale: Locale, children: ReactNode) {
  const storage = { getItem: () => locale, setItem: () => undefined };
  const documentRef = { documentElement: { lang: "", dir: "" } };
  return renderToStaticMarkup(<LocaleProvider storage={storage} documentRef={documentRef}>{children}</LocaleProvider>);
}

const routed: PassengerRequest = {
  id: "request_1",
  status: "pending",
  pickup_label: "Hebron",
  destination_label: "Bethlehem",
  passenger_count: 1,
  service_route_id: "route_1",
  route_name_ar: "الخليل ← بيت لحم",
  route_name_en: "Hebron → Bethlehem",
  pickup_details: "near the PPU main gate",
  dropoff_details: "Bethlehem bus station"
};
const legacy: PassengerRequest = { id: "request_0", status: "pending", pickup_label: "Hebron / PPU", destination_label: "Bethlehem", passenger_count: 2, route_name_ar: null, route_name_en: null, pickup_details: null, dropoff_details: null };

describe("route details on orders", () => {
  it("names the route in the UI language and falls back for older rows", () => {
    expect(orderRouteName(routed, "ar")).toBe("الخليل ← بيت لحم");
    expect(orderRouteName(routed, "en")).toBe("Hebron → Bethlehem");
    expect(orderRouteName({ route_name_ar: null, route_name_en: "Hebron → Bethlehem" }, "ar")).toBe("Hebron → Bethlehem");
    expect(orderRouteName(legacy, "en")).toBeNull();
    expect(orderRouteName(undefined, "en")).toBeNull();
  });

  it("renders the route name and free-text pickup and drop-off only when present", () => {
    const english = render("en", <OrderRouteDetails order={routed} />);
    expect(english).toContain("Hebron → Bethlehem");
    expect(english).toContain("Pickup details");
    expect(english).toContain("near the PPU main gate");
    expect(english).toContain("Drop-off details");
    expect(english).toContain("Bethlehem bus station");
    expect(render("ar", <OrderRouteDetails order={routed} />)).toContain("تفاصيل الالتقاط");
    expect(render("en", <OrderRouteDetails order={legacy} />)).toBe("");
    expect(render("en", <OrderRouteDetails order={{ pickup_details: "   " }} />)).toBe("");
  });

});
