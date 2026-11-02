import { describe, expect, it } from "vitest";
import type { ServiceRoute, ServiceRouteVersion } from "../../api";
import {
  initialRouteUiState,
  lifecycleActionRequiresReason,
  normalizeRouteVersionDraft,
  routeUiReducer,
  routeVersionDraftFrom,
  selectAuthoritativeRouteVersion
} from "./routeManagementModel";

describe("routeManagementModel", () => {
  it("opens a selected route in its overview workspace", () => {
    const next = routeUiReducer(initialRouteUiState, { type: "open-route", routeId: "route-1" });

    expect(next).toMatchObject({
      surface: "workspace",
      selectedRouteId: "route-1",
      selectedVersionId: null,
      selectedStopId: null,
      tab: "overview"
    });
  });

  it("keeps tab and version selection feature-local", () => {
    const workspace = routeUiReducer(initialRouteUiState, { type: "open-route", routeId: "route-1" });
    const versionSelected = routeUiReducer(workspace, { type: "select-version", versionId: "version-2" });
    const next = routeUiReducer(versionSelected, { type: "select-tab", tab: "versions" });

    expect(next).toMatchObject({
      surface: "workspace",
      selectedRouteId: "route-1",
      selectedVersionId: "version-2",
      tab: "versions"
    });
  });

  it("clears route-scoped feedback when leaving or opening a route identity", () => {
    const routeA = {
      ...initialRouteUiState,
      surface: "workspace" as const,
      selectedRouteId: "route-a",
      selectedVersionId: "version-a",
      feedback: { scope: "lifecycle" as const, kind: "error" as const, text: "Route A changed" }
    };

    const directory = routeUiReducer(routeA, { type: "back-to-directory" });
    const routeB = routeUiReducer(directory, { type: "open-route", routeId: "route-b" });

    expect(directory).toMatchObject({ surface: "directory", selectedRouteId: null, feedback: null });
    expect(routeB).toMatchObject({ surface: "workspace", selectedRouteId: "route-b", feedback: null });
  });

  it.each(["create-route", "create-version", "add-stop", "create-stop", "edit-stop", "lifecycle"] as const)(
    "opens and closes %s without changing the selected route",
    (dialog) => {
      const workspace = {
        ...initialRouteUiState,
        surface: "workspace" as const,
        selectedRouteId: "route-1",
        selectedVersionId: "version-2",
        tab: "stops" as const
      };

      const opened = routeUiReducer(workspace, { type: "open-dialog", dialog });
      const closed = routeUiReducer(opened, { type: "close-dialog" });

      expect(opened).toMatchObject({ selectedRouteId: "route-1", dialog });
      expect(closed).toMatchObject({
        selectedRouteId: "route-1",
        selectedVersionId: "version-2",
        tab: "stops",
        dialog: null
      });
    }
  );

  it("keeps the selected stop only for the focused edit dialog and clears it on close", () => {
    const workspace = {
      ...initialRouteUiState,
      surface: "workspace" as const,
      selectedRouteId: "route-1",
      selectedVersionId: "version-2",
      tab: "stops" as const
    };

    const editing = routeUiReducer(workspace, { type: "open-dialog", dialog: "edit-stop", stopId: "stop-7" });
    const closed = routeUiReducer(editing, { type: "close-dialog" });
    const adding = routeUiReducer(closed, { type: "open-dialog", dialog: "add-stop" });

    expect(editing).toMatchObject({ dialog: "edit-stop", selectedStopId: "stop-7", tab: "stops" });
    expect(closed).toMatchObject({ dialog: null, selectedStopId: null, tab: "stops" });
    expect(adding).toMatchObject({ dialog: "add-stop", selectedStopId: null, tab: "stops" });
  });

  it("exits draft edit mode when an edit is cancelled", () => {
    const editing = routeUiReducer(initialRouteUiState, { type: "begin-version-edit" });
    const next = routeUiReducer(editing, { type: "cancel-version-edit" });

    expect(editing.versionEditMode).toBe(true);
    expect(next.versionEditMode).toBe(false);
  });

  it("exits draft edit mode when selection is reconciled to an authoritative version", () => {
    const editing = { ...initialRouteUiState, versionEditMode: true, selectedVersionId: "version-before" };
    const next = routeUiReducer(editing, { type: "select-version", versionId: "version-after" });

    expect(next).toMatchObject({ selectedVersionId: "version-after", versionEditMode: false });
  });

  it("restores an authoritative draft shape and normalizes edited local dates for the update contract", () => {
    const draft = routeVersionDraftFrom({
      name_ar: "مسار الخليل",
      name_en: "Hebron route",
      description_ar: null,
      description_en: "A draft",
      active_from: "2026-08-25T06:00:00.000Z",
      active_until: null
    });

    expect(draft).toMatchObject({
      name_ar: "مسار الخليل",
      name_en: "Hebron route",
      description_ar: "",
      description_en: "A draft",
      active_until: ""
    });
    expect(normalizeRouteVersionDraft(draft)).toEqual({
      ...draft,
      description_ar: null,
      active_from: "2026-08-25T06:00:00.000Z",
      active_until: null
    });
  });

  it.each([
    ["", "", null, null],
    ["   ", " \t", null, null],
    ["وصف عربي", "", "وصف عربي", null],
    ["", "English description", null, "English description"]
  ])("normalizes optional descriptions without sending blank strings", (arabic, english, expectedArabic, expectedEnglish) => {
    expect(normalizeRouteVersionDraft({
      name_ar: "مسار",
      name_en: "Route",
      description_ar: arabic,
      description_en: english,
      active_from: "",
      active_until: ""
    })).toMatchObject({ description_ar: expectedArabic, description_en: expectedEnglish });
  });

  it("round-trips UTC instants through local datetime inputs in multiple timezones", () => {
    const originalTimezone = process.env.TZ;
    const cases = [
      { timezone: "UTC", activeFrom: "2026-08-25T06:00", activeUntil: "2026-08-25T20:00" },
      { timezone: "Asia/Hebron", activeFrom: "2026-08-25T09:00", activeUntil: "2026-08-25T23:00" },
      { timezone: "America/New_York", activeFrom: "2026-08-25T02:00", activeUntil: "2026-08-25T16:00" }
    ];

    try {
      for (const { timezone, activeFrom, activeUntil } of cases) {
        process.env.TZ = timezone;
        const draft = routeVersionDraftFrom({
          name_ar: "مسار الخليل",
          name_en: "Hebron route",
          description_ar: null,
          description_en: null,
          active_from: "2026-08-25T06:00:00.000Z",
          active_until: "2026-08-25T20:00:00.000Z"
        });

        expect(draft).toMatchObject({ active_from: activeFrom, active_until: activeUntil });
        expect(normalizeRouteVersionDraft(draft)).toMatchObject({
          active_from: "2026-08-25T06:00:00.000Z",
          active_until: "2026-08-25T20:00:00.000Z"
        });
      }
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });

  it("keeps a surviving version selection, then falls back to the authoritative current or newest version", () => {
    const preferred: ServiceRouteVersion = {
      id: "version-preferred",
      service_route_id: "route-1",
      version_number: 1,
      status: "draft",
      name_ar: "المسودة المحددة",
      name_en: "Preferred draft",
      description_ar: null,
      description_en: null,
      active_from: null,
      active_until: null,
      draft_revision: 1,
      stop_count: 0,
      stops: [],
      geometry: { status: "pending", ready: false }
    };
    const current: ServiceRouteVersion = { ...preferred, id: "version-current", version_number: 2, status: "published" };
    const newest: ServiceRouteVersion = { ...preferred, id: "version-newest", version_number: 3 };
    const route: ServiceRoute = {
      id: "route-1",
      route_key: "route-1-key",
      route_group_key: "route-1-group",
      service_region_key: "south-west-bank",
      direction: "outbound",
      status: "active",
      versions: [newest, current, preferred],
      version_count: 3,
      current_version_id: current.id,
      current_version: current,
      created_at: "2026-08-25T00:00:00.000Z",
      updated_at: "2026-08-25T00:00:00.000Z"
    };

    expect(selectAuthoritativeRouteVersion(route, preferred.id)).toBe(preferred);
    expect(selectAuthoritativeRouteVersion({ ...route, versions: [newest, current] }, preferred.id)).toBe(current);
    expect(selectAuthoritativeRouteVersion({ ...route, versions: [newest], current_version_id: null, current_version: null }, preferred.id)).toBe(newest);
  });

  it("preserves the logical workspace when a stale mutation is reloaded", () => {
    const state = {
      ...initialRouteUiState,
      surface: "workspace" as const,
      selectedRouteId: "route-1",
      selectedVersionId: "version-2",
      tab: "stops" as const
    };
    const next = routeUiReducer(state, {
      type: "feedback",
      scope: "stops",
      kind: "error",
      text: "Another session changed this draft"
    });
    expect(next).toMatchObject({
      surface: "workspace",
      selectedRouteId: "route-1",
      selectedVersionId: "version-2",
      tab: "stops",
      feedback: { scope: "stops", kind: "error" }
    });
  });

  it("requires reasons only for the existing pause and retirement semantics", () => {
    expect(lifecycleActionRequiresReason("pause")).toBe(true);
    expect(lifecycleActionRequiresReason("retire-version")).toBe(true);
    expect(lifecycleActionRequiresReason("retire-route")).toBe(true);
    expect(lifecycleActionRequiresReason("clone")).toBe(false);
    expect(lifecycleActionRequiresReason("publish")).toBe(false);
    expect(lifecycleActionRequiresReason("resume")).toBe(false);
  });
});
