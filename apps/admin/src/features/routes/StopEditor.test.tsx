// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanonicalStop } from "../../api";
import { StopEditor } from "./StopEditor";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const activeStop: CanonicalStop = {
  id: "stop_1",
  stop_key: "ppu-main",
  service_region_key: "south-west-bank",
  name_ar: "جامعة بوليتكنك فلسطين",
  name_en: "Palestine Polytechnic University",
  latitude: 31.507316,
  longitude: 35.090893,
  status: "active"
};

describe("StopEditor", () => {
  afterEach(() => document.body.replaceChildren());

  async function mountEditor(onSave: Parameters<typeof StopEditor>[0]["onSave"], locale: "ar" | "en" = "en") {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<StopEditor stop={activeStop} used={false} busy={false} locale={locale} onSave={onSave} />);
    });
    return { host, root };
  }

  function enterValue(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function submit(host: HTMLElement) {
    await act(async () => {
      host.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
  }

  it("renders a focused bilingual manual-coordinate form for an active unused stop", () => {
    const markup = renderToStaticMarkup(
      <StopEditor stop={activeStop} used={false} busy={false} locale="en" onSave={vi.fn()} />
    );

    expect(markup).toContain("Arabic name");
    expect(markup).toContain("English name");
    expect(markup).toContain("Service region");
    expect(markup).toContain("Latitude");
    expect(markup).toContain("Longitude");
    expect(markup).toContain("Coordinates are supplied manually.");
    const parsed = document.createElement("div");
    parsed.innerHTML = markup;
    const stopKey = parsed.querySelector<HTMLInputElement>('input[name="stop_key"]')!;
    const serviceRegion = parsed.querySelector<HTMLInputElement>('input[name="service_region_key"]')!;
    expect(stopKey.readOnly).toBe(true);
    expect(stopKey.hasAttribute("readonly")).toBe(true);
    expect(serviceRegion.readOnly).toBe(false);
    expect(serviceRegion.hasAttribute("readonly")).toBe(false);
    expect(serviceRegion.disabled).toBe(false);
    expect(markup).toMatch(/<input(?=[^>]*name="latitude")(?=[^>]*type="number")(?=[^>]*min="-90")(?=[^>]*max="90")(?=[^>]*dir="ltr")[^>]*>/);
    expect(markup).toMatch(/<input(?=[^>]*name="longitude")(?=[^>]*type="number")(?=[^>]*min="-180")(?=[^>]*max="180")(?=[^>]*dir="ltr")[^>]*>/);
    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('dir="ltr"');
    expect(markup).not.toMatch(/geocod|provider|GPS|road.?snapp|map/i);
  });

  it("keeps retired and already-used stops free of edit affordances", () => {
    const retired = renderToStaticMarkup(
      <StopEditor stop={{ ...activeStop, status: "retired" }} used={false} busy={false} locale="en" onSave={vi.fn()} />
    );
    const used = renderToStaticMarkup(
      <StopEditor stop={activeStop} used busy={false} locale="en" onSave={vi.fn()} />
    );

    expect(retired).not.toContain("<form");
    expect(retired).not.toContain("Save changes");
    expect(used).not.toContain("<form");
    expect(used).not.toContain("Save changes");
  });

  it("provides complete Arabic edit and manual-coordinate guidance", () => {
    const markup = renderToStaticMarkup(
      <StopEditor stop={activeStop} used={false} busy={false} locale="ar" onSave={vi.fn()} />
    );

    expect(markup).toContain("الاسم بالعربية");
    expect(markup).toContain("الاسم بالإنجليزية");
    expect(markup).toContain("الإحداثيات مُدخلة يدوياً.");
    expect(markup).not.toMatch(/خريطة|مزود|GPS/i);
  });

  it("submits the immutable key with edited allowlisted stop fields", async () => {
    let submitted: { id: string; stopKey: string; name: string } | null = null;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<StopEditor
        stop={activeStop}
        used={false}
        busy={false}
        locale="en"
        onSave={(id, draft) => { submitted = { id, stopKey: draft.stop_key, name: draft.name_en }; }}
      />);
    });
    const name = host.querySelector<HTMLInputElement>('input[name="name_en"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(name, "PPU Main Gate");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(submitted).toEqual({ id: "stop_1", stopKey: "ppu-main", name: "PPU Main Gate" });
    root.unmount();
  });

  it("keeps an emptied coordinate raw and rejects it before save", async () => {
    const onSave = vi.fn();
    const { host, root } = await mountEditor(onSave);
    const latitude = host.querySelector<HTMLInputElement>('input[name="latitude"]')!;

    enterValue(latitude, "");
    expect(latitude.value).toBe("");
    await submit(host);

    expect(onSave).not.toHaveBeenCalled();
    root.unmount();
  });

  it.each([
    { locale: "en" as const, message: "Enter valid latitude (-90 to 90) and longitude (-180 to 180)." },
    { locale: "ar" as const, message: "أدخل خط عرض صالحاً (من -90 إلى 90) وخط طول صالحاً (من -180 إلى 180)." }
  ])("shows a localized $locale coordinate error and blocks save", async ({ locale, message }) => {
    const onSave = vi.fn();
    const { host, root } = await mountEditor(onSave, locale);

    enterValue(host.querySelector<HTMLInputElement>('input[name="latitude"]')!, "");
    await submit(host);

    expect(host.querySelector('.stop-editor-form [role="alert"]')?.textContent).toBe(message);
    expect(onSave).not.toHaveBeenCalled();
    root.unmount();
  });

  it("clears coordinate feedback as soon as the draft becomes valid and submits it", async () => {
    const onSave = vi.fn();
    const { host, root } = await mountEditor(onSave);
    const latitude = host.querySelector<HTMLInputElement>('input[name="latitude"]')!;

    enterValue(latitude, "");
    await submit(host);
    expect(host.querySelector('.stop-editor-form [role="alert"]')).not.toBeNull();

    enterValue(latitude, "31.5");
    expect(host.querySelector('.stop-editor-form [role="alert"]')).toBeNull();
    await submit(host);

    expect(onSave).toHaveBeenCalledWith("stop_1", expect.objectContaining({ latitude: 31.5, longitude: 35.090893 }));
    expect(host.querySelector('.stop-editor-form [role="alert"]')).toBeNull();
    root.unmount();
  });

  it.each([
    { field: "latitude", value: "1e999", label: "non-finite latitude" },
    { field: "latitude", value: "90.000001", label: "latitude above 90" },
    { field: "longitude", value: "-180.000001", label: "longitude below -180" }
  ])("rejects $label before save", async ({ field, value }) => {
    const onSave = vi.fn();
    const { host, root } = await mountEditor(onSave);

    enterValue(host.querySelector<HTMLInputElement>(`input[name="${field}"]`)!, value);
    await submit(host);

    expect(onSave).not.toHaveBeenCalled();
    root.unmount();
  });

  it("preserves valid zero coordinates in the save payload", async () => {
    const onSave = vi.fn();
    const { host, root } = await mountEditor(onSave);

    enterValue(host.querySelector<HTMLInputElement>('input[name="latitude"]')!, "0");
    enterValue(host.querySelector<HTMLInputElement>('input[name="longitude"]')!, "0");
    await submit(host);

    expect(onSave).toHaveBeenCalledWith("stop_1", expect.objectContaining({ latitude: 0, longitude: 0 }));
    root.unmount();
  });
});
