// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServiceRoute, ServiceRouteVersion } from "../../api";
import type { PublicationReadinessIssue } from "./RouteManagement";
import { PublishReadiness } from "./PublishReadiness";
import { RouteActionMenu } from "./RouteActionMenu";
import { RouteOverview } from "./RouteOverview";

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
  draft_revision: 4,
  stop_count: 2,
  stops: [],
  geometry: { status: "pending", ready: false }
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

const callbacks = () => ({
  onClone: vi.fn(),
  onPublish: vi.fn(),
  onPause: vi.fn(),
  onResume: vi.fn(),
  onRetireVersion: vi.fn(),
  onRetireRoute: vi.fn()
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(element: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(element));
  return host;
}

function clickButton(container: HTMLElement, label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent?.trim() === label);
  expect(button, `button ${label}`).toBeTruthy();
  act(() => button?.click());
  return button!;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.replaceChildren();
});

describe("RouteOverview", () => {
  it("uses a generic status label for an unknown route status", () => {
    const markup = renderToStaticMarkup(
      <RouteOverview
        locale="en"
        route={{ ...route, status: "future_status" as ServiceRoute["status"] }}
        version={version}
        readinessIssues={["readinessMinimumStops"]}
        actions={["publish", "retire"]}
        lifecycleDialogOpen={false}
        lifecycleFeedback={null}
        busy={false}
        onOpenLifecycleDialog={vi.fn()}
        onCloseLifecycleDialog={vi.fn()}
        {...callbacks()}
      />
    );

    expect(markup).toMatch(/>Status<\/span>/);
    expect(markup).not.toContain(">future_status<");
  });

  it("renders concise identity, current version, readiness, lifecycle, and secondary map sections", () => {
    const markup = renderToStaticMarkup(
      <RouteOverview
        locale="en"
        route={route}
        version={version}
        readinessIssues={["readinessMinimumStops"]}
        actions={["publish", "retire"]}
        lifecycleDialogOpen={false}
        lifecycleFeedback={null}
        busy={false}
        onOpenLifecycleDialog={vi.fn()}
        onCloseLifecycleDialog={vi.fn()}
        {...callbacks()}
      />
    );

    expect(markup).toContain("Route identity");
    expect(markup).toContain("Current version summary");
    expect(markup).toContain("Publish readiness");
    expect(markup).toContain("Lifecycle");
    expect(markup).toContain("Map status");
    expect(markup).toContain('dir="ltr">route_1');
    expect(markup).toContain('dir="ltr">version_1');
    expect(markup).toContain("Map preview unavailable");
  });

  it("shows every advisory check with visible ready or failed symbols and explanatory text", () => {
    const issues: PublicationReadinessIssue[] = ["readinessMissingNames", "readinessPassengerPath"];
    const invalid = renderToStaticMarkup(<PublishReadiness issues={issues} locale="en" />);
    const ready = renderToStaticMarkup(<PublishReadiness issues={[]} locale="en" />);

    expect(invalid.match(/data-readiness-check=/g)).toHaveLength(6);
    expect(invalid.match(/>!<\/span>/g)).toHaveLength(2);
    expect(invalid.match(/>✓<\/span>/g)).toHaveLength(4);
    expect(invalid).toContain("Needs attention");
    expect(invalid).toContain("Ready");
    expect(invalid).toContain("Provide both Arabic and English route names.");
    expect(ready.match(/>✓<\/span>/g)).toHaveLength(6);
    expect(ready).toContain("Backend validation remains authoritative.");
  });

  it("keeps scoped lifecycle feedback visible after the confirmation dialog closes", () => {
    const markup = renderToStaticMarkup(
      <RouteOverview
        locale="en"
        route={route}
        version={version}
        readinessIssues={[]}
        actions={["publish", "retire"]}
        lifecycleDialogOpen={false}
        lifecycleFeedback="The route status changed. The latest data was loaded."
        busy={false}
        onOpenLifecycleDialog={vi.fn()}
        onCloseLifecycleDialog={vi.fn()}
        {...callbacks()}
      />
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("The route status changed. The latest data was loaded.");
  });

  it("does not offer route retirement after the route is already retired", () => {
    const markup = renderToStaticMarkup(
      <RouteOverview
        locale="en"
        route={{ ...route, status: "retired" }}
        version={{ ...version, status: "retired" }}
        readinessIssues={[]}
        actions={[]}
        lifecycleDialogOpen={false}
        lifecycleFeedback={null}
        busy={false}
        onOpenLifecycleDialog={vi.fn()}
        onCloseLifecycleDialog={vi.fn()}
        {...callbacks()}
      />
    );

    const documentHost = document.createElement("div");
    documentHost.innerHTML = markup;
    const menuLabels = [...documentHost.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .map((item) => item.textContent?.trim());
    expect(menuLabels).not.toContain("Retire route");
  });
});

describe("RouteActionMenu", () => {
  it.each([
    ["draft", ["Publish", "Retire"]],
    ["published", ["Pause", "Create new draft version", "Retire"]],
    ["paused", ["Resume", "Create new draft version", "Retire"]],
    ["retired", []]
  ] as const)("renders exact mutable version actions for %s", (status, expected) => {
    const markup = renderToStaticMarkup(
      <RouteActionMenu
        locale="en"
        routeStatus="active"
        version={{ ...version, status }}
        actions={status === "draft" ? ["publish", "retire"] : status === "published" ? ["clone", "pause", "retire"] : status === "paused" ? ["clone", "resume", "retire"] : []}
        readinessIssues={[]}
        dialogOpen={false}
        onOpenDialog={vi.fn()}
        onCloseDialog={vi.fn()}
        {...callbacks()}
      />
    );

    const documentHost = document.createElement("div");
    documentHost.innerHTML = markup;
    const labels = [...documentHost.querySelectorAll<HTMLElement>("[data-route-version-action]")]
      .map((item) => item.textContent?.trim());
    expect(labels).toEqual(expected);
  });

  it("disables publish while advisory issues exist without removing the action", () => {
    const markup = renderToStaticMarkup(
      <RouteActionMenu
        locale="en"
        routeStatus="active"
        version={version}
        actions={["publish", "retire"]}
        readinessIssues={["readinessMinimumStops"]}
        dialogOpen={false}
        onOpenDialog={vi.fn()}
        onCloseDialog={vi.fn()}
        {...callbacks()}
      />
    );
    expect(markup).toMatch(/<button(?=[^>]*data-route-version-action="publish")(?=[^>]*disabled="")[^>]*>/);
  });

  it("opens confirmation before invoking an action and asks for a reason only when required", () => {
    const publishCallbacks = callbacks();
    const publishHost = mount(
      <RouteActionMenu
        locale="en"
        routeStatus="active"
        version={version}
        actions={["publish", "retire"]}
        readinessIssues={[]}
        dialogOpen
        onOpenDialog={vi.fn()}
        onCloseDialog={vi.fn()}
        {...publishCallbacks}
      />
    );
    clickButton(publishHost, "Route actions");
    clickButton(publishHost, "Publish");
    expect(publishCallbacks.onPublish).not.toHaveBeenCalled();
    expect(publishHost.querySelector('[role="dialog"]')).toBeTruthy();
    expect(publishHost.querySelector('input[name="reason"]')).toBeNull();
    clickButton(publishHost, "Confirm");
    expect(publishCallbacks.onPublish).toHaveBeenCalledOnce();

    act(() => root?.unmount());
    root = null;
    publishHost.remove();
    host = null;

    const pauseCallbacks = callbacks();
    const pauseHost = mount(
      <RouteActionMenu
        locale="en"
        routeStatus="active"
        version={{ ...version, status: "published" }}
        actions={["clone", "pause", "retire"]}
        readinessIssues={[]}
        dialogOpen
        onOpenDialog={vi.fn()}
        onCloseDialog={vi.fn()}
        {...pauseCallbacks}
      />
    );
    clickButton(pauseHost, "Route actions");
    clickButton(pauseHost, "Pause");
    const confirm = [...pauseHost.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Confirm")!;
    const reason = pauseHost.querySelector<HTMLInputElement>('input[name="reason"]')!;
    expect(reason.required).toBe(true);
    expect(confirm.disabled).toBe(false);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(reason, "  schedule change  ");
      reason.dispatchEvent(new Event("input", { bubbles: true }));
      reason.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(confirm.disabled).toBe(false);
    act(() => confirm.click());
    expect(pauseCallbacks.onPause).toHaveBeenCalledWith("schedule change");
  });

  it.each([
    ["en", "Pause", "A reason is required for this action."],
    ["ar", "إيقاف مؤقت", "السبب مطلوب لهذا الإجراء."]
  ] as const)("reveals the %s reason error only after interaction and exposes it accessibly", (locale, action, errorText) => {
    const actionCallbacks = callbacks();
    const actionHost = mount(
      <RouteActionMenu
        locale={locale}
        routeStatus="active"
        version={{ ...version, status: "published" }}
        actions={["pause"]}
        readinessIssues={[]}
        dialogOpen
        onOpenDialog={vi.fn()}
        onCloseDialog={vi.fn()}
        {...actionCallbacks}
      />
    );
    clickButton(actionHost, locale === "ar" ? "إجراءات المسار" : "Route actions");
    clickButton(actionHost, action);
    const reason = actionHost.querySelector<HTMLInputElement>('input[name="reason"]')!;

    expect(actionHost.textContent).not.toContain(errorText);
    expect(reason.hasAttribute("aria-invalid")).toBe(false);
    expect(reason.hasAttribute("aria-describedby")).toBe(false);

    act(() => {
      reason.focus();
      reason.blur();
    });

    const error = [...actionHost.querySelectorAll<HTMLElement>(".field__error")]
      .find((candidate) => candidate.textContent === errorText)!;
    expect(error).toBeTruthy();
    expect(reason.getAttribute("aria-invalid")).toBe("true");
    expect(reason.getAttribute("aria-describedby")).toBe(error.id);
  });

  it("rejects an attempted empty reason and clears interaction errors after close and reopen", () => {
    const actionCallbacks = callbacks();
    const actionHost = mount(
      <RouteActionMenu
        locale="en"
        routeStatus="active"
        version={{ ...version, status: "published" }}
        actions={["pause"]}
        readinessIssues={[]}
        dialogOpen
        onOpenDialog={vi.fn()}
        onCloseDialog={vi.fn()}
        {...actionCallbacks}
      />
    );
    clickButton(actionHost, "Route actions");
    clickButton(actionHost, "Pause");

    clickButton(actionHost, "Confirm");

    expect(actionCallbacks.onPause).not.toHaveBeenCalled();
    expect(actionHost.textContent).toContain("A reason is required for this action.");
    clickButton(actionHost, "Cancel");
    clickButton(actionHost, "Route actions");
    clickButton(actionHost, "Pause");
    expect(actionHost.textContent).not.toContain("A reason is required for this action.");
  });

  it.each([
    ["en", "Publish", ["publish", "retire"] as const, "Route version ID:"],
    ["en", "Retire", ["retire"] as const, "Route version ID:"],
    ["ar", "نشر", ["publish"] as const, "معرّف إصدار المسار:"]
  ] as const)("labels the version identifier for the %s %s confirmation", (locale, action, actions, identifierLabel) => {
    const actionHost = mount(
      <RouteActionMenu
        locale={locale}
        routeStatus="active"
        version={version}
        actions={[...actions]}
        readinessIssues={[]}
        dialogOpen
        onOpenDialog={vi.fn()}
        onCloseDialog={vi.fn()}
        {...callbacks()}
      />
    );
    clickButton(actionHost, locale === "ar" ? "إجراءات المسار" : "Route actions");
    clickButton(actionHost, action);

    const dialog = actionHost.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain(identifierLabel);
    expect(dialog.textContent).toContain("version_1");
  });

  it("does not render a version identifier for route retirement", () => {
    const actionHost = mount(
      <RouteActionMenu
        locale="en"
        routeStatus="active"
        version={version}
        actions={[]}
        readinessIssues={[]}
        dialogOpen
        onOpenDialog={vi.fn()}
        onCloseDialog={vi.fn()}
        {...callbacks()}
      />
    );
    clickButton(actionHost, "Route actions");
    clickButton(actionHost, "Retire route");

    const dialog = actionHost.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).not.toContain("Route version ID:");
    expect(dialog.textContent).not.toContain("version_1");
  });

  it("closes the menu on Escape and returns focus to its trigger", () => {
    const menuHost = mount(
      <RouteActionMenu
        locale="en"
        routeStatus="active"
        version={version}
        actions={["publish", "retire"]}
        readinessIssues={[]}
        dialogOpen={false}
        onOpenDialog={vi.fn()}
        onCloseDialog={vi.fn()}
        {...callbacks()}
      />
    );
    const trigger = clickButton(menuHost, "Route actions");
    expect(menuHost.querySelector<HTMLElement>('[role="menu"]')?.hidden).toBe(false);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(menuHost.querySelector<HTMLElement>('[role="menu"]')?.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it("closes the menu on pointer interaction outside the trigger and menu", () => {
    const menuHost = mount(
      <RouteActionMenu
        locale="en"
        routeStatus="active"
        version={version}
        actions={["publish", "retire"]}
        readinessIssues={[]}
        dialogOpen={false}
        onOpenDialog={vi.fn()}
        onCloseDialog={vi.fn()}
        {...callbacks()}
      />
    );
    clickButton(menuHost, "Route actions");
    const menu = menuHost.querySelector<HTMLElement>('[role="menu"]')!;
    expect(menu.hidden).toBe(false);

    act(() => menu.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(menu.hidden).toBe(false);

    act(() => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));

    expect(menu.hidden).toBe(true);
  });

  it("returns focus to the action trigger after dismissing confirmation", () => {
    const menuHost = mount(
      <RouteActionMenu
        locale="en"
        routeStatus="active"
        version={version}
        actions={["publish", "retire"]}
        readinessIssues={[]}
        dialogOpen
        onOpenDialog={vi.fn()}
        onCloseDialog={vi.fn()}
        {...callbacks()}
      />
    );
    const trigger = clickButton(menuHost, "Route actions");
    clickButton(menuHost, "Publish");
    clickButton(menuHost, "Cancel");

    expect(document.activeElement).toBe(trigger);
  });

  it("discards a pending lifecycle action and validation interaction when closed by its parent", () => {
    function Harness() {
      const [dialogOpen, setDialogOpen] = useState(false);
      return <>
        <button type="button" onClick={() => setDialogOpen(false)}>Parent close</button>
        <button type="button" onClick={() => setDialogOpen(true)}>Parent reopen</button>
        <RouteActionMenu
          locale="en"
          routeStatus="active"
          version={{ ...version, status: "published" }}
          actions={["pause"]}
          readinessIssues={[]}
          dialogOpen={dialogOpen}
          onOpenDialog={() => setDialogOpen(true)}
          onCloseDialog={() => setDialogOpen(false)}
          {...callbacks()}
        />
      </>;
    }

    const menuHost = mount(<Harness />);
    clickButton(menuHost, "Route actions");
    clickButton(menuHost, "Pause");
    expect(menuHost.querySelector('[role="dialog"]')).toBeTruthy();
    clickButton(menuHost, "Confirm");
    expect(menuHost.textContent).toContain("A reason is required for this action.");

    clickButton(menuHost, "Parent close");
    expect(menuHost.querySelector('[role="dialog"]')).toBeNull();
    clickButton(menuHost, "Parent reopen");

    expect(menuHost.querySelector('[role="dialog"]')).toBeNull();
    clickButton(menuHost, "Route actions");
    clickButton(menuHost, "Pause");
    expect(menuHost.textContent).not.toContain("A reason is required for this action.");
  });
});
