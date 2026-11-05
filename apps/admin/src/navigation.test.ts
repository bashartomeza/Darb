import { describe, expect, it } from "vitest";
import {
  MODULE_IDS,
  NAV_GROUPS,
  NAV_ITEMS,
  hashForModule,
  moduleFromHash,
  navItemForModule,
  resolveActiveModule,
  visibleNavItems
} from "./navigation";
import { translations } from "./i18n/translations";

const allOn = { demoEnabled: true, routeManagementEnabled: true };
const allOff = { demoEnabled: false, routeManagementEnabled: false };

describe("admin navigation", () => {
  it("defines the required operational sidebar destinations in order", () => {
    expect(NAV_ITEMS.map((item) => item.id)).toEqual([...MODULE_IDS]);
    expect(MODULE_IDS).toEqual([
      "overview",
      "users",
      "drivers",
      "invitations",
      "trips",
      "routes",
      "checkpointPositions",
      "mapPlaces",
      "deliveries",
      "matchingBatching",
      "cancellations",
      "incidentsSafety",
      "communityReports",
      "reports",
      "appRatings",
      "settings"
    ]);
  });

  it("assigns each destination to the requested operational group", () => {
    expect(NAV_GROUPS.map((group) => group.id)).toEqual([
      "main",
      "people",
      "operations",
      "safety",
      "insights",
      "system"
    ]);
    expect(NAV_ITEMS.map(({ id, group }) => [id, group])).toEqual([
      ["overview", "main"],
      ["users", "people"],
      ["drivers", "people"],
      ["invitations", "people"],
      ["trips", "operations"],
      ["routes", "operations"],
      ["checkpointPositions", "operations"],
      ["mapPlaces", "operations"],
      ["deliveries", "operations"],
      ["matchingBatching", "operations"],
      ["cancellations", "operations"],
      ["incidentsSafety", "safety"],
      ["communityReports", "safety"],
      ["reports", "insights"],
      ["appRatings", "insights"],
      ["settings", "system"]
    ]);
  });

  it("has Arabic and English labels for every destination and group", () => {
    for (const { labelKey } of [...NAV_ITEMS, ...NAV_GROUPS]) {
      expect(translations.ar[labelKey]).toBeTruthy();
      expect(translations.en[labelKey]).toBeTruthy();
    }
  });

  it("keeps the full structure visible whatever the build flags", () => {
    expect(visibleNavItems(allOff)).toEqual(NAV_ITEMS);
    expect(visibleNavItems(allOn)).toEqual(NAV_ITEMS);
  });

  it("provides stable deep links and resolves compatibility aliases", () => {
    for (const id of MODULE_IDS) expect(moduleFromHash(hashForModule(id))).toBe(id);
    expect(hashForModule("communityReports")).toBe("#/community-reports");
    expect(hashForModule("appRatings")).toBe("#/app-ratings");
    expect(hashForModule("checkpointPositions")).toBe("#/checkpoint-positions");
    expect(hashForModule("profile")).toBe("#/profile");
    expect(moduleFromHash("#/profile")).toBe("profile");
    expect(NAV_ITEMS.map((item) => item.id)).not.toContain("profile");
    expect(moduleFromHash("#/verification")).toBe("drivers");
    expect(moduleFromHash("#/requests")).toBe("deliveries");
    expect(moduleFromHash("#/matching")).toBe("matchingBatching");
    expect(moduleFromHash("#/comparison")).toBe("matchingBatching");
    expect(moduleFromHash("#/safety")).toBe("incidentsSafety");
    expect(moduleFromHash("#/unknown")).toBe("overview");
    expect(moduleFromHash("")).toBe("overview");
  });

  it("keeps a valid destination active regardless of feature availability", () => {
    expect(resolveActiveModule("routes", allOff)).toBe("routes");
    expect(resolveActiveModule("matchingBatching", allOff)).toBe("matchingBatching");
    expect(resolveActiveModule("communityReports", allOff)).toBe("communityReports");
  });

  it("keeps the old route workspace out of the sidebar and behind the route-management flag", () => {
    expect(NAV_ITEMS.map((item) => item.id)).not.toContain("routeWorkspace");
    expect(hashForModule("routeWorkspace")).toBe("#/routes/advanced");
    expect(moduleFromHash("#/routes/advanced")).toBe("routeWorkspace");
    expect(resolveActiveModule("routeWorkspace", allOn)).toBe("routeWorkspace");
    expect(resolveActiveModule("routeWorkspace", allOff)).toBe("routes");
    expect(navItemForModule("routeWorkspace")).toBe("routes");
    expect(navItemForModule("profile")).toBeNull();
    expect(navItemForModule("trips")).toBe("trips");
  });
});
