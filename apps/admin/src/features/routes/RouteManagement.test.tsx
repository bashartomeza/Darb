// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import adminPackage from "../../../package.json";
import type { CanonicalStop, RouteStopDraft, ServiceRoute, ServiceRouteVersion } from "../../api";
import { translations } from "../../i18n/translations";
import {
  RouteManagement,
  RouteMembershipStopLabel,
  ADMIN_ROUTE_RESPONSIVE_BREAKPOINT,
  handleRouteMutationFailure,
  lifecycleActions,
  mutationFailureIsAuthoritative,
  mutationFingerprint,
  moveRouteStop,
  publicationReadiness,
  reconcileRouteVersionSnapshot,
  routeCatalogView,
  routeCatalogQuery,
  routeConflictRequiresReload,
  routeStatusText,
  routeUsedStopIds,
  routeUiText,
  routeUiError,
  membershipsFromVersion,
  reorderControlLabel,
  stableMutationKey,
  toggleRouteStopPermission
} from "./RouteManagement";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const version: ServiceRouteVersion = {
  id: "version_1",
  service_route_id: "route_1",
  version_number: 1,
  status: "draft",
  name_ar: "الخليل إلى بيت لحم",
  name_en: "Hebron to Bethlehem",
  description_ar: null,
  description_en: null,
  active_from: null,
  active_until: null,
  draft_revision: 1,
  stop_count: 0,
  stops: [],
  geometry: { status: "pending", ready: false }
};

const stops: RouteStopDraft[] = [
  {
    stop_id: "stop_1",
    sequence: 1,
    passenger_pickup_allowed: true,
    passenger_dropoff_allowed: false,
    parcel_pickup_allowed: true,
    parcel_dropoff_allowed: false
  },
  {
    stop_id: "stop_2",
    sequence: 2,
    passenger_pickup_allowed: false,
    passenger_dropoff_allowed: true,
    parcel_pickup_allowed: false,
    parcel_dropoff_allowed: true
  }
];

const canonicalStops: CanonicalStop[] = [
  {
    id: "stop_1",
    stop_key: "ppu-main",
    service_region_key: "south-west-bank",
    name_ar: "جامعة بوليتكنك فلسطين",
    name_en: "Palestine Polytechnic University",
    latitude: 31.507316,
    longitude: 35.090893,
    status: "active"
  },
  {
    id: "stop_2",
    stop_key: "bab-al-zawiya",
    service_region_key: "south-west-bank",
    name_ar: "باب الزاوية",
    name_en: "Bab Al-Zawiya",
    latitude: 31.527513,
    longitude: 35.101859,
    status: "active"
  }
];

const unusedStop: CanonicalStop = {
  id: "stop_3",
  stop_key: "al-haras",
  service_region_key: "south-west-bank",
  name_ar: "الحرس",
  name_en: "Al Haras",
  latitude: 31.5204,
  longitude: 35.0991,
  status: "active"
};

const readyVersion: ServiceRouteVersion & { service_region_key: string } = {
  ...version,
  service_region_key: "south-west-bank",
  name_ar: "الخليل الداخلية",
  name_en: "Hebron local",
  active_from: "2026-08-25T06:00:00.000Z",
  active_until: "2026-08-25T20:00:00.000Z",
  stop_count: 2,
  stops: [
    {
      id: "membership_1",
      stop_id: "stop_1",
      sequence: 1,
      passenger_pickup_allowed: true,
      passenger_dropoff_allowed: false,
      parcel_pickup_allowed: true,
      parcel_dropoff_allowed: false,
      stop: canonicalStops[0]
    },
    {
      id: "membership_2",
      stop_id: "stop_2",
      sequence: 2,
      passenger_pickup_allowed: false,
      passenger_dropoff_allowed: true,
      parcel_pickup_allowed: false,
      parcel_dropoff_allowed: true,
      stop: canonicalStops[1]
    }
  ]
};

let mountedHost: HTMLDivElement | null = null;
let mountedRoot: Root | null = null;

afterEach(() => {
  if (mountedRoot) act(() => mountedRoot?.unmount());
  mountedHost?.remove();
  mountedRoot = null;
  mountedHost = null;
  document.body.replaceChildren();
});

function routeFixture({
  id = "route_context",
  versions = [{ ...readyVersion, id: "version_context", service_route_id: id }],
  currentVersion = null
}: {
  id?: string;
  versions?: ServiceRouteVersion[];
  currentVersion?: ServiceRouteVersion | null;
} = {}): ServiceRoute {
  return {
    id,
    route_key: `${id}-key`,
    route_group_key: `${id}-group`,
    service_region_key: "south-west-bank",
    direction: "outbound",
    status: "active",
    current_version_id: currentVersion?.id ?? null,
    current_version: currentVersion,
    versions,
    version_count: versions.length,
    created_at: "2026-08-25T00:00:00.000Z",
    updated_at: "2026-08-25T00:00:00.000Z"
  };
}

function routeApi(route: ServiceRoute, overrides: Record<string, unknown> = {}) {
  return {
    serviceRoutes: vi.fn().mockResolvedValue({ routes: [route], page: 1, limit: 25, total: 1 }),
    canonicalStops: vi.fn().mockResolvedValue({ stops: [...canonicalStops, unusedStop], page: 1, limit: 50, total: 3 }),
    serviceRoute: vi.fn().mockResolvedValue({ route }),
    ...overrides
  };
}

async function mountManagement(api: Record<string, unknown>, locale: "ar" | "en" = "en") {
  mountedHost = document.createElement("div");
  document.body.append(mountedHost);
  mountedRoot = createRoot(mountedHost);
  await act(async () => {
    mountedRoot?.render(<RouteManagement api={api as never} token="token" locale={locale} />);
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return mountedHost;
}

async function settleUi() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function buttonNamed(host: ParentNode, name: string) {
  return [...host.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name)!;
}

function enterValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function openOnlyRoute(host: HTMLElement) {
  const row = host.querySelector<HTMLElement>(".route-directory__row")!;
  await act(async () => {
    row.querySelector<HTMLButtonElement>("button")!.click();
    await Promise.resolve();
  });
  await settleUi();
}

function selectWorkspaceTab(host: HTMLElement, name: string) {
  act(() => buttonNamed(host.querySelector('[role="tablist"]')!, name).click());
}

async function confirmLifecycleAction(host: HTMLElement, action: string, reason?: string) {
  act(() => buttonNamed(host, "Route actions").click());
  act(() => buttonNamed(host.querySelector('[role="menu"]')!, action).click());
  if (reason) enterValue(host.querySelector<HTMLInputElement>('input[name="reason"]')!, reason);
  await act(async () => {
    buttonNamed(host.querySelector('[role="dialog"]')!, "Confirm").click();
    await Promise.resolve();
  });
  await settleUi();
}

describe("admin route management", () => {
  it("models loading, empty, error, and populated catalog states", () => {
    expect(routeCatalogView({ loading: true, error: false, count: 0 })).toBe("loading");
    expect(routeCatalogView({ loading: false, error: true, count: 0 })).toBe("error");
    expect(routeCatalogView({ loading: false, error: false, count: 0 })).toBe("empty");
    expect(routeCatalogView({ loading: false, error: false, count: 1 })).toBe("ready");
  });

  it("renders the directory-first Arabic and English landing surface without an inline create form", () => {
    const arabic = renderToStaticMarkup(<RouteManagement api={{} as never} token="token" locale="ar" />);
    const english = renderToStaticMarkup(<RouteManagement api={{} as never} token="token" locale="en" />);
    expect(arabic).toContain("إدارة المسارات");
    expect(arabic).toContain("جارٍ تحميل كتالوج المسارات");
    expect(arabic).toContain("إنشاء مسار");
    expect(arabic).toContain("تصفية منطقة الخدمة");
    expect(arabic).not.toContain("الاسم بالعربية");
    expect(arabic).not.toContain("معاينة الخريطة غير متاحة");
    expect(english).toContain("Route management");
    expect(english).toContain("Loading the route catalog");
    expect(english).toContain("Create route");
    expect(english).toContain("Service region filter");
    expect(english).not.toContain("Arabic name");
    expect(english).not.toContain("Create stop");
    expect(english).not.toContain("Action reason");
    expect(english).not.toContain("Map preview unavailable");
  });

  it("shows one sanitized page notice when the directory load fails", async () => {
    const host = await mountManagement({
      serviceRoutes: vi.fn().mockRejectedValue(new Error("private_catalog_load_detail")),
      canonicalStops: vi.fn().mockResolvedValue({ stops: [], page: 1, limit: 50, total: 0 })
    });

    const notice = host.querySelector(".route-management > .notice--error");
    expect(notice?.textContent).toBe("The action could not be completed. Retry or use the request ID for support.");
    expect(host.querySelectorAll(".notice--error")).toHaveLength(1);
    expect(host.textContent).not.toContain("private_catalog_load_detail");
  });

  it("retains a sanitized route-detail load failure after returning to the directory", async () => {
    const route = routeFixture({ id: "route_detail_load_failure" });
    const host = await mountManagement(routeApi(route, {
      serviceRoute: vi.fn().mockRejectedValue(new Error("private_route_detail_load"))
    }));

    await openOnlyRoute(host);
    act(() => buttonNamed(host, "Back to routes").click());

    expect(host.querySelector(".route-directory")).not.toBeNull();
    expect(host.querySelector(".route-management > .notice--error")?.textContent)
      .toBe("The action could not be completed. Retry or use the request ID for support.");
    expect(host.querySelectorAll(".notice--error")).toHaveLength(1);
    expect(host.textContent).not.toContain("private_route_detail_load");
  });

  it("emits all bounded directory filters while preserving the fixed page size", () => {
    expect(routeCatalogQuery({
      page: 2,
      search: "Hebron",
      status: "active",
      direction: "outbound",
      serviceRegionKey: "south-west-bank"
    }).toString()).toBe("page=2&limit=25&search=Hebron&status=active&direction=outbound&service_region_key=south-west-bank");
  });

  it("advises on missing bilingual names, minimum stops, and invalid date order", () => {
    expect(publicationReadiness({ ...readyVersion, name_ar: " " }, canonicalStops)).toEqual(["readinessMissingNames"]);
    expect(publicationReadiness({ ...readyVersion, stops: [readyVersion.stops[0]], stop_count: 1 }, canonicalStops)).toEqual([
      "readinessMinimumStops",
      "readinessPassengerPath",
      "readinessParcelPath"
    ]);
    expect(publicationReadiness({
      ...readyVersion,
      active_from: "2026-08-25T20:00:00.000Z",
      active_until: "2026-08-25T06:00:00.000Z"
    }, canonicalStops)).toEqual(["readinessDateOrder"]);
  });

  it("advises when a route membership references an inactive or foreign-region stop", () => {
    const inactive = { ...canonicalStops[1], status: "retired" as const };
    expect(publicationReadiness({
      ...readyVersion,
      stops: [readyVersion.stops[0], { ...readyVersion.stops[1], stop: inactive }]
    }, [canonicalStops[0], inactive])).toEqual(["readinessStopEligibility"]);

    const foreign = { ...canonicalStops[1], service_region_key: "central-west-bank" };
    expect(publicationReadiness({
      ...readyVersion,
      stops: [readyVersion.stops[0], { ...readyVersion.stops[1], stop: foreign }]
    }, [canonicalStops[0], foreign])).toEqual(["readinessStopEligibility"]);
  });

  it("advises on absent downstream passenger and inconsistent parcel paths", () => {
    const noPassengerPath = {
      ...readyVersion,
      stops: readyVersion.stops.map((membership) => ({ ...membership, passenger_dropoff_allowed: false }))
    };
    expect(publicationReadiness(noPassengerPath, canonicalStops)).toEqual(["readinessPassengerPath"]);

    const inconsistentParcelPath = {
      ...readyVersion,
      stops: readyVersion.stops.map((membership, index) => ({
        ...membership,
        parcel_pickup_allowed: index === 1,
        parcel_dropoff_allowed: index === 0
      }))
    };
    expect(publicationReadiness(inconsistentParcelPath, canonicalStops)).toEqual(["readinessParcelPath"]);
  });

  it("reconciles a saved stop replacement into version tabs and used-stop eligibility", () => {
    const staleVersion = {
      ...readyVersion,
      draft_revision: 1,
      stop_count: 1,
      stops: [readyVersion.stops[0]]
    };
    const route: ServiceRoute = {
      id: "route_1",
      route_key: "hebron-local",
      route_group_key: "hebron",
      service_region_key: "south-west-bank",
      direction: "loop",
      status: "active",
      current_version_id: null,
      current_version: null,
      versions: [staleVersion],
      version_count: 1,
      created_at: "2026-08-25T00:00:00.000Z",
      updated_at: "2026-08-25T00:00:00.000Z"
    };
    const savedVersion = { ...readyVersion, draft_revision: 2 };

    const reconciled = reconcileRouteVersionSnapshot(route, savedVersion);

    expect(reconciled.versions?.[0]).toEqual(savedVersion);
    expect(reconciled.versions?.[0].draft_revision).toBe(2);
    expect(reconciled.versions?.[0].stops.map((membership) => membership.stop_id)).toEqual(["stop_1", "stop_2"]);
    expect([...routeUsedStopIds(reconciled)]).toEqual(["stop_1", "stop_2"]);
  });

  it("renders embedded bilingual membership Stops beyond the bounded catalog with an isolated ID fallback", () => {
    const english = renderToStaticMarkup(
      <RouteMembershipStopLabel
        membership={stops[1]}
        version={readyVersion}
        stops={[canonicalStops[0]]}
        locale="en"
      />
    );
    const arabic = renderToStaticMarkup(
      <RouteMembershipStopLabel
        membership={stops[1]}
        version={readyVersion}
        stops={[canonicalStops[0]]}
        locale="ar"
      />
    );
    const fallback = renderToStaticMarkup(
      <RouteMembershipStopLabel
        membership={{ ...stops[1], stop_id: "stop_outside_both_bounds" }}
        version={{ ...readyVersion, stops: [] }}
        stops={[]}
        locale="en"
      />
    );

    expect(english).toContain("Bab Al-Zawiya");
    expect(arabic).toContain("باب الزاوية");
    expect(english).not.toContain("stop_2");
    expect(fallback).toContain('dir="ltr"');
    expect(fallback).toContain('class="technical-value"');
    expect(fallback).toContain("stop_outside_both_bounds");
  });

  it("renders distinct localized directory filters without making map status part of the landing header", () => {
    const english = renderToStaticMarkup(<RouteManagement api={{} as never} token="token" locale="en" />);
    const arabic = renderToStaticMarkup(<RouteManagement api={{} as never} token="token" locale="ar" />);

    for (const label of ["Route status filter", "Direction filter", "Service region filter"]) expect(english).toContain(label);
    expect(arabic).toContain("تصفية حالة المسار");
    expect(english).not.toContain("Map preview unavailable");
  });

  const contextualFailureCases: Array<{
    operation: string;
    scope: "create-route" | "version-editor" | "stop-editor" | "stops" | "lifecycle";
    container: string;
    exercise: () => Promise<HTMLElement>;
  }> = [
    {
      operation: "route create",
      scope: "create-route",
      container: "#create-route-form",
      exercise: async () => {
        const route = routeFixture();
        const host = await mountManagement(routeApi(route, {
          createServiceRoute: vi.fn().mockRejectedValue(new Error("private_route_create_detail"))
        }));
        act(() => buttonNamed(host, "Create route").click());
        const form = host.querySelector<HTMLFormElement>("#create-route-form")!;
        enterValue(form.querySelector<HTMLInputElement>('input[name="route_key"]')!, "scope-route");
        enterValue(form.querySelector<HTMLInputElement>('input[name="route_group_key"]')!, "scope-group");
        enterValue(form.querySelector<HTMLInputElement>('input[name="service_region_key"]')!, "south-west-bank");
        await act(async () => {
          form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
          await Promise.resolve();
        });
        await settleUi();
        return host;
      }
    },
    {
      operation: "draft save",
      scope: "version-editor",
      container: ".route-versions__workspace",
      exercise: async () => {
        const route = routeFixture();
        const host = await mountManagement(routeApi(route, {
          updateRouteVersion: vi.fn().mockRejectedValue(new Error("private_draft_save_detail"))
        }));
        await openOnlyRoute(host);
        selectWorkspaceTab(host, "Versions");
        act(() => buttonNamed(host, "Edit draft").click());
        const form = host.querySelector<HTMLFormElement>(".route-version-editor form")!;
        await act(async () => {
          form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
          await Promise.resolve();
        });
        await settleUi();
        return host;
      }
    },
    {
      operation: "stop create",
      scope: "stop-editor",
      container: '[role="dialog"]',
      exercise: async () => {
        const route = routeFixture();
        const host = await mountManagement(routeApi(route, {
          createCanonicalStop: vi.fn().mockRejectedValue(new Error("private_stop_create_detail"))
        }));
        await openOnlyRoute(host);
        selectWorkspaceTab(host, "Stops");
        act(() => buttonNamed(host, "Create new stop").click());
        const form = host.querySelector<HTMLFormElement>(".route-stops__create-form")!;
        enterValue(form.querySelector<HTMLInputElement>('input[name="latitude"]')!, "0");
        enterValue(form.querySelector<HTMLInputElement>('input[name="longitude"]')!, "0");
        await act(async () => {
          form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
          await Promise.resolve();
        });
        await settleUi();
        return host;
      }
    },
    {
      operation: "stop edit",
      scope: "stop-editor",
      container: '[role="dialog"]',
      exercise: async () => {
        const route = routeFixture();
        const host = await mountManagement(routeApi(route, {
          updateCanonicalStop: vi.fn().mockRejectedValue(new Error("private_stop_edit_detail"))
        }));
        await openOnlyRoute(host);
        selectWorkspaceTab(host, "Stops");
        const unusedStopCard = host.querySelector<HTMLElement>('[data-stop-id="stop_3"]')!;
        act(() => buttonNamed(unusedStopCard, "Edit").click());
        const form = host.querySelector<HTMLFormElement>(".stop-editor-form")!;
        await act(async () => {
          form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
          await Promise.resolve();
        });
        await settleUi();
        return host;
      }
    },
    {
      operation: "stop order",
      scope: "stops",
      container: ".route-stops__order",
      exercise: async () => {
        const route = routeFixture();
        const host = await mountManagement(routeApi(route, {
          replaceRouteStops: vi.fn().mockRejectedValue(new Error("private_stop_order_detail"))
        }));
        await openOnlyRoute(host);
        selectWorkspaceTab(host, "Stops");
        await act(async () => {
          buttonNamed(host, "Save order").click();
          await Promise.resolve();
        });
        await settleUi();
        return host;
      }
    },
    {
      operation: "readiness publish",
      scope: "lifecycle",
      container: ".route-overview__section",
      exercise: async () => {
        const route = routeFixture();
        const host = await mountManagement(routeApi(route, {
          publishRouteVersion: vi.fn().mockRejectedValue(new Error("private_publish_detail"))
        }));
        await openOnlyRoute(host);
        await confirmLifecycleAction(host, "Publish");
        return host;
      }
    },
    {
      operation: "current-version lifecycle",
      scope: "lifecycle",
      container: ".route-overview__section",
      exercise: async () => {
        const published = { ...readyVersion, id: "version_published_scope", service_route_id: "route_lifecycle_scope", status: "published" as const };
        const route = routeFixture({ id: "route_lifecycle_scope", versions: [published], currentVersion: published });
        const host = await mountManagement(routeApi(route, {
          routeVersionAction: vi.fn().mockRejectedValue(new Error("private_lifecycle_detail"))
        }));
        await openOnlyRoute(host);
        await confirmLifecycleAction(host, "Pause", "Scheduled service review");
        return host;
      }
    }
  ];

  it.each(contextualFailureCases)(
    "$operation failure stays in the hand-selected $scope feedback scope",
    async ({ container, exercise }) => {
      const host = await exercise();
      const scopedNotice = host.querySelector(`${container} .notice--error`);

      expect(scopedNotice?.textContent).toBe("The action could not be completed. Retry or use the request ID for support.");
      expect(host.querySelectorAll(".notice--error")).toHaveLength(1);
      expect(host.textContent).not.toMatch(/private_(route_create|draft_save|stop_create|stop_edit|stop_order|publish|lifecycle)_detail/);
    }
  );

  it("shows successful create feedback in the opened route workspace", async () => {
    const createdRoute: ServiceRoute = {
      id: "route_created",
      route_key: "hebron-local",
      route_group_key: "hebron",
      service_region_key: "south-west-bank",
      direction: "outbound",
      status: "active",
      current_version_id: version.id,
      current_version: { ...version, service_route_id: "route_created", name_en: "Created Hebron route" },
      versions: [{ ...version, service_route_id: "route_created", name_en: "Created Hebron route" }],
      version_count: 1,
      created_at: "2026-08-25T00:00:00.000Z",
      updated_at: "2026-08-25T00:00:00.000Z"
    };
    const api = {
      serviceRoutes: vi.fn().mockResolvedValue({ routes: [createdRoute], page: 1, limit: 25, total: 1 }),
      canonicalStops: vi.fn().mockResolvedValue({ stops: [], page: 1, limit: 50, total: 0 }),
      createServiceRoute: vi.fn().mockResolvedValue({ route: createdRoute }),
      serviceRoute: vi.fn().mockResolvedValue({ route: createdRoute })
    };
    mountedHost = document.createElement("div");
    document.body.append(mountedHost);
    mountedRoot = createRoot(mountedHost);

    await act(async () => { mountedRoot?.render(<RouteManagement api={api as never} token="token" locale="en" />); });
    await act(async () => { await Promise.resolve(); });
    const create = [...mountedHost.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Create route")!;
    act(() => create.click());
    const form = mountedHost.querySelector<HTMLFormElement>("#create-route-form")!;

    for (const [name, value] of Object.entries({ route_key: " hebron-local ", route_group_key: " hebron ", service_region_key: " south-west-bank " })) {
      const input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      act(() => {
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    expect(new FormData(form).get("route_key")).toBe(" hebron-local ");
    expect(new FormData(form).get("route_group_key")).toBe(" hebron ");
    expect(new FormData(form).get("service_region_key")).toBe(" south-west-bank ");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); });

    expect(api.createServiceRoute).toHaveBeenCalledOnce();
    expect(mountedHost.textContent).toContain("Created Hebron route");
    expect(mountedHost.textContent).toContain("Saved successfully.");
    expect(mountedHost.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps a create conflict and failed catalog reconciliation contextual without replacing the directory", async () => {
    const existingRoute = routeFixture({ id: "route_existing_after_create_conflict" });
    const api = routeApi(existingRoute, {
      serviceRoutes: vi.fn()
        .mockResolvedValueOnce({ routes: [existingRoute], page: 1, limit: 25, total: 1 })
        .mockRejectedValueOnce(new Error("catalog_reconciliation_failed")),
      createServiceRoute: vi.fn().mockRejectedValue(Object.assign(new Error("resource_conflict"), { status: 409 }))
    });
    const host = await mountManagement(api);
    act(() => buttonNamed(host, "Create route").click());
    const form = host.querySelector<HTMLFormElement>("#create-route-form")!;
    enterValue(form.querySelector<HTMLInputElement>('input[name="route_key"]')!, "conflicting-route");
    enterValue(form.querySelector<HTMLInputElement>('input[name="route_group_key"]')!, "conflicting-group");
    enterValue(form.querySelector<HTMLInputElement>('input[name="service_region_key"]')!, "south-west-bank");

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    await settleUi();

    expect(host.querySelector("#create-route-form")).not.toBeNull();
    expect(host.querySelector(".route-directory__row")).not.toBeNull();
    expect(host.querySelector(".route-directory__error")).toBeNull();
    expect(host.querySelectorAll(".notice--error")).toHaveLength(1);
    expect(host.querySelector("#create-route-form .notice--error")?.textContent).toBe(routeUiText("en").reloadFailed);
    expect(host.textContent).not.toContain("catalog_reconciliation_failed");
  });

  it("does not carry route A lifecycle feedback through Back into route B", async () => {
    const draftA = { ...readyVersion, id: "version_a", service_route_id: "route_a", name_en: "Route Alpha" };
    const draftB = { ...readyVersion, id: "version_b", service_route_id: "route_b", name_en: "Route Beta" };
    const routeA: ServiceRoute = {
      id: "route_a",
      route_key: "route-alpha",
      route_group_key: "route-alpha",
      service_region_key: "south-west-bank",
      direction: "outbound",
      status: "active",
      current_version_id: draftA.id,
      current_version: draftA,
      versions: [draftA],
      version_count: 1,
      created_at: "2026-08-25T00:00:00.000Z",
      updated_at: "2026-08-25T00:00:00.000Z"
    };
    const routeB: ServiceRoute = {
      ...routeA,
      id: "route_b",
      route_key: "route-beta",
      route_group_key: "route-beta",
      current_version_id: draftB.id,
      current_version: draftB,
      versions: [draftB]
    };
    const api = {
      serviceRoutes: vi.fn().mockResolvedValue({ routes: [routeA, routeB], page: 1, limit: 25, total: 2 }),
      canonicalStops: vi.fn().mockResolvedValue({ stops: canonicalStops, page: 1, limit: 50, total: 2 }),
      serviceRoute: vi.fn().mockImplementation(async (_token: string, routeId: string) => ({ route: routeId === routeA.id ? routeA : routeB })),
      publishRouteVersion: vi.fn().mockResolvedValue({ version: { ...draftA, status: "published" as const } })
    };
    mountedHost = document.createElement("div");
    document.body.append(mountedHost);
    mountedRoot = createRoot(mountedHost);

    await act(async () => { mountedRoot?.render(<RouteManagement api={api as never} token="token" locale="en" />); });
    await act(async () => { await Promise.resolve(); });
    const alphaRow = [...mountedHost.querySelectorAll<HTMLElement>(".route-directory__row")]
      .find((row) => row.textContent?.includes("Route Alpha"))!;
    await act(async () => { alphaRow.querySelector<HTMLButtonElement>("button")!.click(); await Promise.resolve(); });

    const actions = [...mountedHost.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Route actions")!;
    act(() => actions.click());
    const publish = [...mountedHost.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Publish")!;
    act(() => publish.click());
    const confirm = [...mountedHost.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Confirm")!;
    await act(async () => { confirm.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(mountedHost.textContent).toContain("Saved successfully.");

    const back = [...mountedHost.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Back to routes")!;
    act(() => back.click());
    const betaRow = [...mountedHost.querySelectorAll<HTMLElement>(".route-directory__row")]
      .find((row) => row.textContent?.includes("Route Beta"))!;
    await act(async () => { betaRow.querySelector<HTMLButtonElement>("button")!.click(); await Promise.resolve(); });

    expect(mountedHost.textContent).toContain("Route Beta");
    expect(mountedHost.textContent).not.toContain("Saved successfully.");
  });

  it("keeps the Versions tab focused and reloads the authoritative selected draft after a save conflict", async () => {
    const initialDraft = { ...readyVersion, id: "version_conflict", service_route_id: "route_conflict", name_en: "Before conflict", draft_revision: 4 };
    const authoritativeDraft = { ...initialDraft, name_en: "After conflict", draft_revision: 5 };
    const initialRoute: ServiceRoute = {
      id: "route_conflict",
      route_key: "conflict-route",
      route_group_key: "conflict-route",
      service_region_key: "south-west-bank",
      direction: "outbound",
      status: "active",
      current_version_id: null,
      current_version: null,
      versions: [initialDraft],
      version_count: 1,
      created_at: "2026-08-25T00:00:00.000Z",
      updated_at: "2026-08-25T00:00:00.000Z"
    };
    const authoritativeRoute = { ...initialRoute, versions: [authoritativeDraft] };
    const api = {
      serviceRoutes: vi.fn().mockResolvedValue({ routes: [initialRoute], page: 1, limit: 25, total: 1 }),
      canonicalStops: vi.fn().mockResolvedValue({ stops: canonicalStops, page: 1, limit: 50, total: 2 }),
      serviceRoute: vi.fn().mockResolvedValueOnce({ route: initialRoute }).mockResolvedValueOnce({ route: authoritativeRoute }),
      updateRouteVersion: vi.fn().mockRejectedValue(Object.assign(new Error("draft_revision_conflict"), { status: 409 }))
    };
    mountedHost = document.createElement("div");
    document.body.append(mountedHost);
    mountedRoot = createRoot(mountedHost);

    await act(async () => { mountedRoot?.render(<RouteManagement api={api as never} token="token" locale="en" />); });
    await act(async () => { await Promise.resolve(); });
    const routeRow = mountedHost.querySelector<HTMLElement>(".route-directory__row")!;
    await act(async () => { routeRow.querySelector<HTMLButtonElement>("button")!.click(); await Promise.resolve(); });
    const versionsTab = [...mountedHost.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((tab) => tab.textContent === "Versions")!;
    act(() => versionsTab.click());

    const edit = [...mountedHost.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Edit draft")!;
    act(() => edit.click());
    const form = mountedHost.querySelector<HTMLFormElement>(".route-version-editor form")!;
    const name = form.querySelector<HTMLInputElement>('input[name="name_en"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(name, "Unsaved local edit");
      name.dispatchEvent(new Event("input", { bubbles: true }));
      name.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); await Promise.resolve(); });

    expect(api.updateRouteVersion).toHaveBeenCalledWith("token", "version_conflict", expect.objectContaining({
      name_en: "Unsaved local edit",
      expected_revision: 4
    }));
    expect(api.serviceRoute).toHaveBeenCalledTimes(2);
    expect(mountedHost.querySelector('[data-selected-route-id="route_conflict"]')).not.toBeNull();
    expect(versionsTab.getAttribute("aria-selected")).toBe("true");
    expect(mountedHost.textContent).toContain("After conflict");
    expect(mountedHost.textContent).toContain("The latest authoritative version was reloaded");
    expect(mountedHost.textContent).not.toContain("Saved successfully.");
    expect(mountedHost.textContent).not.toContain("Save changes");
  });

  it("keeps the Stops tab and selected draft while reconciling authoritative order after one 409 reload", async () => {
    const selectedDraft = {
      ...readyVersion,
      id: "version_stop_conflict",
      service_route_id: "route_stop_conflict",
      name_en: "Stop conflict draft",
      draft_revision: 8
    };
    const authoritativeDraft = {
      ...selectedDraft,
      draft_revision: 9,
      stops: [selectedDraft.stops[1], selectedDraft.stops[0]].map((membership, index) => ({ ...membership, sequence: index + 1 }))
    };
    const initialRoute = routeFixture({ id: "route_stop_conflict", versions: [selectedDraft] });
    const authoritativeRoute = routeFixture({ id: "route_stop_conflict", versions: [authoritativeDraft] });
    const serviceRoute = vi.fn()
      .mockResolvedValueOnce({ route: initialRoute })
      .mockResolvedValueOnce({ route: authoritativeRoute });
    const api = routeApi(initialRoute, {
      serviceRoute,
      replaceRouteStops: vi.fn().mockRejectedValue(Object.assign(new Error("draft_revision_conflict"), { status: 409 }))
    });
    const host = await mountManagement(api);
    await openOnlyRoute(host);
    selectWorkspaceTab(host, "Stops");

    await act(async () => {
      buttonNamed(host, "Save order").click();
      await Promise.resolve();
    });
    await settleUi();

    const stopsTab = buttonNamed(host.querySelector('[role="tablist"]')!, "Stops");
    const renderedStops = [...host.querySelectorAll<HTMLElement>(".route-stops__item")];
    expect(serviceRoute).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[data-selected-route-id="route_stop_conflict"]')).not.toBeNull();
    expect(stopsTab.getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector(".route-workspace__identity")?.textContent).toContain("version_stop_conflict");
    expect(renderedStops.map((item) => item.dataset.stopId)).toEqual(["stop_2", "stop_1"]);
    expect(host.querySelector(".route-stops__order .notice--error")?.textContent)
      .toContain("The latest authoritative stop order was reloaded");
    expect(host.textContent).not.toContain("Saved successfully.");
  });

  it("keeps the Overview tab and selects the authoritative current version after one route-lifecycle 409 reload", async () => {
    const staleDraft = {
      ...readyVersion,
      id: "version_stale_publish",
      service_route_id: "route_lifecycle_conflict",
      name_en: "Stale publish draft",
      draft_revision: 3
    };
    const newestDraft = {
      ...readyVersion,
      id: "version_newest_draft",
      service_route_id: "route_lifecycle_conflict",
      version_number: 3,
      name_en: "Newer draft",
      draft_revision: 1
    };
    const authoritativeCurrent = {
      ...readyVersion,
      id: "version_authoritative_current",
      service_route_id: "route_lifecycle_conflict",
      version_number: 2,
      name_en: "Authoritative published version",
      status: "published" as const
    };
    const initialRoute = routeFixture({ id: "route_lifecycle_conflict", versions: [staleDraft] });
    const authoritativeRoute = routeFixture({
      id: "route_lifecycle_conflict",
      versions: [newestDraft, authoritativeCurrent],
      currentVersion: authoritativeCurrent
    });
    const serviceRoute = vi.fn()
      .mockResolvedValueOnce({ route: initialRoute })
      .mockResolvedValueOnce({ route: authoritativeRoute });
    const api = routeApi(initialRoute, {
      serviceRoute,
      retireServiceRoute: vi.fn().mockRejectedValue(Object.assign(new Error("current_version_conflict"), { status: 409 }))
    });
    const host = await mountManagement(api);
    await openOnlyRoute(host);

    await confirmLifecycleAction(host, "Retire route", "Route ownership changed");

    const overviewTab = buttonNamed(host.querySelector('[role="tablist"]')!, "Overview");
    expect(serviceRoute).toHaveBeenCalledTimes(2);
    expect(api.serviceRoutes).toHaveBeenCalledOnce();
    expect(api.canonicalStops).toHaveBeenCalledOnce();
    expect(host.querySelector('[data-selected-route-id="route_lifecycle_conflict"]')).not.toBeNull();
    expect(overviewTab.getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector(".route-workspace__identity")?.textContent).toContain("version_authoritative_current");
    expect(host.querySelector(".route-workspace__identity")?.textContent).not.toContain("version_newest_draft");
    expect(host.querySelector(".route-overview__section .notice--error")?.textContent)
      .toBe("The route status changed. The latest authoritative route data was reloaded.");
    expect(host.textContent).not.toContain("Saved successfully.");
  });

  it("shows retirement success only after returning to the refreshed directory", async () => {
    const published = {
      ...readyVersion,
      id: "version_retire_success",
      service_route_id: "route_retire_success",
      status: "published" as const
    };
    const route = routeFixture({ id: published.service_route_id, versions: [published], currentVersion: published });
    const serviceRoutes = vi.fn()
      .mockResolvedValueOnce({ routes: [route], page: 1, limit: 25, total: 1 })
      .mockResolvedValueOnce({ routes: [], page: 1, limit: 25, total: 0 });
    const retireServiceRoute = vi.fn().mockResolvedValue({ route: { ...route, status: "retired" as const } });
    const host = await mountManagement(routeApi(route, { serviceRoutes, retireServiceRoute }));
    await openOnlyRoute(host);

    await confirmLifecycleAction(host, "Retire route", "Service withdrawn");

    expect(retireServiceRoute).toHaveBeenCalledWith(
      "token",
      route.id,
      { reason: "Service withdrawn", expected_current_version_id: null },
      expect.any(String)
    );
    expect(serviceRoutes).toHaveBeenCalledTimes(2);
    expect(host.querySelector(".route-directory")).not.toBeNull();
    expect(host.querySelector('[data-selected-route-id="route_retire_success"]')).toBeNull();
    expect(host.querySelector(".route-management > .notice--success")?.textContent).toBe("Saved successfully.");
    expect(host.querySelectorAll(".notice")).toHaveLength(1);
  });

  it("returns to the directory error surface when post-retirement catalog reload fails", async () => {
    const published = {
      ...readyVersion,
      id: "version_retire_reload_failure",
      service_route_id: "route_retire_reload_failure",
      status: "published" as const
    };
    const route = routeFixture({ id: published.service_route_id, versions: [published], currentVersion: published });
    const serviceRoutes = vi.fn()
      .mockResolvedValueOnce({ routes: [route], page: 1, limit: 25, total: 1 })
      .mockRejectedValueOnce(new Error("catalog_reload_failed"));
    const retireServiceRoute = vi.fn().mockResolvedValue({ route: { ...route, status: "retired" as const } });
    const host = await mountManagement(routeApi(route, { serviceRoutes, retireServiceRoute }));
    await openOnlyRoute(host);

    await confirmLifecycleAction(host, "Retire route", "Service withdrawn");

    expect(retireServiceRoute).toHaveBeenCalledOnce();
    expect(host.querySelector(".route-directory")).not.toBeNull();
    expect(host.querySelector(".route-directory__results")?.textContent).toContain("The route catalog could not be loaded.");
    expect(host.querySelector('[data-selected-route-id="route_retire_reload_failure"]')).toBeNull();
    expect(host.textContent).not.toContain("Saved successfully.");
    expect(host.textContent).not.toContain("catalog_reload_failed");
  });

  it("shows a create-draft reload failure beside the Versions workspace instead of page-wide", async () => {
    const initialRoute: ServiceRoute = {
      id: "route_create_reload",
      route_key: "create-reload-route",
      route_group_key: "create-reload-route",
      service_region_key: "south-west-bank",
      direction: "outbound",
      status: "active",
      current_version_id: null,
      current_version: null,
      versions: [],
      version_count: 0,
      created_at: "2026-08-25T00:00:00.000Z",
      updated_at: "2026-08-25T00:00:00.000Z"
    };
    const createdVersion = { ...readyVersion, id: "version_created", service_route_id: initialRoute.id, name_en: "Created before reload failure" };
    const api = {
      serviceRoutes: vi.fn().mockResolvedValue({ routes: [initialRoute], page: 1, limit: 25, total: 1 }),
      canonicalStops: vi.fn().mockResolvedValue({ stops: canonicalStops, page: 1, limit: 50, total: 2 }),
      serviceRoute: vi.fn().mockResolvedValueOnce({ route: initialRoute }).mockRejectedValueOnce(new Error("route_reload_failed")),
      createRouteVersion: vi.fn().mockResolvedValue({ version: createdVersion })
    };
    mountedHost = document.createElement("div");
    document.body.append(mountedHost);
    mountedRoot = createRoot(mountedHost);

    await act(async () => { mountedRoot?.render(<RouteManagement api={api as never} token="token" locale="en" />); });
    await act(async () => { await Promise.resolve(); });
    const row = mountedHost.querySelector<HTMLElement>(".route-directory__row")!;
    await act(async () => { row.querySelector<HTMLButtonElement>("button")!.click(); await Promise.resolve(); });
    act(() => [...mountedHost!.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) => tab.textContent === "Versions")!.click());
    act(() => [...mountedHost!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Create version")!.click());
    const form = mountedHost.querySelector<HTMLFormElement>(".route-version-create form")!;
    const arabic = form.querySelector<HTMLInputElement>('input[name="name_ar"]')!;
    const english = form.querySelector<HTMLInputElement>('input[name="name_en"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(arabic, "مسودة جديدة");
      arabic.dispatchEvent(new Event("input", { bubbles: true }));
      setter.call(english, "New draft");
      english.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); await Promise.resolve(); });

    const workspaceNotice = mountedHost.querySelector(".route-versions__workspace .notice--error");
    expect(workspaceNotice).not.toBeNull();
    expect(workspaceNotice?.textContent).toContain(routeUiText("en").reloadFailed);
    expect(mountedHost.querySelector("section.stack > .notice")).toBeNull();
  });

  it("shows a saved-draft reload failure beside the Versions workspace instead of page-wide", async () => {
    const draft = { ...readyVersion, id: "version_save_reload", service_route_id: "route_save_reload", name_en: "Before save reload failure", draft_revision: 7 };
    const initialRoute: ServiceRoute = {
      id: "route_save_reload",
      route_key: "save-reload-route",
      route_group_key: "save-reload-route",
      service_region_key: "south-west-bank",
      direction: "outbound",
      status: "active",
      current_version_id: null,
      current_version: null,
      versions: [draft],
      version_count: 1,
      created_at: "2026-08-25T00:00:00.000Z",
      updated_at: "2026-08-25T00:00:00.000Z"
    };
    const api = {
      serviceRoutes: vi.fn().mockResolvedValue({ routes: [initialRoute], page: 1, limit: 25, total: 1 }),
      canonicalStops: vi.fn().mockResolvedValue({ stops: canonicalStops, page: 1, limit: 50, total: 2 }),
      serviceRoute: vi.fn().mockResolvedValueOnce({ route: initialRoute }).mockRejectedValueOnce(new Error("route_reload_failed")),
      updateRouteVersion: vi.fn().mockResolvedValue({ version: { ...draft, draft_revision: 8 } })
    };
    mountedHost = document.createElement("div");
    document.body.append(mountedHost);
    mountedRoot = createRoot(mountedHost);

    await act(async () => { mountedRoot?.render(<RouteManagement api={api as never} token="token" locale="en" />); });
    await act(async () => { await Promise.resolve(); });
    const row = mountedHost.querySelector<HTMLElement>(".route-directory__row")!;
    await act(async () => { row.querySelector<HTMLButtonElement>("button")!.click(); await Promise.resolve(); });
    act(() => [...mountedHost!.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) => tab.textContent === "Versions")!.click());
    act(() => [...mountedHost!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Edit draft")!.click());
    const form = mountedHost.querySelector<HTMLFormElement>(".route-version-editor form")!;
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); await Promise.resolve(); });

    const workspaceNotice = mountedHost.querySelector(".route-versions__workspace .notice--error");
    expect(workspaceNotice).not.toBeNull();
    expect(workspaceNotice?.textContent).toContain(routeUiText("en").reloadFailed);
    expect(mountedHost.querySelector("section.stack > .notice")).toBeNull();
  });

  it("keeps a stop-order conflict reload failure in the Stops workspace", async () => {
    const draft = {
      ...readyVersion,
      id: "version_stop_reload_failure",
      service_route_id: "route_stop_reload_failure",
      draft_revision: 5
    };
    const route = routeFixture({ id: draft.service_route_id, versions: [draft] });
    const serviceRoute = vi.fn()
      .mockResolvedValueOnce({ route })
      .mockRejectedValueOnce(new Error("route_reload_failed"));
    const replaceRouteStops = vi.fn()
      .mockRejectedValue(Object.assign(new Error("draft_revision_conflict"), { status: 409 }));
    const host = await mountManagement(routeApi(route, { serviceRoute, replaceRouteStops }));
    await openOnlyRoute(host);
    selectWorkspaceTab(host, "Stops");

    await act(async () => {
      buttonNamed(host, "Save order").click();
      await Promise.resolve();
    });
    await settleUi();

    expect(replaceRouteStops).toHaveBeenCalledWith("token", draft.id, {
      expected_revision: 5,
      stops: expect.any(Array)
    });
    expect(serviceRoute).toHaveBeenCalledTimes(2);
    expect(host.querySelector(".route-stops__order .notice--error")?.textContent).toBe(routeUiText("en").reloadFailed);
    expect(host.querySelectorAll(".notice--error")).toHaveLength(1);
    expect(host.querySelector("section.stack > .notice")).toBeNull();
  });

  it.each(["success", "conflict"] as const)(
    "keeps a clone %s reload failure in lifecycle feedback",
    async (outcome) => {
      const published = {
        ...readyVersion,
        id: `version_clone_reload_${outcome}`,
        service_route_id: `route_clone_reload_${outcome}`,
        status: "published" as const
      };
      const route = routeFixture({ id: published.service_route_id, versions: [published], currentVersion: published });
      const serviceRoute = vi.fn()
        .mockResolvedValueOnce({ route })
        .mockRejectedValueOnce(new Error("route_reload_failed"));
      const createRouteVersion = outcome === "success"
        ? vi.fn().mockResolvedValue({ version: { ...published, id: `cloned_${outcome}`, status: "draft" as const } })
        : vi.fn().mockRejectedValue(Object.assign(new Error("draft_revision_conflict"), { status: 409 }));
      const host = await mountManagement(routeApi(route, { serviceRoute, createRouteVersion }));
      await openOnlyRoute(host);

      await confirmLifecycleAction(host, "Create new draft version");

      expect(createRouteVersion).toHaveBeenCalledWith(
        "token",
        route.id,
        { clone_from_version_id: published.id },
        expect.any(String)
      );
      expect(serviceRoute).toHaveBeenCalledTimes(2);
      expect(host.querySelector(".route-overview__section .notice--error")?.textContent).toBe(routeUiText("en").reloadFailed);
      expect(host.querySelectorAll(".notice--error")).toHaveLength(1);
      expect(host.querySelector("section.stack > .notice")).toBeNull();
    }
  );

  it.each(["success", "conflict"] as const)(
    "keeps a publish %s reload failure in lifecycle feedback",
    async (outcome) => {
      const draft = {
        ...readyVersion,
        id: `version_publish_reload_${outcome}`,
        service_route_id: `route_publish_reload_${outcome}`,
        draft_revision: 6
      };
      const route = routeFixture({ id: draft.service_route_id, versions: [draft] });
      const serviceRoute = vi.fn()
        .mockResolvedValueOnce({ route })
        .mockRejectedValueOnce(new Error("route_reload_failed"));
      const publishRouteVersion = outcome === "success"
        ? vi.fn().mockResolvedValue({ version: { ...draft, status: "published" as const } })
        : vi.fn().mockRejectedValue(Object.assign(new Error("draft_revision_conflict"), { status: 409 }));
      const host = await mountManagement(routeApi(route, { serviceRoute, publishRouteVersion }));
      await openOnlyRoute(host);

      await confirmLifecycleAction(host, "Publish");

      expect(publishRouteVersion).toHaveBeenCalledWith(
        "token",
        draft.id,
        { expected_revision: 6, expected_current_version_id: null },
        expect.any(String)
      );
      expect(serviceRoute).toHaveBeenCalledTimes(2);
      expect(host.querySelector(".route-overview__section .notice--error")?.textContent).toBe(routeUiText("en").reloadFailed);
      expect(host.querySelectorAll(".notice--error")).toHaveLength(1);
      expect(host.querySelector("section.stack > .notice")).toBeNull();
    }
  );

  it("reorders stops deterministically and preserves contiguous server-authoritative sequence", () => {
    const moved = moveRouteStop(stops, 1, -1);
    expect(moved.map((stop) => [stop.stop_id, stop.sequence])).toEqual([
      ["stop_2", 1],
      ["stop_1", 2]
    ]);
    expect(moveRouteStop(stops, 0, -1)).toBe(stops);
  });

  it("toggles one permission without mutating the remaining editor state", () => {
    const changed = toggleRouteStopPermission(stops, 1, "parcel_pickup_allowed");
    expect(changed[1].parcel_pickup_allowed).toBe(true);
    expect(changed[0]).toEqual(stops[0]);
    expect(stops[1].parcel_pickup_allowed).toBe(false);
  });

  it("shows only valid draft, published, paused, and retired lifecycle actions", () => {
    expect(lifecycleActions(version)).toEqual(["publish", "retire"]);
    expect(lifecycleActions({ ...version, status: "published" })).toEqual(["clone", "pause", "retire"]);
    expect(lifecycleActions({ ...version, status: "paused" })).toEqual(["clone", "resume", "retire"]);
    expect(lifecycleActions({ ...version, status: "retired" })).toEqual([]);
  });

  it("provides localized stale-revision and confirmation guidance", () => {
    expect(routeUiText("ar").revisionConflict).toContain("جلسة أخرى");
    expect(routeUiText("en").revisionConflict).toContain("Another session");
    expect(routeUiText("ar").confirm).toContain("سجل التدقيق");
    expect(routeUiText("en").confirm).toContain("audit log");
  });

  it("keeps mutation keys stable through uncertain outcomes and rotates after settlement", () => {
    const registry = new Map<string, string>();
    let sequence = 0;
    const factory = () => `key-${++sequence}`;
    const payload = { routeId: "route_1", clone_from_version_id: "version_1" };
    const first = stableMutationKey(registry, "route_version_clone", payload, factory);
    const retry = stableMutationKey(registry, "route_version_clone", payload, factory);
    expect(retry).toEqual(first);
    expect(mutationFailureIsAuthoritative(new TypeError("Failed to fetch"))).toBe(false);
    expect(mutationFailureIsAuthoritative(Object.assign(new Error("internal_server_error"), { status: 500 }))).toBe(false);
    expect(mutationFailureIsAuthoritative(Object.assign(new Error("idempotency_in_progress"), { status: 409 }))).toBe(false);
    expect(mutationFailureIsAuthoritative(Object.assign(new Error("resource_conflict"), { status: 409 }))).toBe(true);
    registry.delete(mutationFingerprint("route_version_clone", payload));
    expect(stableMutationKey(registry, "route_version_clone", payload, factory).key).toBe("key-2");
  });

  it("localizes safe errors without rendering raw API or internal error codes", () => {
    expect(routeUiError("en", new Error("draft_revision_conflict"))).toContain("Another session");
    expect(routeUiError("en", new Error("used_stop_immutable"))).toContain("already belongs to a route version");
    expect(routeUiError("ar", new Error("internal_database_detail"))).toBe(routeUiText("ar").genericError);
    expect(routeUiError("en", new Error("route_version_not_pausable"))).toBe(routeUiText("en").genericError);
    expect(routeUiError("en", new Error("route_version_not_pausable"))).not.toContain("route_version_not_pausable");
  });

  it("maps route capacity and validation errors to scoped, bounded messages", () => {
    const capacity = Object.assign(new Error("beta_route_limit_reached"), {
      status: 409,
      details: { error: "beta_route_limit_reached", request_id: "request-capacity-1" }
    });
    const validation = Object.assign(new Error("validation_error"), {
      status: 400,
      details: {
        error: "validation_error",
        request_id: "request-validation-1",
        details: [{ path: ["description_en"], code: "too_small", message: "Invalid value" }]
      }
    });

    expect(routeUiError("en", capacity)).toContain("beta limit for active routes");
    expect(routeUiError("en", capacity)).toContain("request-capacity-1");
    expect(routeUiError("en", validation)).toContain("English description");
    expect(routeUiError("en", validation)).toContain("request-validation-1");

    const routeAndStopValidation = Object.assign(new Error("validation_error"), {
      status: 400,
      details: {
        error: "validation_error",
        details: [
          { path: ["route_key"], code: "too_small", message: "Invalid value" },
          { path: ["latitude"], code: "too_small", message: "Invalid value" }
        ]
      }
    });
    expect(routeUiError("en", routeAndStopValidation)).toContain("Route key");
    expect(routeUiError("en", routeAndStopValidation)).toContain("Latitude");
  });

  it("does not reload for the beta capacity conflict but reloads stale conflicts", async () => {
    const reload = vi.fn().mockResolvedValue(true);
    await handleRouteMutationFailure(
      Object.assign(new Error("beta_route_limit_reached"), { status: 409 }),
      reload,
      "en",
      "create-route"
    );
    expect(reload).not.toHaveBeenCalled();
    await handleRouteMutationFailure(
      Object.assign(new Error("draft_revision_conflict"), { status: 409 }),
      reload,
      "en",
      "version-editor"
    );
    expect(reload).toHaveBeenCalledOnce();
  });

  it("normalizes nested-only stop responses and rejects a membership without any stop ID", () => {
    const nestedOnly = {
      ...version,
      stops: [{ ...readyVersion.stops[0], stop_id: undefined }]
    } as unknown as ServiceRouteVersion;
    expect(membershipsFromVersion(nestedOnly)[0].stop_id).toBe("stop_1");
    expect(() => membershipsFromVersion({
      ...version,
      stops: [{ ...readyVersion.stops[0], stop_id: undefined, stop: undefined }]
    } as unknown as ServiceRouteVersion)).toThrow("route_stop_id_missing");
  });

  it("never renders an unknown raw route lifecycle status", () => {
    expect(routeStatusText("en", "published")).toBe("Published");
    expect(routeStatusText("ar", "retired")).toBe("متقاعد");
    expect(routeStatusText("en", "internal_future_status")).toBe(routeUiText("en").status);
    expect(routeStatusText("en", "internal_future_status")).not.toContain("internal_future_status");
  });

  it("reloads authoritative route state for every conflict and returns bounded localized feedback", async () => {
    const reload = vi.fn().mockResolvedValue(true);
    const message = await handleRouteMutationFailure(
      Object.assign(new Error("current_version_conflict"), { status: 409 }),
      reload,
      "en"
    );

    expect(routeConflictRequiresReload(Object.assign(new Error("idempotency_in_progress"), { status: 409 }))).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(message).toContain("reload");
  });

  it("does not claim a conflict reload succeeded when reconciliation fails", async () => {
    const reload = vi.fn().mockResolvedValue(false);
    const message = await handleRouteMutationFailure(
      Object.assign(new Error("current_version_conflict"), {
        status: 409,
        details: { error: "current_version_conflict", request_id: "request-reload-failed-1" }
      }),
      reload,
      "en"
    );

    expect(reload).toHaveBeenCalledOnce();
    expect(message).toContain(routeUiText("en").reloadFailed);
    expect(message).toContain("request-reload-failed-1");
    expect(message).not.toBe(routeUiText("en").conflictReloaded);
    expect(message).not.toBe(routeUiText("en").saved);

    const reloadThrows = vi.fn().mockRejectedValue(new Error("network"));
    const thrownMessage = await handleRouteMutationFailure(
      Object.assign(new Error("current_version_conflict"), {
        status: 409,
        details: { error: "current_version_conflict", request_id: "request-reload-throws-1" }
      }),
      reloadThrows,
      "en"
    );
    expect(thrownMessage).toContain(routeUiText("en").reloadFailed);
    expect(thrownMessage).toContain("request-reload-throws-1");
  });

  it("does not reload non-conflicts or expose unknown internal failure text", async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    const message = await handleRouteMutationFailure(
      Object.assign(new Error("internal_database_detail"), { status: 500 }),
      reload,
      "en"
    );

    expect(reload).not.toHaveBeenCalled();
    expect(message).toBe(routeUiText("en").genericError);
    expect(message).not.toContain("internal_database_detail");
  });

  const routeTranslationKeys = [
    "routeStatusFilter",
    "routeDirectionFilter",
    "routeRegionFilter",
    "routeStatusHeading",
    "currentVersionStatusHeading",
    "selectedVersionStatusHeading",
    "stopStatusHeading",
    "routeStatusLabels",
    "routeHistoryBounded",
    "routeHistorySummary",
    "routeHistoryTruncated",
    "routeMapUnavailable",
    "routeMapUnavailableDescription",
    "routeManualCoordinates",
    "routeStopKey",
    "routeRegion",
    "routeNameAr",
    "routeNameEn",
    "routeEditStop",
    "routeCancelStopEdit",
    "routeSaveStopEdit",
    "routeDialogClose",
    "routeDialogCancel",
    "routeTabOverview",
    "routeTabVersions",
    "routeTabStops",
    "routeActionMenu",
    "routeCreateRoute",
    "routeCreateVersion",
    "routeAddStop",
    "routeCreateStop",
    "routeEditVersion",
    "routeEditStopAction",
    "routeConflictPage",
    "routeConflictCreateRoute",
    "routeConflictVersionEditor",
    "routeConflictStops",
    "routeConflictStopEditor",
    "routeConflictLifecycle",
    "routeReadinessLabel",
    "routeReady",
    "routeEmptyDirectory",
    "routeEmptyVersions",
    "routeEmptyStops",
    "routeReadinessTitle",
    "routeReadinessReady",
    "readinessMissingNames",
    "readinessMinimumStops",
    "readinessStopEligibility",
    "readinessDateOrder",
    "readinessPassengerPath",
    "readinessParcelPath",
    "routeUsedStopImmutable",
    "routeNoCurrentVersion"
  ] as const;

  it.each(routeTranslationKeys)("provides complete Arabic and English route copy for %s", (key) => {
    expect(translations.ar[key].trim()).not.toBe("");
    expect(translations.en[key].trim()).not.toBe("");
    expect(translations.ar[key]).not.toBe(translations.en[key]);
  });

  it.each([
    { locale: "ar" as const, direction: "rtl", tab: "نظرة عامة", status: "نشط" },
    { locale: "en" as const, direction: "ltr", tab: "Overview", status: "Active" }
  ])("renders a $direction route workspace boundary with textual status and isolated technical values", async ({ locale, direction, tab, status }) => {
    const route = routeFixture();
    const host = await mountManagement(routeApi(route), locale);
    await openOnlyRoute(host);
    const boundary = host.querySelector<HTMLElement>(`.route-management[dir="${direction}"]`)!;

    expect(boundary).not.toBeNull();
    expect(boundary.textContent).toContain(tab);
    expect(boundary.textContent).toContain(status);
    expect(boundary.querySelectorAll('.technical-value[dir="ltr"]').length).toBeGreaterThan(1);
    expect(boundary.querySelector("table")).toBeNull();
  });

  it("labels the lifecycle menu with its visible trigger", async () => {
    const route = routeFixture();
    const host = await mountManagement(routeApi(route));
    await openOnlyRoute(host);
    const trigger = buttonNamed(host, "Route actions");
    act(() => trigger.click());
    const menu = host.querySelector<HTMLElement>('[role="menu"]')!;

    expect(trigger.id).not.toBe("");
    expect(menu.getAttribute("aria-labelledby")).toBe(trigger.id);
  });

  it("exposes scrollable tabs, one-column 560px cards, and bounded dialog overflow without a table dependency", async () => {
    const componentStyles = readFileSync("src/ui/components.css", "utf8");
    const pageStyles = readFileSync("src/styles.css", "utf8");
    const route = routeFixture();
    const host = await mountManagement(routeApi(route));
    act(() => buttonNamed(host, "Create route").click());

    expect(host.querySelector(".route-directory__row")).not.toBeNull();
    expect(host.querySelector(".route-dialog .route-dialog__body")).not.toBeNull();
    expect(host.querySelector("table")).toBeNull();
    expect(componentStyles).toMatch(/\.route-workspace__tabs\s*\{[\s\S]*?overflow-x:\s*auto/);
    expect(componentStyles).toMatch(/\.route-dialog\s*\{[\s\S]*?max-block-size:\s*min\(90dvh, 760px\)[\s\S]*?overflow:\s*hidden/);
    expect(componentStyles).toMatch(/\.route-dialog__body\s*\{[\s\S]*?overflow:\s*auto/);
    expect(componentStyles).toMatch(/@media \(max-width: 560px\)[\s\S]*?\.route-directory__row,[\s\S]*?\.route-stops__item\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
    expect(pageStyles).toMatch(/\.route-management\s*\{[\s\S]*?min-inline-size:\s*0/);
  });

  it("has no map dependency or demo-control leakage and retains accessible responsive controls", () => {
    const dependencies = JSON.stringify(adminPackage.dependencies);
    const markup = renderToStaticMarkup(<RouteManagement api={{} as never} token="token" locale="en" />);
    expect(dependencies).not.toMatch(/mapbox|google.maps|leaflet|socket\.io/i);
    expect(markup).not.toMatch(/x-demo-reset-key|reset demo|simulate step|demo credentials/i);
    expect(reorderControlLabel("Move up", 0)).toBe("Move up 1");
    expect(reorderControlLabel("تحريك لأسفل", 1)).toBe("تحريك لأسفل 2");
    expect(ADMIN_ROUTE_RESPONSIVE_BREAKPOINT).toBe(880);
  });
});
