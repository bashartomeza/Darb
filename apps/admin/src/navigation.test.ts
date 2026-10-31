import { describe, expect, it } from "vitest";
import {
  MODULE_IDS,
  NAV_GROUPS,
  NAV_ITEMS,
  hashForModule,
  isModuleAvailable,
  moduleFromHash,
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
      "deliveries",
      "matchingBatching",
      "incidentsSafety",
      "reports",
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
      ["deliveries", "operations"],
      ["matchingBatching", "operations"],
      ["incidentsSafety", "safety"],
      ["reports", "insights"],
      ["settings", "system"]
    ]);
  });

  it("has Arabic and English labels for every destination and group", () => {
    for (const { labelKey } of [...NAV_ITEMS, ...NAV_GROUPS]) {
      expect(translations.ar[labelKey]).toBeTruthy();
      expect(translations.en[labelKey]).toBeTruthy();
    }
  });

  it("keeps the full structure visible when build flags are off", () => {
    expect(visibleNavItems(allOff)).toEqual(NAV_ITEMS);
    expect(visibleNavItems(allOff).map((item) => item.id)).toContain("routes");
    expect(visibleNavItems(allOff).map((item) => item.id)).toContain("matchingBatching");
  });

  it("uses honest unavailable states for gated and unimplemented modules", () => {
    expect(isModuleAvailable("routes", allOn)).toBe(true);
    expect(isModuleAvailable("routes", allOff)).toBe(false);
    expect(isModuleAvailable("matchingBatching", allOn)).toBe(true);
    expect(isModuleAvailable("matchingBatching", allOff)).toBe(true);
    expect(isModuleAvailable("incidentsSafety", allOn)).toBe(true);
    expect(isModuleAvailable("reports", allOn)).toBe(true);
  });

  it("keeps API-backed people modules available", () => {
    expect(isModuleAvailable("users", allOff)).toBe(true);
    expect(isModuleAvailable("drivers", allOff)).toBe(true);
    expect(NAV_ITEMS.find((item) => item.id === "matchingBatching")?.backing).toBe("api");
    expect(isModuleAvailable("matchingBatching", allOff)).toBe(true);
  });

  it("provides stable deep links and resolves compatibility aliases", () => {
    for (const id of MODULE_IDS) expect(moduleFromHash(hashForModule(id))).toBe(id);
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
  });
});
