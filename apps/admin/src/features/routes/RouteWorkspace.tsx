import { routeStatusLabel as statusText } from "./routeStatusLabel";
import type { KeyboardEvent, ReactNode } from "react";
import type { ServiceRoute, ServiceRouteVersion } from "../../api";
import { translations } from "../../i18n/translations";
import { Button, StatusBadge } from "../../ui";
import type { RouteWorkspaceTab } from "./routeManagementModel";

type Locale = "ar" | "en";

export type RouteWorkspaceProps = {
  locale: Locale;
  route: ServiceRoute;
  selectedVersion: ServiceRouteVersion | null;
  tab: RouteWorkspaceTab;
  onBack: () => void;
  onSelectTab: (tab: RouteWorkspaceTab) => void;
  overview: ReactNode;
  versions: ReactNode;
  stops: ReactNode;
  /** Optional: the fares tab only appears when a panel is supplied. */
  fares?: ReactNode;
};

const copy = {
  ar: {
    back: "العودة إلى المسارات",
    workspace: "مساحة عمل المسار",
    mapStatus: "حالة الخريطة",
    selectedVersion: "لا يوجد إصدار محدد"
  },
  en: {
    back: "Back to routes",
    workspace: "Route workspace",
    mapStatus: "Map status",
    selectedVersion: "No selected version"
  }
} as const;


export function RouteWorkspace({
  locale,
  route,
  selectedVersion,
  tab,
  onBack,
  onSelectTab,
  overview,
  versions,
  stops,
  fares
}: RouteWorkspaceProps) {
  const shared = translations[locale];
  const text = copy[locale];
  const routeName = route.current_version
    ? (locale === "ar" ? route.current_version.name_ar : route.current_version.name_en)
    : "";
  const tabs: Array<{ id: RouteWorkspaceTab; label: string; panel: ReactNode }> = [
    { id: "overview", label: shared.routeTabOverview, panel: overview },
    { id: "versions", label: shared.routeTabVersions, panel: versions },
    { id: "stops", label: shared.routeTabStops, panel: stops },
    ...(fares ? [{ id: "fares" as const, label: shared.routeTabFares, panel: fares }] : [])
  ];
  const active = tabs.find((item) => item.id === tab) ?? tabs[0];

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const targetIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : event.key === (locale === "ar" ? "ArrowLeft" : "ArrowRight")
          ? (index + 1) % tabs.length
          : (index - 1 + tabs.length) % tabs.length;
    onSelectTab(tabs[targetIndex].id);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[targetIndex]?.focus();
  }

  return (
    <section className="route-workspace" aria-labelledby="route-workspace-title">
      <header className="route-workspace__header">
        <Button variant="ghost" size="sm" onClick={onBack}>{text.back}</Button>
        <div className="route-workspace__identity">
          <h2 id="route-workspace-title" className="page-header__title">{routeName.trim() || route.route_key}</h2>
          <span className="technical-value" dir="ltr">{route.route_key}</span>
          <span className="technical-value" dir="ltr">{selectedVersion?.id ?? route.id}</span>
        </div>
        <div className="route-workspace__statuses" aria-label={shared.routeStatusLabels}>
          <span className="labeled-status">
            <span>{shared.routeStatusHeading}</span>
            <StatusBadge status={route.status}>{statusText(locale, route.status)}</StatusBadge>
          </span>
          <span className="labeled-status">
            <span>{shared.currentVersionStatusHeading}</span>
            <StatusBadge status={route.current_version?.status ?? "neutral"}>
              {route.current_version ? statusText(locale, route.current_version.status) : shared.routeNoCurrentVersion}
            </StatusBadge>
          </span>
          <span className="labeled-status">
            <span>{shared.selectedVersionStatusHeading}</span>
            <StatusBadge status={selectedVersion?.status ?? "neutral"}>
              {selectedVersion ? statusText(locale, selectedVersion.status) : text.selectedVersion}
            </StatusBadge>
          </span>
          <span className="route-workspace__map-status">
            <span>{text.mapStatus}</span>
            <span className="muted">{shared.routeMapUnavailable}</span>
          </span>
        </div>
      </header>

      <div className="route-workspace__tabs" role="tablist" aria-label={text.workspace}>
        {tabs.map((item, index) => (
          <button
            key={item.id}
            id={`route-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`route-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => onSelectTab(item.id)}
            onKeyDown={(event) => moveTab(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div
        id={`route-panel-${active.id}`}
        className="route-workspace__panel"
        role="tabpanel"
        aria-labelledby={`route-tab-${active.id}`}
        tabIndex={0}
      >
        {active.panel}
      </div>
    </section>
  );
}
