import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient, type AdminTripDetail, type AdminTripPage } from "../../api";
import { LocaleProvider } from "../../i18n/LocaleContext";
import type { Locale } from "../../i18n/translations";
import {
  createLatestRequestGate,
  createTripStatusIntent,
  executeTripStatusMutation,
  TripsManagementView,
  type TripsManagementViewProps,
} from "./TripsManagement";

const createdAt = "2026-08-23T12:00:00.000Z";
const legacy = {
  id: "trip_legacy",
  kind: "legacy" as const,
  status: "accepted" as const,
  driver_id: "profile_1",
  driver_route_id: "route_1",
  passenger_request_id: "request_1",
  merchant_order_id: null,
  parcel_batch_id: null,
  started_at: createdAt,
  completed_at: null,
  created_at: createdAt,
  operational_mode: "legacy",
  canonical_trip_version: null,
  manifest_id: null,
  route_version_id: null,
  route_version: null,
  driver_route: {
    id: "route_1",
    origin_label: "Hebron",
    destination_label: "Bethlehem",
    departure_at: createdAt,
    driver: { id: "profile_1", vehicle_type: "sedan", seats_total: 4, parcel_capacity: 3, verified: true, trust_score: 80, user: { id: "driver_1", name: "QA Driver", phone: "+15550000002", demo_account: true } },
  },
  passenger_request: {
    id: "request_1",
    pickup_label: "Hebron",
    destination_label: "Bethlehem",
    passenger_count: 1,
    passenger: { id: "passenger_1", name: "QA Passenger", phone: "+15550000003", demo_account: false },
  },
  merchant_order: null,
  parcel_batch: null,
  canonical_manifest: null,
  _count: { location_events: 1 },
  has_stored_location: true,
  demo_context: true,
  supported_admin_transition: "pickup_started" as const,
};
const canonical = {
  ...legacy,
  id: "trip_canonical",
  kind: "canonical" as const,
  operational_mode: "canonical_route_v1",
  canonical_trip_version: "canonical_route_v1",
  supported_admin_transition: null,
};
const shared = {
  ...canonical,
  id: "trip_shared",
  kind: "shared" as const,
  manifest_id: "manifest_1",
  canonical_manifest: {
    id: "manifest_1",
    lifecycle_status: "accepted",
    member_count: 2,
    passenger_request_count: 1,
    passenger_seat_count: 1,
    merchant_order_count: 1,
    parcel_unit_count: 2,
    members: [
      { id: "member_1", demand_type: "passenger", member_status: "active", member_sequence: 1, passenger_seats: 1, parcel_units: 0, passenger_request: { id: "request_shared", passenger_count: 1, passenger: { id: "passenger_shared", name: "QA Shared Passenger", phone: "+15550000004", demo_account: false } }, merchant_order: null },
      { id: "member_2", demand_type: "merchant", member_status: "active", member_sequence: 2, passenger_seats: 0, parcel_units: 2, passenger_request: null, merchant_order: { id: "order_shared", merchant: { id: "merchant_shared", name: "QA Shared Merchant", phone: "+15550000005", demo_account: false }, _count: { parcels: 2 } } },
    ],
  },
};
const page: AdminTripPage = { trips: [legacy, canonical, shared], page: 1, limit: 25, total: 3 };
const detail: AdminTripDetail = {
  ...legacy,
  latest_stored_location: {
    lat: "31.532000",
    lng: "35.099000",
    source: "simulated",
    sequence: 2,
    recorded_at: createdAt,
  },
};

function render(locale: Locale, children: ReactNode) {
  const storage = { getItem: () => locale, setItem: () => undefined };
  const documentRef = { documentElement: { lang: "", dir: "" } };
  return renderToStaticMarkup(
    <LocaleProvider storage={storage} documentRef={documentRef}>{children}</LocaleProvider>,
  );
}

function props(overrides: Partial<TripsManagementViewProps> = {}): TripsManagementViewProps {
  return {
    phase: "ready",
    data: page,
    page: 1,
    pages: 1,
    query: "",
    statusFilter: "all",
    kindFilter: "all",
    selectedId: detail.id,
    detail,
    detailPhase: "ready",
    pending: null,
    busy: false,
    error: null,
    canAct: true,
    onStatusFilterChange: vi.fn(),
    onKindFilterChange: vi.fn(),
    onPageChange: vi.fn(),
    onLoadDetail: vi.fn(),
    onCloseDetail: vi.fn(),
    onRefresh: vi.fn(),
    onBeginStatus: vi.fn(),
    onSubmitStatus: vi.fn(),
    onCancelStatus: vi.fn(),
    ...overrides,
  };
}

describe("Admin Trips Management", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("allows only the latest overlapping request to commit", () => {
    const gate = createLatestRequestGate();
    const first = gate.begin();
    const second = gate.begin();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
    gate.invalidate();
    expect(gate.isCurrent(second)).toBe(false);
  });

  it("renders all trip kinds with server filters, deterministic pagination controls, and responsive structure", () => {
    const markup = render("en", <TripsManagementView {...props({ pages: 3, page: 2, statusFilter: "accepted", kindFilter: "shared" })} />);
    expect(markup).toContain("Trip directory");
    expect(markup).toContain("Legacy");
    expect(markup).toContain("Canonical");
    expect(markup).toContain("Shared");
    expect(markup).toContain('value="accepted" selected');
    expect(markup).toContain('value="shared" selected');
    expect(markup).toContain("Page 2 of 3");
    expect(markup).toContain("trips-management");
  });

  it("distinguishes loading, error, empty, and search-empty states", () => {
    expect(render("en", <TripsManagementView {...props({ phase: "loading" })} />)).toContain('role="status"');
    expect(render("en", <TripsManagementView {...props({ phase: "error" })} />)).toContain("This section could not be loaded");
    expect(render("en", <TripsManagementView {...props({ data: { ...page, trips: [], total: 0 }, selectedId: null, detail: null })} />)).toContain("No trips found");
    expect(render("en", <TripsManagementView {...props({ data: { ...page, trips: [], total: 0 }, query: "missing", selectedId: null, detail: null })} />)).toContain("Nothing matches your search");
  });

  it("labels persisted location evidence honestly and never claims live GPS", () => {
    const markup = render("en", <TripsManagementView {...props()} />);
    expect(markup).toContain("Latest stored location");
    expect(markup).toContain("simulated");
    expect(markup).toContain("31.532000, 35.099000");
    expect(markup).not.toMatch(/live gps/i);
  });

  it("distinguishes demo-derived trips and renders merchant/no-location detail honestly", () => {
    const merchantDetail: AdminTripDetail = {
      ...detail,
      demo_context: false,
      passenger_request: null,
      merchant_order_id: "order_1",
      merchant_order: { id: "order_1", pickup_label: "Hebron", merchant: { id: "merchant_1", name: "QA Merchant", phone: "+15550000006", demo_account: false }, _count: { parcels: 3 } },
      latest_stored_location: null,
      has_stored_location: false,
    };
    const directory = render("en", <TripsManagementView {...props()} />);
    const merchantMarkup = render("en", <TripsManagementView {...props({ detail: merchantDetail })} />);
    expect(directory).toContain("Demo");
    expect(merchantMarkup).toContain("QA Merchant");
    expect(merchantMarkup).toContain("No stored location exists for this trip.");
  });

  it("shows only the safe legacy forward action and explains disabled cancellation", () => {
    const markup = render("en", <TripsManagementView {...props()} />);
    expect(markup).toContain("Move to Pickup started");
    expect(markup).not.toContain("Cancel trip");
    expect(markup).toContain("Admin cancellation is unavailable until related operational state can be rolled back safely and transactionally.");
    expect(createTripStatusIntent(legacy)).toEqual({ trip: legacy, expectedStatus: "accepted", nextStatus: "pickup_started" });
  });

  it("renders created and canonical/shared trips as honest read-only states", () => {
    const created = { ...detail, status: "created" as const, supported_admin_transition: null };
    expect(render("en", <TripsManagementView {...props({ detail: created })} />)).toContain("No supported Admin forward action exists for a created trip.");
    expect(render("en", <TripsManagementView {...props({ detail: { ...detail, ...canonical } })} />)).toContain("Canonical trips are read-only in Card 5.");
    const sharedMarkup = render("en", <TripsManagementView {...props({ detail: { ...detail, ...shared } })} />);
    expect(sharedMarkup).toContain("Shared trips are read-only in Card 5.");
    expect(sharedMarkup).toContain("QA Shared Passenger");
    expect(sharedMarkup).toContain("QA Shared Merchant");
  });

  it("shows how a delivery was confirmed and flags fallbacks with their reason", () => {
    const confirmation = { required: true, total_orders: 1, confirmed_orders: 1, methods: ["receiver_unavailable" as const], flagged: true, reasons: ["Nobody home"] };
    const flagged = { ...detail, delivery_confirmation: confirmation };
    const en = render("en", <TripsManagementView {...props({ detail: flagged, data: { trips: [flagged], page: 1, limit: 25, total: 1 } })} />);
    expect(en).toContain("Delivery confirmation");
    expect(en).toContain("Receiver unavailable");
    expect(en).toContain("Nobody home");
    const ok = { ...detail, delivery_confirmation: { ...confirmation, methods: ["receiver_code" as const], flagged: false, reasons: [] } };
    expect(render("en", <TripsManagementView {...props({ detail: ok, data: { trips: [ok], page: 1, limit: 25, total: 1 } })} />)).toContain("Receiver code");
    const ar = render("ar", <TripsManagementView {...props({ detail: flagged })} />);
    expect(ar).toContain("المستلم غير متوفر");
  });

  it("renders a keyboard-semantic confirmation and bilingual RTL/LTR layout", () => {
    const pending = createTripStatusIntent(legacy)!;
    const en = render("en", <TripsManagementView {...props({ pending })} />);
    const ar = render("ar", <TripsManagementView {...props({ pending })} />);
    expect(en).toContain('dir="ltr"');
    expect(ar).toContain('dir="rtl"');
    expect(en).toContain("Confirm trip transition");
    expect(en).toContain("Confirm");
    expect(ar).toContain("تأكيد انتقال الرحلة");
    expect(ar).toContain("إلغاء المسؤول للرحلة غير متاح");
  });

  it("reloads authoritative list/detail after a stale 409 without reporting success", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "trip_status_conflict" }), { status: 409, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ trips: [{ ...legacy, status: "picked_up" }], page: 1, limit: 25, total: 1 }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ trip: { ...detail, status: "picked_up" } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient("http://api.test");
    const statuses: string[] = [];

    const outcome = await executeTripStatusMutation({
      api,
      token: "admin-token",
      intent: createTripStatusIntent(legacy)!,
      reloadTrips: async () => { statuses.push((await api.adminTrips("admin-token")).trips[0]!.status); },
      reloadDetail: async () => { statuses.push((await api.adminTrip("admin-token", legacy.id)).trip.status); },
    });

    expect(outcome.kind).toBe("conflict");
    expect(statuses).toEqual(["picked_up", "picked_up"]);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "http://api.test/api/v1/admin/trips/trip_legacy/status", expect.objectContaining({
      body: JSON.stringify({ status: "pickup_started", expected_status: "accepted" }),
    }));
  });
});
