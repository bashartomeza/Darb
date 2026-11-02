// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouteDialog } from "./RouteDialog";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function renderDialog(dialog: ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(dialog));
  return host;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.replaceChildren();
});

describe("RouteDialog", () => {
  it("renders a labeled modal dialog with localized close affordances and supplied direction", () => {
    const markup = renderToStaticMarkup(
      <RouteDialog open title="إنشاء مسار" description="أدخل هوية المسار" dir="rtl" onClose={vi.fn()}>
        <button type="button" autoFocus>متابعة</button>
      </RouteDialog>
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toMatch(/aria-labelledby="[^"]+"/);
    expect(markup).toContain('aria-label="إغلاق"');
    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain("أدخل هوية المسار");
  });

  it("renders no closed dialog markup", () => {
    expect(renderToStaticMarkup(
      <RouteDialog open={false} title="Create route" onClose={vi.fn()}>Content</RouteDialog>
    )).toBe("");
  });

  it("disables close affordances while busy", () => {
    const markup = renderToStaticMarkup(
      <RouteDialog open title="Create route" busy onClose={vi.fn()}>Content</RouteDialog>
    );

    expect(markup).toMatch(/<button(?=[^>]*aria-label="Close")(?=[^>]*disabled="")[^>]*>/);
    expect(markup).toContain('aria-disabled="true"');
  });

  it("focuses an autofocus control, falls back to the dialog, and restores focus when closed", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const dialogHost = renderDialog(
      <RouteDialog open title="Create route" busy onClose={onClose}><p>Saving route…</p></RouteDialog>
    );

    const dialog = dialogHost.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(document.activeElement).toBe(dialog);

    act(() => root?.render(<RouteDialog open={false} title="Create route" busy onClose={onClose}><p>Saving route…</p></RouteDialog>));
    expect(document.activeElement).toBe(trigger);
  });

  it("focuses the autofocus descendant when one is supplied", () => {
    const dialogHost = renderDialog(
      <RouteDialog open title="Create route" onClose={vi.fn()}><input autoFocus /></RouteDialog>
    );

    expect(document.activeElement).toBe(dialogHost.querySelector("input"));
  });

  it("contains Tab and Shift+Tab within the dialog", () => {
    const dialogHost = renderDialog(
      <RouteDialog open title="Create route" onClose={vi.fn()}>
        <button type="button">First action</button>
        <button type="button">Last action</button>
      </RouteDialog>
    );
    const close = dialogHost.querySelector<HTMLButtonElement>('[aria-label="Close"]')!;
    const last = [...dialogHost.querySelectorAll<HTMLButtonElement>("button")].at(-1)!;

    last.focus();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(close);

    close.focus();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(last);
  });

  it("closes on idle Escape and ignores Escape while busy", () => {
    const onIdleClose = vi.fn();
    renderDialog(<RouteDialog open title="Create route" onClose={onIdleClose}>Content</RouteDialog>);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onIdleClose).toHaveBeenCalledTimes(1);

    act(() => root?.unmount());
    const onBusyClose = vi.fn();
    renderDialog(<RouteDialog open title="Create route" busy onClose={onBusyClose}>Content</RouteDialog>);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onBusyClose).not.toHaveBeenCalled();
  });

  it("preserves current focus across busy and callback rerenders while using their latest values", () => {
    const originalClose = vi.fn();
    const latestClose = vi.fn();
    const dialogHost = renderDialog(
      <RouteDialog open title="Create route" onClose={originalClose}>
        <input autoFocus aria-label="First field" />
        <input aria-label="Current field" />
      </RouteDialog>
    );
    const current = dialogHost.querySelector<HTMLInputElement>('[aria-label="Current field"]')!;
    current.focus();

    act(() => root?.render(
      <RouteDialog open title="Create route" busy onClose={latestClose}>
        <input autoFocus aria-label="First field" />
        <input aria-label="Current field" />
      </RouteDialog>
    ));
    expect(document.activeElement).toBe(current);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(originalClose).not.toHaveBeenCalled();
    expect(latestClose).not.toHaveBeenCalled();

    act(() => root?.render(
      <RouteDialog open title="Create route" onClose={latestClose}>
        <input autoFocus aria-label="First field" />
        <input aria-label="Current field" />
      </RouteDialog>
    ));
    expect(document.activeElement).toBe(current);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(originalClose).not.toHaveBeenCalled();
    expect(latestClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses only backdrop clicks and suppresses busy close events", () => {
    const onClose = vi.fn();
    const dialogHost = renderDialog(<RouteDialog open title="Create route" onClose={onClose}>Content</RouteDialog>);
    const backdrop = dialogHost.querySelector<HTMLElement>(".route-dialog-backdrop")!;
    const dialog = dialogHost.querySelector<HTMLElement>(".route-dialog")!;

    act(() => dialog.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onClose).not.toHaveBeenCalled();
    act(() => backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => root?.unmount());
    const onBusyClose = vi.fn();
    const busyHost = renderDialog(<RouteDialog open title="Create route" busy onClose={onBusyClose}>Content</RouteDialog>);
    act(() => busyHost.querySelector<HTMLElement>(".route-dialog-backdrop")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => busyHost.querySelector<HTMLButtonElement>('[aria-label="Close"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onBusyClose).not.toHaveBeenCalled();
  });

  it("restores focus when the dialog unmounts", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    renderDialog(<RouteDialog open title="Create route" onClose={vi.fn()}>Content</RouteDialog>);

    act(() => root?.unmount());
    expect(document.activeElement).toBe(trigger);
  });
});
