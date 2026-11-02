// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateRouteDialog } from "./CreateRouteDialog";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function renderDialog(props: Partial<React.ComponentProps<typeof CreateRouteDialog>> = {}) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<CreateRouteDialog open locale="en" onClose={vi.fn()} onSubmit={vi.fn()} {...props} />));
  return host;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.replaceChildren();
});

describe("CreateRouteDialog", () => {
  it("renders no form while closed", () => {
    expect(renderToStaticMarkup(<CreateRouteDialog open={false} locale="en" onClose={vi.fn()} onSubmit={vi.fn()} />)).toBe("");
  });

  it("renders only the required route identity fields and dialog-local feedback", () => {
    const markup = renderToStaticMarkup(
      <CreateRouteDialog open locale="en" error="The route catalog could not be loaded." busy onClose={vi.fn()} onSubmit={vi.fn()} />
    );

    expect(markup).toContain('name="route_key"');
    expect(markup).toContain('name="route_group_key"');
    expect(markup).toContain('name="service_region_key"');
    expect(markup).toContain('name="direction"');
    expect(markup).toContain("Route key");
    expect(markup).toContain("Direction group");
    expect(markup).toContain("Service region");
    expect(markup).toContain('dir="ltr"');
    expect(markup).toContain("The route catalog could not be loaded.");
    expect(markup).not.toMatch(/Arabic name|English name|name="version|name="stop|>Publish<|>Pause<|Map preview|Action reason/i);
  });

  it("keeps a whitespace-only identity in the dialog and does not submit it", () => {
    const onSubmit = vi.fn();
    const dialog = renderDialog({ onSubmit });
    const form = dialog.querySelector("form")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;

    for (const input of form.querySelectorAll<HTMLInputElement>("input")) {
      act(() => {
        setter.call(input, "   ");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }

    act(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(new FormData(form).get("route_key")).toBe("   ");
    expect(new FormData(form).get("route_group_key")).toBe("   ");
    expect(new FormData(form).get("service_region_key")).toBe("   ");
    expect(dialog.textContent).toContain("Enter a route key, direction group, and service region.");
  });
});
