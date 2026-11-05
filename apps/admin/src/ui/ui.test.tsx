import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../i18n/LocaleContext";
import type { Locale } from "../i18n/translations";
import { NAV_ITEMS } from "../navigation";
import { statusLabel, translate } from "../i18n/locale";
import { NotificationControl, SideNav, TopBar, initialOf, notificationPanelState } from "./AppShell";
import { toneForStatus } from "./StatusBadge";
import { ModuleUnavailable } from "../features/placeholder/ModuleUnavailable";
import type { DashboardResponse } from "../api";
import { OverviewDashboard, deriveAlerts, type OverviewData } from "../features/overview/OverviewDashboard";
import { OVERVIEW_RESOURCE_KEYS, type OverviewResourcePhase, type OverviewResourceStates } from "../features/overview/overviewState";
import { matchesSearch } from "../features/search";
import { ProfilePanel } from "../features/profile/ProfilePanel";

/**
 * The suite runs in a node environment, so the provider is given explicit
 * storage and document stubs instead of the `window` defaults.
 */
function withLocale(locale: Locale, children: ReactNode) {
  const storage = { getItem: () => locale, setItem: () => undefined };
  const documentRef = { documentElement: { lang: "", dir: "" } };
  return renderToStaticMarkup(
    <LocaleProvider storage={storage} documentRef={documentRef}>
      {children}
    </LocaleProvider>
  );
}

/** React escapes entities in static markup, so expectations must escape too. */
function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Visible text only — strips tags so SVG path data is not mistaken for content. */
function textOf(markup: string) {
  return markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function resourceStates(phase: OverviewResourcePhase, hasData: boolean): OverviewResourceStates {
  return Object.fromEntries(OVERVIEW_RESOURCE_KEYS.map((key) => [key, { phase, hasData }])) as OverviewResourceStates;
}

const zeroDashboard: DashboardResponse = {
  counts: { users: 0, drivers: 0, routes: 0, passenger_requests: 0, merchant_orders: 0, parcels: 0, active_drivers: 0, pending_driver_approvals: 0, open_incidents: 0 },
  alerts: { unmatched_requests: 0, unbatched_orders: 0, unverified_driver_routes: 0 },
  recent: { passenger_requests: [], merchant_orders: [], routes: [] }
};
const emptyOverview: OverviewData = {
  dashboard: zeroDashboard,
  routes: [],
  trips: [],
  resources: resourceStates("ready", true)
};

describe("admin shell", () => {
  it("renders every sidebar tab label in Arabic and English", () => {
    for (const locale of ["ar", "en"] as Locale[]) {
      const markup = renderToStaticMarkup(
        <SideNav
          items={NAV_ITEMS}
          active="overview"
          onSelect={() => undefined}
          labels={{
            brand: "Darb",
            subtitle: "",
            navigation: "nav",
            label: (item) => translate(locale, item.labelKey),
            groupLabel: (labelKey) => translate(locale, labelKey)
          }}
          footer={null}
        />
      );
      for (const item of NAV_ITEMS) {
        expect(markup).toContain(escapeHtml(translate(locale, item.labelKey)));
      }
    }
  });

  it("marks exactly one tab as the current page", () => {
    const markup = renderToStaticMarkup(
      <SideNav
        items={NAV_ITEMS}
        active="trips"
        onSelect={() => undefined}
        labels={{
          brand: "",
          subtitle: "",
          navigation: "nav",
          label: (item) => item.id,
          groupLabel: (labelKey) => labelKey
        }}
        footer={null}
      />
    );
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
    expect(markup).toContain('class="sidenav__item is-active"');
  });

  it("has no help button without a destination in the top bar", () => {
    const markup = renderToStaticMarkup(
      <TopBar
        title="Overview"
        search=""
        onSearch={() => undefined}
        searchPlaceholder="Search"
        searchLabel="Search"
        notificationsLabel="Notifications"
        notificationsTitle="Notifications"
        notificationsDescription="None"
        closeNotificationsLabel="Close"
        user={{ name: "Admin", detail: "" }}
      />
    );
    expect(markup).not.toContain('aria-label="Help"');
    expect(markup).toContain('aria-label="Notifications"');
  });

  it("derives avatar initials without assuming a Latin alphabet", () => {
    expect(initialOf("أحمد محمود")).toBe("أ");
    expect(initialOf("Sara Mansour")).toBe("S");
    expect(initialOf(undefined)).toBe("؟");
  });

  it("renders a real read-only profile view in both supported directions", () => {
    const admin = { id: "admin_1", name: "Bashar Admin", phone: "+970590000005", role: "admin" };
    const english = withLocale("en", <ProfilePanel admin={admin} />);
    const arabic = withLocale("ar", <ProfilePanel admin={admin} />);

    expect(english).toContain("Account details");
    expect(english).toContain("Profile editing is not available yet");
    expect(arabic).toContain("تفاصيل الحساب");
    expect(arabic).toContain("تعديل الملف الشخصي غير متاح بعد");
    expect(english).toContain("Bashar Admin");
    expect(english).not.toContain("<input");
  });

  it("opens an accessible notification panel without an invented count or unread marker", () => {
    expect(notificationPanelState(false, "toggle")).toBe(true);
    expect(notificationPanelState(true, "toggle")).toBe(false);
    expect(notificationPanelState(true, "close")).toBe(false);

    const markup = renderToStaticMarkup(
      <NotificationControl
        label="Notifications"
        title="Notifications"
        description="No notification service is currently connected."
        closeLabel="Close notifications"
        initiallyOpen
      />
    );
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("No notification service is currently connected.");
    expect(markup).toContain('aria-label="Close notifications"');
    expect(markup).not.toContain("topbar__dot");
    expect(markup).not.toMatch(/Notifications \(\d+\)/);
  });
});

describe("status tones", () => {
  it("maps lifecycle statuses onto the design system tones", () => {
    expect(toneForStatus("completed")).toBe("success");
    expect(toneForStatus("in_transit")).toBe("info");
    expect(toneForStatus("pending")).toBe("warning");
    expect(toneForStatus("cancelled")).toBe("danger");
    expect(toneForStatus("failed")).toBe("danger");
  });

  it("labels the failed status in both languages", () => {
    expect(statusLabel("en", "failed")).toBe("Failed");
    expect(statusLabel("ar", "failed")).toBe("فشل");
  });

  it("falls back to neutral for a status the backend adds later", () => {
    expect(toneForStatus("some_future_status")).toBe("neutral");
  });
});

describe("modules without a backing endpoint", () => {
  it("states the module is unavailable and renders no sample records", () => {
    const markup = withLocale("en", <ModuleUnavailable icon="verified_user" reason="no-api" />);
    expect(markup).toContain("This module is not available yet");
    expect(textOf(markup)).not.toMatch(/\d/);
  });

  it("distinguishes a demo-only module from a missing endpoint", () => {
    const markup = withLocale("en", <ModuleUnavailable icon="alt_route" reason="demo-only" />);
    expect(markup).toContain("Demo builds only");
    expect(markup).not.toContain("This module is not available yet");
  });

  it("localizes both states into Arabic", () => {
    expect(withLocale("ar", <ModuleUnavailable icon="psychology" reason="no-api" />)).toContain("غير متاحة بعد");
    expect(withLocale("ar", <ModuleUnavailable icon="alt_route" reason="demo-only" />)).toContain("إصدار العرض فقط");
  });
});

describe("overview dashboard", () => {
  it("renders genuine zero states when successful APIs return no records", () => {
    const markup = withLocale(
      "en",
      <OverviewDashboard data={emptyOverview} search="" busy={false} onRefresh={() => undefined} />
    );
    expect(markup).toContain("No trips are currently in progress.");
    expect(markup).toContain("No critical alerts");
    expect(markup).toContain("No active drivers");
    expect(markup).toContain("No active trips");
    expect(markup).toContain("No pending approvals");
    expect(markup).toContain("No orders");
    expect(markup).toContain("No requests");
    expect(markup).toContain("No open incidents");
  });

  it("renders only supported metric values from their owning API resources", () => {
    const data: OverviewData = {
      ...emptyOverview,
      dashboard: { ...zeroDashboard, counts: { ...zeroDashboard.counts, merchant_orders: 12, passenger_parcels: 30, passenger_requests: 8, active_drivers: 3, pending_driver_approvals: 2 } },
      trips: [
        { id: "trip_accepted", status: "accepted", driver_route_id: "route_1" },
        { id: "trip_active", status: "in_transit", driver_route_id: "route_1" },
        { id: "trip_delivered", status: "delivered", driver_route_id: "route_1" }
      ]
    };
    const markup = withLocale("en", <OverviewDashboard data={data} search="" busy={false} onRefresh={() => undefined} />);

    expect(markup).toContain('data-metric="active-drivers"');
    expect(markup).toContain('data-metric="active-trips"');
    expect(markup).toContain('data-metric="pending-approvals"');
    expect(textOf(markup)).toContain("Active drivers 3");
    expect(textOf(markup)).toContain("Active trips 1");
    expect(textOf(markup)).toContain("Pending approvals 2");
    // Merchant orders only, labelled as such, so it matches the Deliveries list; passenger parcels are not added in.
    expect(textOf(markup)).toContain("Total merchant orders 12");
    expect(textOf(markup)).not.toContain("42");
    expect(textOf(markup)).toContain("Total passenger requests 8");
  });

  it("keeps zero-state metric semantics equivalent in Arabic", () => {
    const markup = withLocale("ar", <OverviewDashboard data={emptyOverview} search="" busy={false} onRefresh={() => undefined} />);
    const text = textOf(markup);

    expect(text).toContain("السائقون النشطون ٠ لا يوجد سائقون نشطون");
    expect(text).toContain("الموافقات المعلقة ٠ لا توجد موافقات معلقة");
    expect(text).toContain("إجمالي طلبات التجار ٠");
    expect(text).toContain("إجمالي طلبات الركاب ٠");
  });

  it("shows the newest requests and orders exactly as the API sorted them", () => {
    const passenger = { id: "u1", name: "Newest Passenger", phone: "+1", role: "passenger" };
    const data: OverviewData = {
      ...emptyOverview,
      dashboard: {
        ...zeroDashboard,
        counts: { ...zeroDashboard.counts, passenger_requests: 40, merchant_orders: 9 },
        recent: {
          passenger_requests: [
            { id: "r_new", status: "pending", pickup_label: "Nablus", destination_label: "Ramallah", passenger_count: 1, passenger },
            { id: "r_old", status: "matched", pickup_label: "Hebron", destination_label: "Bethlehem", passenger_count: 2, passenger: { ...passenger, name: "Older Passenger" } }
          ],
          merchant_orders: [{ id: "o_new", status: "submitted", pickup_label: "Jenin", merchant: { id: "m1", name: "Newest Shop", phone: "+2", role: "merchant" }, parcels: [] }],
          routes: []
        }
      }
    };
    const text = textOf(withLocale("en", <OverviewDashboard data={data} search="" busy={false} onRefresh={() => undefined} />));

    expect(text).toContain("Newest passenger requests 40");
    expect(text).toContain("Newest merchant orders 9");
    expect(text.indexOf("Newest Passenger")).toBeGreaterThan(-1);
    expect(text.indexOf("Newest Passenger")).toBeLessThan(text.indexOf("Older Passenger"));
    expect(text).toContain("Newest Shop");
  });

  it("has no dead per-row action button in active operations", () => {
    const data: OverviewData = { ...emptyOverview, trips: [{ id: "trip_1", status: "in_transit", driver_route_id: "route_1" }] };
    const markup = withLocale("en", <OverviewDashboard data={data} search="" busy={false} onRefresh={() => undefined} />);
    expect(markup).toContain("trip_1");
    expect(markup).not.toContain("Row actions");
    expect(markup).not.toMatch(/<button[^>]*disabled[^>]*>[^<]*<svg/);
  });

  it("shows stable loading states without flashing fake zero values", () => {
    const loading: OverviewData = {
      ...emptyOverview,
      dashboard: null,
      resources: resourceStates("loading", false)
    };
    const markup = withLocale("en", <OverviewDashboard data={loading} search="" busy onRefresh={() => undefined} />);

    expect(markup).toContain('aria-label="Loading data"');
    expect(markup).toContain("Refreshing...");
    expect(markup).not.toContain("No active drivers");
    expect(markup).not.toContain("No active trips");
  });

  it("distinguishes a total API error from an empty dashboard and exposes retry", () => {
    const failed: OverviewData = {
      ...emptyOverview,
      dashboard: null,
      resources: resourceStates("error", false)
    };
    const markup = withLocale("en", <OverviewDashboard data={failed} search="" busy={false} onRefresh={() => undefined} />);

    expect(markup).toContain("Data could not be loaded");
    expect(markup).toContain("This section could not be loaded");
    expect(markup).toContain("Retry");
    expect(markup).not.toContain("internal_server_error");
    expect(markup).not.toContain("No active drivers");
  });

  it("keeps successful metrics visible during a partial resource failure", () => {
    const resources = resourceStates("ready", true);
    resources.dashboard = { phase: "error", hasData: false };
    const partial: OverviewData = {
      ...emptyOverview,
      dashboard: null,
      trips: [{ id: "trip_1", status: "in_transit", driver_route_id: "route_1" }],
      resources
    };
    const markup = withLocale("en", <OverviewDashboard data={partial} search="" busy={false} onRefresh={() => undefined} />);

    expect(textOf(markup)).toContain("Active drivers — Data could not be loaded");
    expect(textOf(markup)).toContain("Active trips 1");
    expect(textOf(markup)).toContain("Total merchant orders — Data could not be loaded");
  });

  it("shows the open-incident count from the API and localizes the empty state", () => {
    const data: OverviewData = {
      ...emptyOverview,
      dashboard: { ...zeroDashboard, counts: { ...zeroDashboard.counts, open_incidents: 4 } }
    };
    const english = withLocale("en", <OverviewDashboard data={data} search="" busy={false} onRefresh={() => undefined} />);
    const incidentCardText = textOf(english.split('data-metric="incidents"')[1].split("</section>")[0]);
    expect(incidentCardText).toContain("Incidents 4");

    const empty = withLocale("ar", <OverviewDashboard data={emptyOverview} search="" busy={false} onRefresh={() => undefined} />);
    expect(empty).toContain("لا توجد بلاغات مفتوحة");
  });

  it("takes alert counts from the API, which counts every row rather than one page", () => {
    expect(deriveAlerts(null)).toBeNull();
    expect(deriveAlerts({ counts: zeroDashboard.counts })).toBeNull();
    expect(deriveAlerts(zeroDashboard)).toEqual({ unmatchedRequests: 0, unverifiedDriverRoutes: 0, unbatchedOrders: 0 });

    const dashboard: DashboardResponse = { ...zeroDashboard, alerts: { unmatched_requests: 120, unbatched_orders: 3, unverified_driver_routes: 1 } };
    expect(deriveAlerts(dashboard)).toEqual({ unmatchedRequests: 120, unverifiedDriverRoutes: 1, unbatchedOrders: 3 });
    const text = textOf(withLocale("en", <OverviewDashboard data={{ ...emptyOverview, dashboard }} search="" busy={false} onRefresh={() => undefined} />));
    expect(text).not.toContain("No critical alerts");
    expect(text).toContain("120");
  });

  it("searches case-insensitively across the operator-facing fields", () => {
    expect(matchesSearch(["Hebron", "Bethlehem"], "hebr")).toBe(true);
    expect(matchesSearch(["Hebron"], "nablus")).toBe(false);
    expect(matchesSearch([undefined, 12], "")).toBe(true);
  });
});
