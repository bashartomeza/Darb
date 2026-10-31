import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../i18n/LocaleContext";
import type { Locale } from "../i18n/translations";
import { NAV_ITEMS } from "../navigation";
import { translate } from "../i18n/locale";
import { NotificationControl, SideNav, initialOf, notificationPanelState } from "./AppShell";
import { toneForStatus } from "./StatusBadge";
import { ModuleUnavailable } from "../features/placeholder/ModuleUnavailable";
import { OverviewDashboard, deriveAlerts } from "../features/overview/OverviewDashboard";
import { OVERVIEW_RESOURCE_KEYS, type OverviewResourcePhase, type OverviewResourceStates } from "../features/overview/overviewState";
import { matchesSearch } from "../features/search";
import { railSteps } from "../features/trips/TripsTracking";
import { parcelSteps } from "../features/batching/BatchingWorkspace";
import { scorePercent } from "../features/matching/MatchingWorkspace";
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

const zeroDashboard = {
  counts: { users: 0, drivers: 0, routes: 0, passenger_requests: 0, merchant_orders: 0, parcels: 0, active_drivers: 0, pending_driver_approvals: 0, open_incidents: 0 }
};
const emptyOverview = {
  dashboard: zeroDashboard,
  drivers: [],
  routes: [],
  requests: [],
  orders: [],
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
            brand: "Masari",
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
    const user = (id: string, account_status: "active" | "pending") => ({
      id,
      name: id,
      phone: `+97059${id}`,
      role: "driver",
      account_status,
      status_reason: null,
      status_updated_at: "2026-08-19T00:00:00.000Z",
      last_login_at: null,
      demo_account: false,
      created_at: "2026-08-19T00:00:00.000Z"
    });
    const data = {
      ...emptyOverview,
      dashboard: { ...zeroDashboard, counts: { ...zeroDashboard.counts, merchant_orders: 12, passenger_requests: 8, active_drivers: 3, pending_driver_approvals: 2 } },
      drivers: [
        { id: "d1", vehicle_type: "sedan", seats_total: 4, parcel_capacity: 2, verified: true, trust_score: 80, created_at: "", user: user("1", "active") },
        { id: "d2", vehicle_type: "van", seats_total: 6, parcel_capacity: 8, verified: false, trust_score: 70, created_at: "", user: user("2", "pending") }
      ],
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
    expect(textOf(markup)).toContain("Total orders 12");
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

  it("shows stable loading states without flashing fake zero values", () => {
    const loading = {
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
    const failed = {
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
    const partial = {
      ...emptyOverview,
      dashboard: null,
      drivers: [{
        id: "d1",
        vehicle_type: "sedan",
        seats_total: 4,
        parcel_capacity: 2,
        verified: true,
        trust_score: 80,
        created_at: "",
        user: {
          id: "u1", name: "Driver", phone: "+970590000001", role: "driver", account_status: "active" as const,
          status_reason: null, status_updated_at: "", last_login_at: null, demo_account: false, created_at: ""
        }
      }],
      trips: [{ id: "trip_1", status: "in_transit", driver_route_id: "route_1" }],
      resources
    };
    const markup = withLocale("en", <OverviewDashboard data={partial} search="" busy={false} onRefresh={() => undefined} />);

    expect(textOf(markup)).toContain("Active drivers — Data could not be loaded");
    expect(textOf(markup)).toContain("Active trips 1");
    expect(textOf(markup)).toContain("Total orders — Data could not be loaded");
  });

  it("shows the open-incident count from the API and localizes the empty state", () => {
    const data = {
      ...emptyOverview,
      dashboard: { ...zeroDashboard, counts: { ...zeroDashboard.counts, open_incidents: 4 } }
    };
    const english = withLocale("en", <OverviewDashboard data={data} search="" busy={false} onRefresh={() => undefined} />);
    const incidentCardText = textOf(english.split('data-metric="incidents"')[1].split("</section>")[0]);
    expect(incidentCardText).toContain("Incidents 4");

    const empty = withLocale("ar", <OverviewDashboard data={emptyOverview} search="" busy={false} onRefresh={() => undefined} />);
    expect(empty).toContain("لا توجد بلاغات مفتوحة");
  });

  it("derives alerts only from data the API actually returned", () => {
    expect(deriveAlerts(emptyOverview)).toEqual({
      unmatchedRequests: 0,
      unverifiedDriverRoutes: 0,
      unbatchedOrders: 0
    });

    const alerts = deriveAlerts({
      ...emptyOverview,
      requests: [
        { id: "r1", status: "pending", pickup_label: "a", destination_label: "b", passenger_count: 1 },
        { id: "r2", status: "matched", pickup_label: "a", destination_label: "b", passenger_count: 1 }
      ],
      routes: [
        {
          id: "route_1",
          status: "active",
          origin_label: "a",
          destination_label: "b",
          seats_available: 2,
          parcel_capacity_available: 3,
          driver: { verified: false }
        }
      ],
      orders: [{ id: "o1", status: "submitted", pickup_label: "a" }]
    });
    expect(alerts).toEqual({ unmatchedRequests: 1, unverifiedDriverRoutes: 1, unbatchedOrders: 1 });
  });

  it("searches case-insensitively across the operator-facing fields", () => {
    expect(matchesSearch(["Hebron", "Bethlehem"], "hebr")).toBe(true);
    expect(matchesSearch(["Hebron"], "nablus")).toBe(false);
    expect(matchesSearch([undefined, 12], "")).toBe(true);
  });
});

describe("progress rails", () => {
  it("splits the trip lifecycle into done, current, and pending steps", () => {
    const flow = ["accepted", "picked_up", "in_transit", "completed"];
    expect(railSteps(flow, "in_transit").map((step) => step.state)).toEqual(["done", "done", "current", "pending"]);
  });

  it("treats an unknown trip status as entirely pending rather than crashing", () => {
    const flow = ["accepted", "completed"];
    expect(railSteps(flow, "unknown").map((step) => step.state)).toEqual(["pending", "pending"]);
  });

  it("marks the first undelivered parcel as the current delivery stop", () => {
    const parcels = [
      { id: "p1", status: "delivered", destination_label: "a", size: "s", priority: "normal" },
      { id: "p2", status: "in_transit", destination_label: "b", size: "s", priority: "normal" },
      { id: "p3", status: "created", destination_label: "c", size: "s", priority: "normal" }
    ];
    expect(parcelSteps(parcels, (value) => value).map((step) => step.state)).toEqual(["done", "current", "pending"]);
  });

  it("scales match sub-scores to a percentage but leaves the deviation distance alone", () => {
    expect(scorePercent("trustScore", 0.82)).toBeCloseTo(82);
    expect(scorePercent("estimatedDeviationKm", 4.2)).toBeNull();
    expect(scorePercent("timingFit", 3)).toBe(100);
  });
});
