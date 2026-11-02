// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServiceRoute, ServiceRouteVersion } from "../../api";
import { formatDateTime } from "../../i18n/locale";
import { RouteVersions } from "./RouteVersions";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const versions: ServiceRouteVersion[] = [
  {
    id: "version_draft",
    service_route_id: "route_1",
    version_number: 3,
    status: "draft",
    name_ar: "الخليل المحلي",
    name_en: "Hebron local draft",
    description_ar: "وصف المسودة",
    description_en: "Draft description",
    active_from: "2026-08-25T06:00:00.000Z",
    active_until: "2026-08-25T20:00:00.000Z",
    draft_revision: 4,
    stop_count: 3,
    stops: [],
    geometry: { status: "pending", ready: false }
  },
  {
    id: "version_published",
    service_route_id: "route_1",
    version_number: 2,
    status: "published",
    name_ar: "الخليل إلى بيت لحم",
    name_en: "Hebron to Bethlehem",
    description_ar: null,
    description_en: "Published description",
    active_from: "2026-08-01T06:00:00.000Z",
    active_until: "2026-08-01T20:00:00.000Z",
    draft_revision: 2,
    stop_count: 2,
    stops: [],
    geometry: { status: "available", ready: true }
  },
  {
    id: "version_retired",
    service_route_id: "route_1",
    version_number: 1,
    status: "retired",
    name_ar: "إصدار متقاعد",
    name_en: "Retired route",
    description_ar: null,
    description_en: null,
    active_from: null,
    active_until: null,
    draft_revision: 1,
    stop_count: 1,
    stops: [],
    geometry: { status: "unavailable", ready: false }
  }
];

const route: ServiceRoute = {
  id: "route_1",
  route_key: "hebron-local",
  route_group_key: "hebron",
  service_region_key: "south-west-bank",
  direction: "outbound",
  status: "active",
  current_version_id: "version_published",
  current_version: versions[1],
  versions,
  version_count: 5,
  created_at: "2026-08-25T00:00:00.000Z",
  updated_at: "2026-08-25T00:00:00.000Z"
};

let host: HTMLDivElement | null = null;

afterEach(() => {
  host?.remove();
  host = null;
  document.body.replaceChildren();
});

function renderVersions(overrides: Partial<React.ComponentProps<typeof RouteVersions>> = {}) {
  return <RouteVersions
    locale="en"
    route={route}
    selectedVersion={versions[0]}
    editing={false}
    busy={false}
    feedback={null}
    onSelectVersion={vi.fn()}
    onCreateDraft={vi.fn()}
    onBeginEdit={vi.fn()}
    onSaveDraft={vi.fn()}
    onCancelEdit={vi.fn()}
    {...overrides}
  />;
}

describe("RouteVersions", () => {
  it("renders supplied bounded version rows with status, dates, stops, current state, and one focused workspace", () => {
    const markup = renderToStaticMarkup(renderVersions());

    for (const version of versions) {
      expect(markup).toContain(`v${version.version_number}`);
      expect(markup).toContain(version.id);
      expect(markup).toContain(version.status[0].toUpperCase() + version.status.slice(1));
      expect(markup).toContain(`${version.stop_count} stops`);
    }
    expect(markup).toContain(formatDateTime("en", versions[0].active_from ?? undefined));
    expect(markup).toContain("Current");
    expect(markup).toContain("Open");
    expect(markup).toContain("Showing the newest 3 of 5 route versions.");
    expect((markup.match(/<h3>Version details<\/h3>/g) ?? [])).toHaveLength(1);
    expect(markup).toContain("Hebron local draft");
    expect(markup).not.toContain("Hebron to Bethlehem</strong>");
  });

  it("omits the truncated-history note when the supplied projection is complete", () => {
    const markup = renderToStaticMarkup(renderVersions({ route: { ...route, version_count: versions.length } }));

    expect(markup).toContain("Showing 3 of 3 route versions.");
    expect(markup).not.toContain("Showing the newest");
  });

  it("renders successful version-editor feedback as a success notice", () => {
    const markup = renderToStaticMarkup(renderVersions({
      feedback: { kind: "success", text: "Saved successfully." }
    }));

    expect(markup).toContain("notice--success");
    expect(markup).toContain("Saved successfully.");
  });

  it("selects exactly one version workspace from its Open control", () => {
    const onSelectVersion = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => { root.render(renderVersions({ onSelectVersion })); });
    const row = host.querySelector<HTMLElement>('[data-route-version-id="version_published"]')!;
    act(() => { row.querySelector<HTMLButtonElement>("button")!.click(); });

    expect(onSelectVersion).toHaveBeenCalledTimes(1);
    expect(onSelectVersion).toHaveBeenCalledWith(versions[1]);
    expect(host.querySelectorAll(".route-version-editor")).toHaveLength(1);
    root.unmount();
  });

  it("creates a new draft through the existing bounded create callback", async () => {
    const onCreateDraft = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => { root.render(renderVersions({ onCreateDraft })); });
    const create = [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Create version")!;
    act(() => create.click());
    const form = host.querySelector<HTMLFormElement>(".route-version-create form")!;
    const name = form.querySelector<HTMLInputElement>('input[name="name_en"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(name, "New draft");
      name.dispatchEvent(new Event("input", { bubbles: true }));
      name.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });

    expect(onCreateDraft).toHaveBeenCalledWith(expect.objectContaining({ name_en: "New draft" }));
    root.unmount();
  });

  it("discards an unfinished create draft whenever the create form closes", async () => {
    host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const createButton = () => [...host!.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Create version")!;
    const cancelButton = () => [...host!.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Cancel")!;
    const enterName = (value: string) => {
      const input = host!.querySelector<HTMLInputElement>('.route-version-create input[name="name_en"]')!;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      act(() => {
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };

    await act(async () => { root.render(renderVersions()); });
    act(() => createButton().click());
    enterName("Discard on cancel");
    act(() => cancelButton().click());
    act(() => createButton().click());
    expect(host.querySelector<HTMLInputElement>('.route-version-create input[name="name_en"]')?.value).toBe("");

    enterName("Discard on version change");
    await act(async () => { root.render(renderVersions({ selectedVersion: versions[1] })); });
    expect(host.querySelector(".route-version-create")).toBeNull();
    act(() => createButton().click());
    expect(host.querySelector<HTMLInputElement>('.route-version-create input[name="name_en"]')?.value).toBe("");
    root.unmount();
  });

  it("keeps a draft read-only until explicit Edit draft, then exposes six fields plus explicit Save changes and Cancel", () => {
    const readOnly = renderToStaticMarkup(renderVersions());
    const editing = renderToStaticMarkup(renderVersions({ editing: true }));

    expect(readOnly).toContain("Edit draft");
    expect(readOnly).not.toContain("Save changes");
    expect(readOnly).not.toContain("<input");
    expect(editing).toContain("Save changes");
    expect(editing).toContain("Cancel");
    expect((editing.match(/<input|<textarea/g) ?? [])).toHaveLength(6);
    expect(editing).toMatch(/dir="rtl"[^>]*name="name_ar"/);
    expect(editing).toMatch(/dir="ltr"[^>]*name="name_en"/);
  });

  it.each(["published", "paused", "retired"] as const)("renders %s versions as immutable summaries", (status) => {
    const markup = renderToStaticMarkup(renderVersions({ selectedVersion: { ...versions[1], status } }));

    expect(markup).not.toContain("Edit draft");
    expect(markup).not.toContain("Save changes");
    expect(markup).not.toContain("<input");
    expect(markup).toContain("Hebron to Bethlehem");
    expect(markup).toContain('dir="ltr">version_published');
  });
});
