import { routeStatusLabel as statusText } from "./routeStatusLabel";
import type { ServiceRoute, ServiceRouteVersion } from "../../api";
import { translations } from "../../i18n/translations";
import { Card, StatusBadge } from "../../ui";
import type { PublicationReadinessIssue, RouteLifecycleAction } from "./RouteManagement";
import { PublishReadiness } from "./PublishReadiness";
import { RouteActionMenu, type RouteActionMenuProps } from "./RouteActionMenu";

type Locale = "ar" | "en";

export type RouteOverviewProps = Pick<
  RouteActionMenuProps,
  | "busy"
  | "onClone"
  | "onPublish"
  | "onPause"
  | "onResume"
  | "onRetireVersion"
  | "onRetireRoute"
> & {
  locale: Locale;
  route: ServiceRoute;
  version: ServiceRouteVersion | null;
  readinessIssues: PublicationReadinessIssue[];
  actions: RouteLifecycleAction[];
  lifecycleDialogOpen: boolean;
  lifecycleFeedback: string | null;
  onOpenLifecycleDialog: () => void;
  onCloseLifecycleDialog: () => void;
};

const copy = {
  ar: {
    identity: "هوية المسار",
    current: "ملخص الإصدار الحالي",
    readiness: "جاهزية النشر",
    lifecycle: "دورة الحياة",
    map: "حالة الخريطة",
    routeId: "معرّف المسار",
    routeKey: "مفتاح المسار",
    group: "مجموعة الاتجاهات",
    region: "منطقة الخدمة",
    direction: "الاتجاه",
    versionId: "معرّف الإصدار",
    version: "الإصدار",
    stops: "المحطات",
    noVersion: "لا يوجد إصدار حالي",
    outbound: "ذهاب",
    inbound: "عودة",
    loop: "حلقي"
  },
  en: {
    identity: "Route identity",
    current: "Current version summary",
    readiness: "Publish readiness",
    lifecycle: "Lifecycle",
    map: "Map status",
    routeId: "Route ID",
    routeKey: "Route key",
    group: "Direction group",
    region: "Service region",
    direction: "Direction",
    versionId: "Version ID",
    version: "Version",
    stops: "Stops",
    noVersion: "No current version",
    outbound: "Outbound",
    inbound: "Inbound",
    loop: "Loop"
  }
} as const;


export function RouteOverview({
  locale,
  route,
  version,
  readinessIssues,
  actions,
  lifecycleDialogOpen,
  lifecycleFeedback,
  busy,
  onOpenLifecycleDialog,
  onCloseLifecycleDialog,
  onClone,
  onPublish,
  onPause,
  onResume,
  onRetireVersion,
  onRetireRoute
}: RouteOverviewProps) {
  const text = copy[locale];
  const shared = translations[locale];
  const current = route.current_version;

  return (
    <div className="route-overview">
      <Card className="route-overview__section">
        <h3>{text.identity}</h3>
        <dl className="route-overview__facts">
          <div><dt>{text.routeId}</dt><dd className="technical-value" dir="ltr">{route.id}</dd></div>
          <div><dt>{text.routeKey}</dt><dd className="technical-value" dir="ltr">{route.route_key}</dd></div>
          <div><dt>{text.group}</dt><dd className="technical-value" dir="ltr">{route.route_group_key}</dd></div>
          <div><dt>{text.region}</dt><dd className="technical-value" dir="ltr">{route.service_region_key}</dd></div>
          <div><dt>{text.direction}</dt><dd>{text[route.direction]}</dd></div>
          <div><dt>{shared.routeStatusHeading}</dt><dd><StatusBadge status={route.status}>{statusText(locale, route.status)}</StatusBadge></dd></div>
        </dl>
      </Card>

      <Card className="route-overview__section">
        <h3>{text.current}</h3>
        {current ? (
          <dl className="route-overview__facts">
            <div><dt>{text.versionId}</dt><dd className="technical-value" dir="ltr">{current.id}</dd></div>
            <div><dt>{text.version}</dt><dd>{`v${current.version_number}`}</dd></div>
            <div><dt>{shared.currentVersionStatusHeading}</dt><dd><StatusBadge status={current.status}>{statusText(locale, current.status)}</StatusBadge></dd></div>
            <div><dt>{text.stops}</dt><dd>{current.stop_count}</dd></div>
          </dl>
        ) : <p className="muted">{text.noVersion}</p>}
      </Card>

      <Card className="route-overview__section">
        <h3>{text.readiness}</h3>
        <PublishReadiness issues={readinessIssues} locale={locale} />
      </Card>

      <Card className="route-overview__section">
        <div className="split">
          <h3>{text.lifecycle}</h3>
          <RouteActionMenu
            locale={locale}
            routeStatus={route.status}
            version={version}
            actions={actions}
            readinessIssues={readinessIssues}
            dialogOpen={lifecycleDialogOpen}
            busy={busy}
            feedback={lifecycleFeedback}
            onOpenDialog={onOpenLifecycleDialog}
            onCloseDialog={onCloseLifecycleDialog}
            onClone={onClone}
            onPublish={onPublish}
            onPause={onPause}
            onResume={onResume}
            onRetireVersion={onRetireVersion}
            onRetireRoute={onRetireRoute}
          />
        </div>
        {lifecycleFeedback && <p className="notice notice--error" role="alert">{lifecycleFeedback}</p>}
      </Card>

      <div className="route-overview__map muted">
        <strong>{text.map}</strong>
        <span>{shared.routeMapUnavailable}</span>
        <span>{shared.routeMapUnavailableDescription}</span>
      </div>
    </div>
  );
}
