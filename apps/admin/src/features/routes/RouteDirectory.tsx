import type { FormEvent } from "react";
import type { ServiceRoute } from "../../api";
import { Button, EmptyState, Skeleton, StatusBadge } from "../../ui";
import type { RouteViewState } from "./RouteManagement";

type Locale = "ar" | "en";

export type RouteDirectoryFilters = {
  search: string;
  status: string;
  direction: string;
  serviceRegionKey: string;
};

export type RouteDirectoryProps = {
  locale: Locale;
  routes: ServiceRoute[];
  view: RouteViewState;
  page: number;
  total: number;
  filters: RouteDirectoryFilters;
  busy?: boolean;
  onSearch: (filters: RouteDirectoryFilters) => void;
  onPage: (page: number) => void;
  onOpenRoute: (routeId: string) => void;
  onCreateRoute: () => void;
};

const copy = {
  ar: {
    title: "إدارة المسارات",
    description: "استعرض هويات المسارات المعتمدة وافتح مساراً لإدارة إصداراته ومحطاته.",
    createRoute: "إنشاء مسار",
    search: "بحث بالاسم أو المفتاح",
    statusFilter: "تصفية حالة المسار",
    directionFilter: "تصفية الاتجاه",
    regionFilter: "تصفية منطقة الخدمة",
    routeStatus: "حالة المسار",
    currentVersionStatus: "حالة الإصدار الحالي",
    region: "منطقة الخدمة",
    direction: "الاتجاه",
    stops: "محطات",
    open: "فتح",
    previous: "السابق",
    next: "التالي",
    page: "صفحة",
    status: "الحالة",
    loading: "جارٍ تحميل كتالوج المسارات…",
    empty: "لا توجد مسارات مطابقة.",
    active: "نشط",
    retired: "متقاعد",
    outbound: "ذهاب",
    inbound: "عودة",
    loop: "حلقي",
    draft: "مسودة",
    published: "منشور",
    paused: "متوقف مؤقتاً",
    noCurrentVersion: "لا يوجد إصدار حالي"
  },
  en: {
    title: "Route management",
    description: "Browse approved route identities and open one to manage its versions and stops.",
    createRoute: "Create route",
    search: "Search by name or key",
    statusFilter: "Route status filter",
    directionFilter: "Direction filter",
    regionFilter: "Service region filter",
    routeStatus: "Route status",
    currentVersionStatus: "Current version status",
    region: "Service region",
    direction: "Direction",
    stops: "stops",
    open: "Open",
    previous: "Previous",
    next: "Next",
    page: "Page",
    status: "Status",
    loading: "Loading the route catalog…",
    empty: "No routes match these filters.",
    active: "Active",
    retired: "Retired",
    outbound: "Outbound",
    inbound: "Inbound",
    loop: "Loop",
    draft: "Draft",
    published: "Published",
    paused: "Paused",
    noCurrentVersion: "No current version"
  }
} as const;

function statusLabel(locale: Locale, status: string) {
  const text = copy[locale];
  return text[status as keyof typeof text] ?? text.status;
}

export function RouteDirectory({
  locale,
  routes,
  view,
  page,
  total,
  filters,
  busy = false,
  onSearch,
  onPage,
  onOpenRoute,
  onCreateRoute
}: RouteDirectoryProps) {
  const text = copy[locale];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSearch({
      search: String(data.get("search") ?? ""),
      status: String(data.get("status") ?? ""),
      direction: String(data.get("direction") ?? ""),
      serviceRegionKey: String(data.get("service_region_key") ?? "")
    });
  }

  return (
    <section className="route-directory" aria-labelledby="route-management-title">
      <header className="route-directory__header">
        <div>
          <h2 id="route-management-title" className="page-header__title">{text.title}</h2>
          <p className="muted">{text.description}</p>
        </div>
        <Button variant="primary" icon="add" onClick={onCreateRoute} disabled={busy}>{text.createRoute}</Button>
      </header>

      <form className="route-directory__filters" onSubmit={submit}>
        <label className="field">{text.search}<input name="search" defaultValue={filters.search} /></label>
        <label className="field">{text.statusFilter}<select name="status" defaultValue={filters.status}><option value="">—</option><option value="active">{text.active}</option><option value="retired">{text.retired}</option></select></label>
        <label className="field">{text.directionFilter}<select name="direction" defaultValue={filters.direction}><option value="">—</option><option value="outbound">{text.outbound}</option><option value="inbound">{text.inbound}</option><option value="loop">{text.loop}</option></select></label>
        <label className="field">{text.regionFilter}<input name="service_region_key" className="technical-value" dir="ltr" defaultValue={filters.serviceRegionKey} /></label>
        <Button type="submit" variant="outline" icon="search" disabled={busy}>{text.search}</Button>
      </form>

      <div className="route-directory__results" aria-live="polite">
        {view === "loading" && <><p className="muted">{text.loading}</p><Skeleton /></>}
        {view === "empty" && <EmptyState compact icon="edit_road" title={text.empty} />}
        {view === "error" && <EmptyState compact icon="warning" title={locale === "ar" ? "تعذّر تحميل كتالوج المسارات." : "The route catalog could not be loaded."} />}
        {view === "ready" && <ul className="route-directory__list">{routes.map((route) => {
          const version = route.current_version;
          const name = locale === "ar" ? version?.name_ar : version?.name_en;
          return <li className="route-directory__row" key={route.id}>
            <div className="route-directory__identity">
              <strong>{name || route.route_key}</strong>
              <span className="technical-value" dir="ltr">{route.route_key}</span>
            </div>
            <span className="route-directory__metadata"><b>{text.region}</b><span className="technical-value" dir="ltr">{route.service_region_key}</span></span>
            <span className="route-directory__metadata"><b>{text.direction}</b>{statusLabel(locale, route.direction)}</span>
            <span className="route-directory__metadata"><b>{text.routeStatus}</b><StatusBadge status={route.status}>{statusLabel(locale, route.status)}</StatusBadge></span>
            <span className="route-directory__metadata"><b>{text.currentVersionStatus}</b><StatusBadge status={version?.status ?? "neutral"}>{version ? statusLabel(locale, version.status) : text.noCurrentVersion}</StatusBadge></span>
            <span className="route-directory__metadata"><b>{locale === "ar" ? "المحطات" : "Stops"}</b>{version?.stop_count ?? 0} {text.stops}</span>
            <Button variant="outline" size="sm" onClick={() => onOpenRoute(route.id)} disabled={busy}>{text.open}</Button>
          </li>;
        })}</ul>}
      </div>

      <nav className="route-directory__pagination" aria-label={text.page}>
        <span>{text.page} {page} · {total}</span>
        <div className="button-row">
          <Button variant="outline" size="sm" disabled={page <= 1 || busy} onClick={() => onPage(page - 1)}>{text.previous}</Button>
          <Button variant="outline" size="sm" disabled={page * 25 >= total || busy} onClick={() => onPage(page + 1)}>{text.next}</Button>
        </div>
      </nav>
    </section>
  );
}
