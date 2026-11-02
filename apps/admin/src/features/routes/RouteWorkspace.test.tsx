// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { act, useReducer } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServiceRoute } from "../../api";
import { initialRouteUiState, routeUiReducer } from "./routeManagementModel";
import { RouteWorkspace } from "./RouteWorkspace";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const version = {
  id: "version_1",
  service_route_id: "route_1",
  version_number: 1,
  status: "published" as const,
  name_ar: "الخليل إلى بيت لحم",
  name_en: "Hebron to Bethlehem",
  description_ar: null,
  description_en: null,
  active_from: null,
  active_until: null,
  draft_revision: 1,
  stop_count: 2,
  stops: [],
  geometry: { status: "available" as const, ready: true }
};

const route: ServiceRoute = {
  id: "route_1",
  route_key: "hebron-bethlehem",
  route_group_key: "hebron-bethlehem",
  service_region_key: "south-west-bank",
  direction: "outbound",
  status: "active",
  current_version_id: version.id,
  current_version: version,
  versions: [version],
  version_count: 1,
  created_at: "2026-08-25T00:00:00.000Z",
  updated_at: "2026-08-25T00:00:00.000Z"
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("RouteWorkspace", () => {
  it("uses a generic status label for an unknown route status", () => {
    const markup = renderToStaticMarkup(
      <RouteWorkspace
        locale="en"
        route={{ ...route, status: "future_status" as ServiceRoute["status"] }}
        selectedVersion={version}
        tab="overview"
        onBack={vi.fn()}
        onSelectTab={vi.fn()}
        overview={<p>Overview panel content</p>}
        versions={<p>Versions panel content</p>}
        stops={<p>Stops panel content</p>}
      />
    );

    expect(markup).toMatch(/>Status<\/span>/);
    expect(markup).not.toContain(">future_status<");
  });

  it("renders the selected identity, four labeled statuses, and exactly three accessible tabs", () => {
    const markup = renderToStaticMarkup(
      <RouteWorkspace
        locale="en"
        route={route}
        selectedVersion={version}
        tab="overview"
        onBack={vi.fn()}
        onSelectTab={vi.fn()}
        overview={<p>Overview panel content</p>}
        versions={<p>Versions panel content</p>}
        stops={<p>Stops panel content</p>}
      />
    );

    expect(markup).toContain("Hebron to Bethlehem");
    expect(markup).toContain("Back to routes");
    expect(markup).toContain("Route status");
    expect(markup).toContain("Current version status");
    expect(markup).toContain("Selected version status");
    expect(markup).toContain("Map status");
    expect(markup).toContain("Map preview unavailable");
    expect(markup).toContain('dir="ltr">hebron-bethlehem');
    expect(markup).toContain('dir="ltr">version_1');
    expect(markup.match(/role="tab"/g)).toHaveLength(3);
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('role="tabpanel"');
    expect(markup).toContain("Overview panel content");
    expect(markup).not.toContain("Versions panel content");
    expect(markup).not.toContain("Stops panel content");
    expect(markup).not.toContain("Activity");
  });

  it("changes only the active panel through reducer state and supports returning to routes", () => {
    const onBack = vi.fn();

    function Harness() {
      const [state, dispatch] = useReducer(routeUiReducer, {
        ...initialRouteUiState,
        surface: "workspace",
        selectedRouteId: route.id
      });
      return (
        <RouteWorkspace
          locale="en"
          route={route}
          selectedVersion={version}
          tab={state.tab}
          onBack={onBack}
          onSelectTab={(tab) => dispatch({ type: "select-tab", tab })}
          overview={<p>Overview panel content</p>}
          versions={<p>Versions panel content</p>}
          stops={<p>Stops panel content</p>}
        />
      );
    }

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<Harness />));

    const versionsTab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((tab) => tab.textContent === "Versions")!;
    act(() => versionsTab.click());

    expect(host.textContent).toContain("Hebron to Bethlehem");
    expect(host.textContent).toContain("hebron-bethlehem");
    expect(host.textContent).toContain("Versions panel content");
    expect(host.textContent).not.toContain("Overview panel content");
    expect(versionsTab.getAttribute("aria-selected")).toBe("true");

    const back = [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Back to routes")!;
    act(() => back.click());
    expect(onBack).toHaveBeenCalledOnce();
  });

  it.each([
    { locale: "en" as const, rightIndex: 1 },
    { locale: "ar" as const, rightIndex: 2 }
  ])("supports direction-aware arrow keys plus absolute Home and End navigation in $locale", ({ locale, rightIndex }) => {
    function Harness() {
      const [state, dispatch] = useReducer(routeUiReducer, {
        ...initialRouteUiState,
        surface: "workspace",
        selectedRouteId: route.id
      });
      return (
        <RouteWorkspace
          locale={locale}
          route={route}
          selectedVersion={version}
          tab={state.tab}
          onBack={vi.fn()}
          onSelectTab={(tab) => dispatch({ type: "select-tab", tab })}
          overview={<p>Overview panel content</p>}
          versions={<p>Versions panel content</p>}
          stops={<p>Stops panel content</p>}
        />
      );
    }

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<Harness />));
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const press = (tab: HTMLButtonElement, key: string) => act(() => tab.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
    ));

    tabs[0].focus();
    press(tabs[0], "ArrowRight");
    expect(document.activeElement).toBe(tabs[rightIndex]);

    press(tabs[rightIndex], "ArrowLeft");
    expect(document.activeElement).toBe(tabs[0]);

    press(tabs[0], "End");
    expect(document.activeElement).toBe(tabs[2]);
    press(tabs[2], "Home");
    expect(document.activeElement).toBe(tabs[0]);
  });

  it("reflows workspace status, overview facts, and lifecycle controls for narrow screens", () => {
    const styles = readFileSync("src/ui/components.css", "utf8");

    expect(styles).toMatch(/\.route-workspace__statuses\s*\{[\s\S]*?grid-template-columns/);
    expect(styles).toMatch(/\.route-action-menu__items\s*\{[\s\S]*?position:\s*absolute/);
    expect(styles).toMatch(/@media \(max-width: 560px\)[\s\S]*?\.route-workspace__statuses[\s\S]*?grid-template-columns:\s*1fr/);
  });
});
