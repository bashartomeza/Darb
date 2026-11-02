/// <reference types="node" />

import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ServiceRoute } from "../../api";
import { RouteDirectory } from "./RouteDirectory";

const route: ServiceRoute = {
  id: "route_1",
  route_key: "hebron-bethlehem",
  route_group_key: "hebron-bethlehem",
  service_region_key: "south-west-bank",
  direction: "outbound",
  status: "active",
  current_version_id: "version_1",
  current_version: {
    id: "version_1",
    service_route_id: "route_1",
    version_number: 1,
    status: "published",
    name_ar: "الخليل إلى بيت لحم",
    name_en: "Hebron to Bethlehem",
    description_ar: null,
    description_en: null,
    active_from: null,
    active_until: null,
    draft_revision: 1,
    stop_count: 4,
    stops: [],
    geometry: { status: "available", ready: true }
  },
  version_count: 1,
  created_at: "2026-08-25T00:00:00.000Z",
  updated_at: "2026-08-25T00:00:00.000Z"
};

describe("RouteDirectory", () => {
  it("renders a compact, localized directory without route workspace controls", () => {
    const markup = renderToStaticMarkup(
      <RouteDirectory
        locale="en"
        routes={[route]}
        view="ready"
        page={2}
        total={52}
        filters={{ search: "Hebron", status: "active", direction: "outbound", serviceRegionKey: "south-west-bank" }}
        onSearch={vi.fn()}
        onPage={vi.fn()}
        onOpenRoute={vi.fn()}
        onCreateRoute={vi.fn()}
      />
    );

    expect(markup).toContain("Route management");
    expect(markup).toContain("Browse approved route identities and open one to manage its versions and stops.");
    expect(markup.match(/Create route/g)).toHaveLength(1);
    expect(markup).toContain("Search by name or key");
    expect(markup).toContain("Route status filter");
    expect(markup).toContain("Direction filter");
    expect(markup).toContain("Service region filter");
    expect(markup).toContain("Hebron to Bethlehem");
    expect(markup).toContain('dir="ltr">hebron-bethlehem');
    expect(markup).toContain("south-west-bank");
    expect(markup).toContain("Outbound");
    expect(markup).toContain("Route status");
    expect(markup).toContain("Current version status");
    expect(markup).toContain("4 stops");
    expect(markup).toContain(">Open<");
    expect(markup).toContain("Previous");
    expect(markup).toContain("Next");
    expect(markup).not.toMatch(/Arabic name|English name|New draft version|Add existing stop|>Publish<|>Pause<|Action reason/i);
  });

  it.each([
    { locale: "en" as const, fallback: "Status", direction: "Outbound", versionStatus: "Published" },
    { locale: "ar" as const, fallback: "الحالة", direction: "ذهاب", versionStatus: "منشور" }
  ])("renders the localized generic fallback for an unknown $locale route status", ({ locale, fallback, direction, versionStatus }) => {
    const unknownStatus = "future_route_state";
    const markup = renderToStaticMarkup(
      <RouteDirectory
        locale={locale}
        routes={[{ ...route, status: unknownStatus as ServiceRoute["status"] }]}
        view="ready"
        page={1}
        total={1}
        filters={{ search: "", status: "", direction: "", serviceRegionKey: "" }}
        onSearch={vi.fn()}
        onPage={vi.fn()}
        onOpenRoute={vi.fn()}
        onCreateRoute={vi.fn()}
      />
    );

    expect(markup).toContain(fallback);
    expect(markup).toContain(direction);
    expect(markup).toContain(versionStatus);
    expect(markup).not.toContain(unknownStatus);
  });

  it("switches result rows by available container width before fixed desktop columns can clip", () => {
    const styles = readFileSync(new URL("../../ui/components.css", import.meta.url), "utf8");

    expect(styles).toContain("container-type: inline-size");
    expect(styles).toMatch(/@container \(max-width: 60rem\)[\s\S]*?\.route-directory__row/);
    expect(styles).not.toContain("grid-template-columns: minmax(12rem, 1.4fr)");
  });
});
