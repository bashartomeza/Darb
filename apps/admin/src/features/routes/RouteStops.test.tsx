// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanonicalStop, RouteStopDraft, ServiceRouteVersion } from "../../api";
import { RouteStops, type StopDialogMode } from "./RouteStops";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
  },
  {
    id: "stop_3",
    stop_key: "al-hussein",
    service_region_key: "south-west-bank",
    name_ar: "دوار الحسين",
    name_en: "Al-Hussein Roundabout",
    latitude: 31.532,
    longitude: 35.099,
    status: "active"
  }
];

const version: ServiceRouteVersion = {
  id: "version_1",
  service_route_id: "route_1",
  version_number: 1,
  status: "draft",
  name_ar: "الخليل الداخلية",
  name_en: "Hebron local",
  description_ar: null,
  description_en: null,
  active_from: null,
  active_until: null,
  draft_revision: 4,
  stop_count: 2,
  stops: canonicalStops.slice(0, 2).map((stop, index) => ({
    id: `membership_${index + 1}`,
    stop_id: stop.id,
    sequence: index + 1,
    passenger_pickup_allowed: index === 0,
    passenger_dropoff_allowed: index === 1,
    parcel_pickup_allowed: index === 0,
    parcel_dropoff_allowed: index === 1,
    stop
  })),
  geometry: { status: "pending", ready: false }
};

const memberships: RouteStopDraft[] = version.stops.map(({ id: _id, stop: _stop, ...membership }) => membership);

const noop = () => undefined;

function buttonNamed(host: ParentNode, name: string) {
  return [...host.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name)!;
}

function enterValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function renderStops(overrides: Partial<React.ComponentProps<typeof RouteStops>> = {}) {
  return <RouteStops
    locale="en"
    version={version}
    memberships={memberships}
    stops={canonicalStops}
    usedStopIds={new Set()}
    busy={false}
    feedback={null}
    dialogFeedback={null}
    dialog={null}
    selectedStopId={null}
    onOpenDialog={noop}
    onCloseDialog={noop}
    onMembershipsChange={noop}
    onSaveOrder={noop}
    onCreateStop={() => true}
    onEditStop={() => true}
    onRetireStop={() => true}
    {...overrides}
  />;
}

let mountedHost: HTMLDivElement | null = null;

afterEach(() => {
  vi.restoreAllMocks();
  mountedHost?.remove();
  mountedHost = null;
  document.body.replaceChildren();
});

describe("RouteStops", () => {
  it("renders ordered bilingual operational rows with explicit keyboard controls and no drag contract", () => {
    const markup = renderToStaticMarkup(renderStops());

    expect(markup.indexOf("Palestine Polytechnic University")).toBeLessThan(markup.indexOf("Bab Al-Zawiya"));
    for (const value of [
      "جامعة بوليتكنك فلسطين",
      "Palestine Polytechnic University",
      "باب الزاوية",
      "Bab Al-Zawiya",
      "Active",
      "Passenger pickup",
      "Passenger drop-off",
      "Parcel pickup",
      "Parcel drop-off",
      "Edit",
      "Remove",
      "Move up",
      "Move down"
    ]) expect(markup).toContain(value);
    expect(markup).toMatch(/aria-label="Move up stop 1"[^>]*disabled/);
    expect(markup).toContain('aria-label="Move down stop 1"');
    expect(markup).toContain('aria-label="Move up stop 2"');
    expect(markup).toMatch(/aria-label="Move down stop 2"[^>]*disabled/);
    expect(markup).not.toMatch(/draggable|drag(?:ging)?|drop to reorder/i);
  });

  it.each(["published", "paused", "retired"] as const)(
    "renders %s memberships without mutation controls",
    (status) => {
      const markup = renderToStaticMarkup(renderStops({ version: { ...version, status } }));

      expect(markup).toContain("Passenger pickup");
      expect(markup).toContain("Parcel drop-off");
      expect(markup).not.toMatch(/>Move up<|>Move down<|>Remove</);
      expect(markup).not.toContain('type="checkbox"');
      expect(markup).not.toContain("Save order");
    }
  );

  it("localizes Arabic reorder names without mixed-direction control copy", () => {
    const markup = renderToStaticMarkup(renderStops({ locale: "ar" }));

    expect(markup).toContain('aria-label="تحريك لأعلى للمحطة 1"');
    expect(markup).toContain('aria-label="تحريك لأسفل للمحطة 2"');
    expect(markup).not.toMatch(/aria-label="[^"]*stop \d/);
  });

  it("opens separate add-existing, create-new, and edit dialogs with focused fields", async () => {
    function Harness() {
      const [dialog, setDialog] = useState<StopDialogMode>(null);
      const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
      return renderStops({
        dialog,
        selectedStopId,
        onOpenDialog: (nextDialog, stopId) => {
          setDialog(nextDialog);
          setSelectedStopId(stopId ?? null);
        },
        onCloseDialog: () => {
          setDialog(null);
          setSelectedStopId(null);
        }
      });
    }

    mountedHost = document.createElement("div");
    document.body.append(mountedHost);
    const root = createRoot(mountedHost);
    await act(async () => { root.render(<Harness />); });

    const button = (label: string) => [...mountedHost!.querySelectorAll<HTMLButtonElement>("button")]
      .find((candidate) => candidate.textContent?.trim() === label)!;

    act(() => button("Add existing stop").click());
    let dialog = mountedHost.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Add existing stop");
    const options = [...dialog.querySelectorAll<HTMLOptionElement>("option")].map((option) => option.textContent);
    expect(options).toContain("Al-Hussein Roundabout");
    expect(options).not.toContain("Palestine Polytechnic University");
    expect(options).not.toContain("Bab Al-Zawiya");

    act(() => button("Close").click());
    act(() => button("Create new stop").click());
    dialog = mountedHost.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Create new stop");
    const createInputs = [...dialog.querySelectorAll<HTMLInputElement>("input")];
    expect(createInputs.map((input) => input.name)).toEqual([
      "stop_key",
      "service_region_key",
      "name_ar",
      "name_en",
      "latitude",
      "longitude"
    ]);
    expect(dialog.textContent).toContain("Coordinates are supplied manually.");
    const latitude = dialog.querySelector<HTMLInputElement>('input[name="latitude"]')!;
    const longitude = dialog.querySelector<HTMLInputElement>('input[name="longitude"]')!;
    expect([latitude.type, latitude.min, latitude.max, latitude.dir]).toEqual(["number", "-90", "90", "ltr"]);
    expect([longitude.type, longitude.min, longitude.max, longitude.dir]).toEqual(["number", "-180", "180", "ltr"]);
    expect([latitude.value, longitude.value]).toEqual(["", ""]);
    expect(dialog.textContent).not.toMatch(/geocod|provider|GPS|road.?snapp|map/i);

    act(() => button("Close").click());
    act(() => button("Edit").click());
    dialog = mountedHost.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Edit stop");
    expect(dialog.querySelector<HTMLInputElement>('input[name="stop_key"]')?.readOnly).toBe(true);
    expect(dialog.querySelectorAll("input")).toHaveLength(6);
    expect(dialog.textContent).not.toMatch(/geocod|provider|GPS|road.?snapp|map/i);
    root.unmount();
  });

  it("keeps membership changes local, re-sequences add/move/remove, and saves the full array explicitly", async () => {
    let saved: RouteStopDraft[] | null = null;

    function Harness() {
      const [localMemberships, setLocalMemberships] = useState(memberships);
      const [dialog, setDialog] = useState<StopDialogMode>(null);
      return renderStops({
        memberships: localMemberships,
        dialog,
        onOpenDialog: (nextDialog) => setDialog(nextDialog),
        onCloseDialog: () => setDialog(null),
        onMembershipsChange: setLocalMemberships,
        onSaveOrder: (nextMemberships) => { saved = nextMemberships; }
      });
    }

    mountedHost = document.createElement("div");
    document.body.append(mountedHost);
    const root = createRoot(mountedHost);
    await act(async () => { root.render(<Harness />); });
    const findButton = (label: string) => [...mountedHost!.querySelectorAll<HTMLButtonElement>("button")]
      .find((candidate) => candidate.textContent?.trim() === label)!;

    act(() => findButton("Add existing stop").click());
    const select = mountedHost.querySelector<HTMLSelectElement>('[role="dialog"] select[name="stop_id"]')!;
    const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    act(() => {
      selectSetter.call(select, "stop_3");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => select.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(saved).toBeNull();
    expect([...mountedHost.querySelectorAll<HTMLElement>(".route-stops__item")].map((row) => row.dataset.stopId)).toEqual([
      "stop_1",
      "stop_2",
      "stop_3"
    ]);

    act(() => mountedHost!.querySelector<HTMLButtonElement>('[aria-label="Move up stop 3"]')!.click());
    expect([...mountedHost.querySelectorAll<HTMLElement>(".route-stops__item")].map((row) => row.dataset.stopId)).toEqual([
      "stop_1",
      "stop_3",
      "stop_2"
    ]);
    act(() => mountedHost!.querySelector<HTMLButtonElement>('[aria-label="Remove stop 1"]')!.click());
    expect([...mountedHost.querySelectorAll<HTMLElement>(".route-stops__item")].map((row) => row.dataset.stopId)).toEqual([
      "stop_3",
      "stop_2"
    ]);

    act(() => findButton("Save order").click());
    expect(saved).toEqual([
      expect.objectContaining({ stop_id: "stop_3", sequence: 1 }),
      expect.objectContaining({ stop_id: "stop_2", sequence: 2 })
    ]);
    root.unmount();
  });

  it("cancels retirement, add-stop, and create-stop forms without submitting their mutations", async () => {
    const onRetireStop = vi.fn().mockResolvedValue(true);
    const onMembershipsChange = vi.fn();
    const onCreateStop = vi.fn().mockResolvedValue(true);
    const onCloseDialog = vi.fn();

    mountedHost = document.createElement("div");
    document.body.append(mountedHost);
    const root = createRoot(mountedHost);

    await act(async () => {
      root.render(renderStops({ onRetireStop, onMembershipsChange, onCreateStop, onCloseDialog }));
    });
    const catalogStop = mountedHost.querySelector<HTMLElement>('.route-stops__catalog-item[data-stop-id="stop_1"]')!;
    act(() => buttonNamed(catalogStop, "Retire").click());
    const retirementForm = catalogStop.querySelector<HTMLFormElement>(".route-stops__retirement")!;
    enterValue(retirementForm.querySelector("input")!, "Duplicate stop");
    const retirementCancel = buttonNamed(retirementForm, "Cancel");
    expect(retirementCancel.type).toBe("button");
    act(() => retirementCancel.click());
    expect(onRetireStop).not.toHaveBeenCalled();

    await act(async () => {
      root.render(renderStops({ dialog: "add-stop", onRetireStop, onMembershipsChange, onCreateStop, onCloseDialog }));
    });
    const addStopCancel = buttonNamed(mountedHost!, "Cancel");
    expect(addStopCancel.type).toBe("button");
    act(() => addStopCancel.click());
    expect(onMembershipsChange).not.toHaveBeenCalled();

    await act(async () => {
      root.render(renderStops({ dialog: "create-stop", onRetireStop, onMembershipsChange, onCreateStop, onCloseDialog }));
    });
    for (const [name, value] of Object.entries({
      stop_key: "new-stop",
      service_region_key: "south-west-bank",
      name_ar: "محطة جديدة",
      name_en: "New stop"
    })) enterValue(mountedHost.querySelector<HTMLInputElement>(`input[name="${name}"]`)!, value);
    const createStopCancel = buttonNamed(mountedHost!, "Cancel");
    expect(createStopCancel.type).toBe("button");
    act(() => createStopCancel.click());
    expect(onCreateStop).not.toHaveBeenCalled();
    expect(onCloseDialog).toHaveBeenCalledTimes(2);
    root.unmount();
  });

  it("reopens create-stop with a blank draft and no stale coordinate error", async () => {
    function Harness() {
      const [dialog, setDialog] = useState<StopDialogMode>(null);
      return renderStops({
        dialog,
        onOpenDialog: (nextDialog) => setDialog(nextDialog),
        onCloseDialog: () => setDialog(null)
      });
    }

    mountedHost = document.createElement("div");
    document.body.append(mountedHost);
    const root = createRoot(mountedHost);
    await act(async () => { root.render(<Harness />); });

    act(() => buttonNamed(mountedHost!, "Create new stop").click());
    enterValue(mountedHost.querySelector<HTMLInputElement>('input[name="name_en"]')!, "Discard me");
    const form = mountedHost.querySelector<HTMLFormElement>('[role="dialog"] form')!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(form.textContent).toContain("Enter valid latitude (-90 to 90) and longitude (-180 to 180).");

    act(() => buttonNamed(form, "Cancel").click());
    act(() => buttonNamed(mountedHost!, "Create new stop").click());
    const reopened = mountedHost.querySelector<HTMLFormElement>('[role="dialog"] form')!;
    expect([...reopened.querySelectorAll<HTMLInputElement>("input")].map((input) => input.value)).toEqual(["", "", "", "", "", ""]);
    expect(reopened.textContent).not.toContain("Enter valid latitude (-90 to 90) and longitude (-180 to 180).");
    root.unmount();
  });

  it.each([
    { field: "latitude", value: "", label: "blank latitude" },
    { field: "longitude", value: "", label: "blank longitude" },
    { field: "latitude", value: "90.000001", label: "latitude above 90" },
    { field: "longitude", value: "-180.000001", label: "longitude below -180" }
  ] as const)("blocks create-stop submission for $label", async ({ field, value }) => {
    const onCreateStop = vi.fn().mockResolvedValue(true);
    mountedHost = document.createElement("div");
    document.body.append(mountedHost);
    const root = createRoot(mountedHost);

    await act(async () => {
      root.render(renderStops({ dialog: "create-stop", onCreateStop }));
    });
    enterValue(mountedHost.querySelector<HTMLInputElement>(`input[name="${field}"]`)!, value);
    const form = mountedHost.querySelector<HTMLFormElement>('[role="dialog"] form')!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(onCreateStop).not.toHaveBeenCalled();
    expect(form.textContent).toContain("Enter valid latitude (-90 to 90) and longitude (-180 to 180).");
    root.unmount();
  });

  it("submits explicit zero coordinates as numeric zero", async () => {
    const onCreateStop = vi.fn().mockResolvedValue(true);
    mountedHost = document.createElement("div");
    document.body.append(mountedHost);
    const root = createRoot(mountedHost);

    await act(async () => {
      root.render(renderStops({ dialog: "create-stop", onCreateStop }));
    });
    enterValue(mountedHost.querySelector<HTMLInputElement>('input[name="latitude"]')!, "0");
    enterValue(mountedHost.querySelector<HTMLInputElement>('input[name="longitude"]')!, "0");
    const form = mountedHost.querySelector<HTMLFormElement>('[role="dialog"] form')!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(onCreateStop).toHaveBeenCalledWith(expect.objectContaining({ latitude: 0, longitude: 0 }));
    root.unmount();
  });

  it("closes create and edit dialogs only after their mutations succeed", async () => {
    let createSucceeds: boolean | undefined;
    let editSucceeds = false;
    let createAttempts = 0;
    let editAttempts = 0;

    function Harness() {
      const [dialog, setDialog] = useState<StopDialogMode>("create-stop");
      const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
      return renderStops({
        dialog,
        selectedStopId,
        onOpenDialog: (nextDialog, stopId) => {
          setDialog(nextDialog);
          setSelectedStopId(stopId ?? null);
        },
        onCloseDialog: () => setDialog(null),
        onCreateStop: async () => {
          createAttempts += 1;
          return createSucceeds;
        },
        onEditStop: async () => {
          editAttempts += 1;
          return editSucceeds;
        }
      });
    }

    mountedHost = document.createElement("div");
    document.body.append(mountedHost);
    const root = createRoot(mountedHost);
    await act(async () => { root.render(<Harness />); });

    let form = mountedHost.querySelector<HTMLFormElement>('[role="dialog"] form')!;
    enterValue(form.querySelector<HTMLInputElement>('input[name="latitude"]')!, "0");
    enterValue(form.querySelector<HTMLInputElement>('input[name="longitude"]')!, "0");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); });
    expect(createAttempts).toBe(1);
    expect(mountedHost.querySelector('[role="dialog"]')).not.toBeNull();
    createSucceeds = true;
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); });
    expect(mountedHost.querySelector('[role="dialog"]')).toBeNull();

    act(() => [...mountedHost!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Edit")!.click());
    form = mountedHost.querySelector<HTMLFormElement>('[role="dialog"] form')!;
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); });
    expect(editAttempts).toBe(1);
    expect(mountedHost.querySelector('[role="dialog"]')).not.toBeNull();
    editSucceeds = true;
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); });
    expect(mountedHost.querySelector('[role="dialog"]')).toBeNull();
    root.unmount();
  });

  it("keeps a used active stop immutable and treats the reasoned inline form as its single retirement confirmation", async () => {
    let retirement: { stopId: string; reason: string } | null = null;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onRetireStop = vi.fn(async (stop: CanonicalStop, reason: string) => {
      retirement = { stopId: stop.id, reason };
      return true;
    });

    mountedHost = document.createElement("div");
    document.body.append(mountedHost);
    const root = createRoot(mountedHost);
    await act(async () => {
      root.render(renderStops({
        usedStopIds: new Set(["stop_1"]),
        onRetireStop
      }));
    });

    const usedStop = mountedHost.querySelector<HTMLElement>('.route-stops__catalog-item[data-stop-id="stop_1"]')!;
    const labels = [...usedStop.querySelectorAll<HTMLButtonElement>("button")].map((button) => button.textContent?.trim());
    expect(labels).not.toContain("Edit");
    expect(labels).toContain("Retire");

    act(() => [...usedStop.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Retire")!.click());
    const form = usedStop.querySelector<HTMLFormElement>(".route-stops__retirement")!;
    const reason = form.querySelector<HTMLInputElement>("input")!;
    const submit = [...form.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Confirm retirement")!;
    expect(reason.required).toBe(true);
    expect(submit.disabled).toBe(true);
    expect(form.textContent).toContain("Retire this stop? The action will be recorded in the audit log.");

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(retirement).toBeNull();

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(reason, "Duplicate operational stop");
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(submit.disabled).toBe(false);
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(onRetireStop).toHaveBeenCalledTimes(1);
    expect(retirement).toEqual({ stopId: "stop_1", reason: "Duplicate operational stop" });
    expect(usedStop.querySelector(".route-stops__retirement")).toBeNull();
    root.unmount();
  });
});
