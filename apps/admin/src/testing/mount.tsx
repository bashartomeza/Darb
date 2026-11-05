import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LocaleProvider } from "../i18n/LocaleContext";
import type { Locale } from "../i18n/translations";

/**
 * Test helpers for jsdom suites: mount a component inside the locale provider,
 * let pending promises settle, and find controls by their visible text.
 */
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

export async function settle(rounds = 8) {
  await act(async () => {
    for (let index = 0; index < rounds; index += 1) await Promise.resolve();
  });
}

export async function mount(children: ReactNode, locale: Locale = "en") {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const storage = { getItem: () => locale, setItem: () => undefined };
  const documentRef = { documentElement: { lang: "", dir: "" } };
  await act(async () => {
    root?.render(<LocaleProvider storage={storage} documentRef={documentRef}>{children}</LocaleProvider>);
  });
  await settle();
  return host;
}

export function unmount() {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.replaceChildren();
}

export function buttonNamed(scope: ParentNode, name: string) {
  const button = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.trim() === name);
  if (!button) throw new Error(`No button named ${name}`);
  return button;
}

export function buttonsNamed(scope: ParentNode, name: string) {
  return [...scope.querySelectorAll<HTMLButtonElement>("button")].filter((candidate) => candidate.textContent?.trim() === name);
}

export async function click(element: HTMLElement) {
  await act(async () => element.click());
  await settle();
}

export async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

/** Sets a controlled input's value the way React notices. */
export async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export function dialog() {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

export function selectLabelled(scope: ParentNode, label: string) {
  const match = [...scope.querySelectorAll("label")].find((candidate) => candidate.textContent?.startsWith(label));
  const select = match?.querySelector("select");
  if (!select) throw new Error(`No select labelled ${label}`);
  return select;
}

export function inputNamed(scope: ParentNode, name: string) {
  const input = scope.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!input) throw new Error(`No input named ${name}`);
  return input;
}
