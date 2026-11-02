import { routeStatusLabel } from "./routeStatusLabel";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type {
  ApiError,
  CanonicalStop,
  CanonicalStopDraft,
  RouteIdentityDraft,
  RouteStopDraft,
  RouteVersionDraft,
  ServiceRoute,
  ServiceRouteVersion,
  createApiClient
} from "../../api";
import { translations } from "../../i18n/translations";
import { Button, Card, Notice, Skeleton } from "../../ui";
import { CreateRouteDialog } from "./CreateRouteDialog";
import { RouteDirectory, type RouteDirectoryFilters } from "./RouteDirectory";
import { RouteOverview } from "./RouteOverview";
import { RouteStops, type StopDialogMode } from "./RouteStops";
import { RouteVersions } from "./RouteVersions";
import { RouteFares } from "./RouteFares";
import { RouteWorkspace } from "./RouteWorkspace";
import {
  initialRouteUiState,
  moveRouteStop,
  normalizeRouteVersionDraft,
  routeUiReducer,
  selectAuthoritativeRouteVersion,
  toggleRouteStopPermission
} from "./routeManagementModel";
import type { RouteFeedbackScope } from "./routeManagementModel";

export { moveRouteStop, toggleRouteStopPermission } from "./routeManagementModel";

type Api = ReturnType<typeof createApiClient>;
type Locale = "ar" | "en";

export type RouteViewState = "loading" | "ready" | "empty" | "error";
export type RouteLifecycleAction = "clone" | "publish" | "pause" | "resume" | "retire";
export type PublicationReadinessIssue =
  | "readinessMissingNames"
  | "readinessMinimumStops"
  | "readinessStopEligibility"
  | "readinessDateOrder"
  | "readinessPassengerPath"
  | "readinessParcelPath";
export const ADMIN_ROUTE_RESPONSIVE_BREAKPOINT = 880;

type ReadinessVersion = ServiceRouteVersion & { service_region_key?: string };

export function routeCatalogQuery(input: {
  page: number;
  search: string;
  status: string;
  direction: string;
  serviceRegionKey: string;
}) {
  const query = new URLSearchParams({ page: String(input.page), limit: "25" });
  if (input.search.trim()) query.set("search", input.search.trim());
  if (input.status) query.set("status", input.status);
  if (input.direction) query.set("direction", input.direction);
  if (input.serviceRegionKey.trim()) query.set("service_region_key", input.serviceRegionKey.trim());
  return query;
}

export function publicationReadiness(version: ReadinessVersion, stops: CanonicalStop[]) {
  const issues: PublicationReadinessIssue[] = [];
  if (!version.name_ar.trim() || !version.name_en.trim()) issues.push("readinessMissingNames");
  if (version.stops.length < 2) issues.push("readinessMinimumStops");

  const stopById = new Map(stops.map((stop) => [stop.id, stop]));
  const routeRegion = version.service_region_key ?? version.stops[0]?.stop.service_region_key;
  const hasIneligibleStop = version.stops.some((membership) => {
    const stop = stopById.get(membership.stop_id) ?? membership.stop;
    return stop.status !== "active" || Boolean(routeRegion && stop.service_region_key !== routeRegion);
  });
  if (hasIneligibleStop) issues.push("readinessStopEligibility");

  if (version.active_from && version.active_until) {
    const startsAt = Date.parse(version.active_from);
    const endsAt = Date.parse(version.active_until);
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) {
      issues.push("readinessDateOrder");
    }
  }

  const hasDownstreamPath = (
    pickup: "passenger_pickup_allowed" | "parcel_pickup_allowed",
    dropoff: "passenger_dropoff_allowed" | "parcel_dropoff_allowed"
  ) => version.stops.some((candidate, pickupIndex) =>
    candidate[pickup] && version.stops.some((later, dropoffIndex) => dropoffIndex > pickupIndex && later[dropoff])
  );

  if (!hasDownstreamPath("passenger_pickup_allowed", "passenger_dropoff_allowed")) {
    issues.push("readinessPassengerPath");
  }
  const hasParcelPermission = version.stops.some((membership) =>
    membership.parcel_pickup_allowed || membership.parcel_dropoff_allowed
  );
  if (hasParcelPermission && !hasDownstreamPath("parcel_pickup_allowed", "parcel_dropoff_allowed")) {
    issues.push("readinessParcelPath");
  }
  return issues;
}

export function reconcileRouteVersionSnapshot(route: ServiceRoute, savedVersion: ServiceRouteVersion) {
  const versions = route.versions ?? [];
  const containsVersion = versions.some((version) => version.id === savedVersion.id);
  const reconciledVersions = containsVersion
    ? versions.map((version) => version.id === savedVersion.id ? savedVersion : version)
    : [savedVersion, ...versions];
  return {
    ...route,
    versions: reconciledVersions,
    current_version: route.current_version?.id === savedVersion.id ? savedVersion : route.current_version
  };
}

export function routeUsedStopIds(route: ServiceRoute | null) {
  return new Set(
    route?.versions?.flatMap((version) => version.stops.map((membership) => membership.stop_id)) ?? []
  );
}

export function RouteMembershipStopLabel({
  membership,
  version,
  stops,
  locale
}: {
  membership: RouteStopDraft;
  version: ServiceRouteVersion | null;
  stops: CanonicalStop[];
  locale: Locale;
}) {
  const embeddedStop = version?.stops.find((item) => item.stop_id === membership.stop_id)?.stop;
  const stop = embeddedStop ?? stops.find((item) => item.id === membership.stop_id);
  return stop
    ? <strong>{locale === "ar" ? stop.name_ar : stop.name_en}</strong>
    : <strong className="technical-value" dir="ltr">{membership.stop_id}</strong>;
}

export function routeCatalogView(input: { loading: boolean; error: boolean; count: number }): RouteViewState {
  if (input.loading) return "loading";
  if (input.error) return "error";
  return input.count === 0 ? "empty" : "ready";
}

export function reorderControlLabel(label: string, index: number) {
  return `${label} ${index + 1}`;
}

export function lifecycleActions(version: ServiceRouteVersion | null) {
  if (!version) return [] as RouteLifecycleAction[];
  if (version.status === "published") return ["clone", "pause", "retire"] as RouteLifecycleAction[];
  if (version.status === "paused") return ["clone", "resume", "retire"] as RouteLifecycleAction[];
  if (version.status === "draft") return ["publish", "retire"] as RouteLifecycleAction[];
  return [] as RouteLifecycleAction[];
}

const copy = {
  ar: {
    title: "إدارة المسارات",
    subtitle: "كتالوج المسارات المعتمد وإصداراته الثابتة — من دون خرائط في هذه المرحلة.",
    routes: "المسارات",
    stops: "المحطات",
    createRoute: "إنشاء مسار",
    routeKey: "مفتاح المسار",
    groupKey: "مجموعة الاتجاهات",
    region: "منطقة الخدمة",
    direction: "الاتجاه",
    outbound: "ذهاب",
    inbound: "عودة",
    loop: "حلقي",
    create: "إنشاء",
    search: "بحث بالاسم أو المفتاح",
    loading: "جارٍ تحميل كتالوج المسارات…",
    empty: "لا توجد مسارات بعد. أنشئ أول هوية مسار معتمدة.",
    error: "تعذّر تحميل كتالوج المسارات.",
    retry: "إعادة المحاولة",
    versions: "الإصدارات",
    newVersion: "إصدار مسودة جديد",
    nameAr: "الاسم بالعربية",
    nameEn: "الاسم بالإنجليزية",
    descriptionAr: "الوصف بالعربية",
    descriptionEn: "الوصف بالإنجليزية",
    activeFrom: "فعال من",
    activeUntil: "فعال حتى",
    saveDraft: "حفظ المسودة",
    createDraft: "إنشاء المسودة",
    orderedStops: "ترتيب المحطات والصلاحيات",
    addStop: "إضافة محطة موجودة",
    saveOrder: "حفظ الترتيب",
    moveUp: "تحريك لأعلى",
    moveDown: "تحريك لأسفل",
    remove: "إزالة",
    passengerPickup: "صعود ركاب",
    passengerDropoff: "نزول ركاب",
    parcelPickup: "استلام طرد",
    parcelDropoff: "تسليم طرد",
    publish: "نشر",
    clone: "نسخ لمسودة جديدة",
    pause: "إيقاف مؤقت",
    resume: "استئناف",
    retire: "إحالة للتقاعد",
    retireRoute: "إحالة المسار للتقاعد",
    geometryReady: "الهندسة جاهزة",
    geometryPending: "الهندسة معلّقة",
    revisionConflict: "عُدّلت المسودة من جلسة أخرى. أعد تحميلها قبل الحفظ.",
    conflictReloaded: "تغيّرت حالة المسار من جلسة أخرى. أُعيد تحميل أحدث البيانات المعتمدة؛ راجعها قبل المحاولة مرة أخرى.",
    reloadFailed: "تعذّر إعادة تحميل أحدث بيانات المسار. أعد المحاولة أو استخدم معرّف الطلب للدعم.",
    saved: "تم الحفظ بنجاح.",
    confirm: "هل تريد تنفيذ هذا الإجراء؟ سيُسجل في سجل التدقيق.",
    stopKey: "مفتاح المحطة",
    latitude: "خط العرض",
    longitude: "خط الطول",
    createStop: "إنشاء محطة",
    stopHelp: "أدخل الإحداثيات الرقمية المعتمدة. لا يوجد بحث أو معاينة خريطة في M7B.",
    status: "الحالة",
    current: "الحالي",
    chooseRoute: "اختر مساراً لعرض إصداراته.",
    reason: "سبب الإجراء",
    reasonRequired: "أدخل سبباً قبل الإيقاف أو الإحالة للتقاعد.",
    active: "نشط",
    retired: "متقاعد",
    draft: "مسودة",
    published: "منشور",
    paused: "متوقف مؤقتاً",
    noStops: "أضف محطتين على الأقل قبل النشر.",
    stopRetired: "تمت إحالة المحطة للتقاعد.",
    pagination: "صفحة",
    genericError: "تعذّر إكمال الإجراء. أعد المحاولة أو استخدم معرّف الطلب للدعم."
  },
  en: {
    title: "Route management",
    subtitle: "The approved route catalog and immutable versions — maps are intentionally absent in this milestone.",
    routes: "Routes",
    stops: "Stops",
    createRoute: "Create route",
    routeKey: "Route key",
    groupKey: "Direction group",
    region: "Service region",
    direction: "Direction",
    outbound: "Outbound",
    inbound: "Inbound",
    loop: "Loop",
    create: "Create",
    search: "Search by name or key",
    loading: "Loading the route catalog…",
    empty: "No routes yet. Create the first canonical route identity.",
    error: "The route catalog could not be loaded.",
    retry: "Retry",
    versions: "Versions",
    newVersion: "New draft version",
    nameAr: "Arabic name",
    nameEn: "English name",
    descriptionAr: "Arabic description",
    descriptionEn: "English description",
    activeFrom: "Active from",
    activeUntil: "Active until",
    saveDraft: "Save draft",
    createDraft: "Create draft",
    orderedStops: "Stop order and permissions",
    addStop: "Add existing stop",
    saveOrder: "Save order",
    moveUp: "Move up",
    moveDown: "Move down",
    remove: "Remove",
    passengerPickup: "Passenger pickup",
    passengerDropoff: "Passenger drop-off",
    parcelPickup: "Parcel pickup",
    parcelDropoff: "Parcel drop-off",
    publish: "Publish",
    clone: "Clone to new draft",
    pause: "Pause",
    resume: "Resume",
    retire: "Retire",
    retireRoute: "Retire route",
    geometryReady: "Geometry ready",
    geometryPending: "Geometry pending",
    revisionConflict: "Another session changed this draft. Reload it before saving.",
    conflictReloaded: "Another session changed the route state. The latest authoritative data was reloaded; review it before trying again.",
    reloadFailed: "The latest route data could not be reloaded. Retry or use the request ID for support.",
    saved: "Saved successfully.",
    confirm: "Continue with this action? It will be recorded in the audit log.",
    stopKey: "Stop key",
    latitude: "Latitude",
    longitude: "Longitude",
    createStop: "Create stop",
    stopHelp: "Enter approved numeric coordinates. M7B has no map lookup or preview.",
    status: "Status",
    current: "Current",
    chooseRoute: "Choose a route to inspect its versions.",
    reason: "Action reason",
    reasonRequired: "Enter a reason before pausing or retiring.",
    active: "Active",
    retired: "Retired",
    draft: "Draft",
    published: "Published",
    paused: "Paused",
    noStops: "Add at least two stops before publication.",
    stopRetired: "Stop retired.",
    pagination: "Page",
    genericError: "The action could not be completed. Retry or use the request ID for support."
  }
} as const;

export function routeUiText(locale: Locale) {
  const shared = translations[locale];
  return {
    ...copy[locale],
    routeStatusFilter: shared.routeStatusFilter,
    routeDirectionFilter: shared.routeDirectionFilter,
    routeRegionFilter: shared.routeRegionFilter,
    routeStatusHeading: shared.routeStatusHeading,
    currentVersionStatusHeading: shared.currentVersionStatusHeading,
    selectedVersionStatusHeading: shared.selectedVersionStatusHeading,
    stopStatusHeading: shared.stopStatusHeading,
    routeStatusLabels: shared.routeStatusLabels,
    routeHistoryBounded: shared.routeHistoryBounded,
    routeHistorySummary: shared.routeHistorySummary,
    routeHistoryTruncated: shared.routeHistoryTruncated,
    routeMapUnavailable: shared.routeMapUnavailable,
    routeMapUnavailableDescription: shared.routeMapUnavailableDescription,
    routeReadinessTitle: shared.routeReadinessTitle,
    routeReadinessReady: shared.routeReadinessReady,
    readinessMissingNames: shared.readinessMissingNames,
    readinessMinimumStops: shared.readinessMinimumStops,
    readinessStopEligibility: shared.readinessStopEligibility,
    readinessDateOrder: shared.readinessDateOrder,
    readinessPassengerPath: shared.readinessPassengerPath,
    readinessParcelPath: shared.readinessParcelPath,
    routeUsedStopImmutable: shared.routeUsedStopImmutable,
    routeNoCurrentVersion: shared.routeNoCurrentVersion,
    routeConflictCreateRoute: shared.routeConflictCreateRoute,
    routeConflictVersionEditor: shared.routeConflictVersionEditor,
    routeConflictStops: shared.routeConflictStops,
    routeConflictStopEditor: shared.routeConflictStopEditor,
    routeConflictLifecycle: shared.routeConflictLifecycle,
    routeBetaLimitReached: shared.routeBetaLimitReached,
    routeValidationError: shared.routeValidationError,
    routeCurrentVersionConflict: shared.routeCurrentVersionConflict,
    routeVersionInUse: shared.routeVersionInUse,
    routeRouteInUse: shared.routeRouteInUse,
    routeStopIdMissing: shared.routeStopIdMissing,
    requestId: shared.requestId
  };
}

function key(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

export function mutationFingerprint(operation: string, payload: unknown) {
  return `${operation}:${JSON.stringify(payload)}`;
}

export function stableMutationKey(
  registry: Map<string, string>,
  operation: string,
  payload: unknown,
  factory: (prefix: string) => string = key
) {
  const fingerprint = mutationFingerprint(operation, payload);
  const existing = registry.get(fingerprint);
  if (existing) return { fingerprint, key: existing };
  const created = factory(operation);
  registry.set(fingerprint, created);
  return { fingerprint, key: created };
}

export function mutationFailureIsAuthoritative(error: unknown) {
  const apiError = error as ApiError | undefined;
  return Boolean(
    apiError &&
    typeof apiError.status === "number" &&
    apiError.status >= 400 &&
    apiError.status < 500 &&
    apiError.message !== "idempotency_in_progress"
  );
}

function routeErrorPayload(error: unknown) {
  const details = (error as ApiError | undefined)?.details;
  return details && typeof details === "object" ? details as {
    error?: unknown;
    request_id?: unknown;
    details?: unknown;
  } : undefined;
}

function routeErrorCode(error: unknown) {
  const payload = routeErrorPayload(error);
  return typeof payload?.error === "string"
    ? payload.error
    : error instanceof Error ? error.message : "unexpected_error";
}

function routeRequestId(error: unknown) {
  const value = routeErrorPayload(error)?.request_id;
  return typeof value === "string" && value ? value : null;
}

function withRequestId(locale: Locale, message: string, error: unknown) {
  const requestId = routeRequestId(error);
  return requestId ? `${message} (${routeUiText(locale).requestId}: ${requestId})` : message;
}

function routeValidationMessage(locale: Locale, error: unknown) {
  const payload = routeErrorPayload(error);
  const details = Array.isArray(payload?.details) ? payload.details : [];
  const text = routeUiText(locale);
  const labels: Record<string, string> = {
    route_key: text.routeKey,
    route_group_key: text.groupKey,
    service_region_key: text.region,
    direction: text.direction,
    name_ar: text.nameAr,
    name_en: text.nameEn,
    description_ar: text.descriptionAr,
    description_en: text.descriptionEn,
    active_from: text.activeFrom,
    active_until: text.activeUntil,
    stop_key: text.stopKey,
    latitude: text.latitude,
    longitude: text.longitude
  };
  const fields = [...new Set(details.flatMap((detail) => {
    if (!detail || typeof detail !== "object" || !("path" in detail) || !Array.isArray(detail.path)) return [];
    const field = detail.path.map((value: unknown) => String(value)).find((value: string) => labels[value]);
    return field ? [labels[field]] : [];
  }))];
  return fields.length > 0 ? `${text.routeValidationError} ${fields.join(", ")}` : text.routeValidationError;
}

export function routeUiError(locale: Locale, error: unknown) {
  const code = routeErrorCode(error);
  const text = routeUiText(locale);
  const message = code === "draft_revision_conflict"
    ? text.revisionConflict
    : code === "current_version_conflict"
      ? text.routeCurrentVersionConflict
      : code === "beta_route_limit_reached"
        ? text.routeBetaLimitReached
        : code === "validation_error"
          ? routeValidationMessage(locale, error)
          : code === "used_stop_immutable"
            ? text.routeUsedStopImmutable
            : code === "route_version_has_active_usage"
              ? text.routeVersionInUse
              : code === "service_route_has_active_usage"
                ? text.routeRouteInUse
                : code === "route_stop_id_missing"
                  ? text.routeStopIdMissing
                  : text.genericError;
  return withRequestId(locale, message, error);
}

export function routeStatusText(locale: Locale, value: string) {
  return routeStatusLabel(locale, value);
}

export function routeConflictRequiresReload(error: unknown) {
  const code = routeErrorCode(error);
  if ((error as ApiError | undefined)?.status !== 409) return false;
  return !new Set([
    "beta_route_limit_reached",
    "used_stop_immutable",
    "route_version_has_active_usage",
    "service_route_has_active_usage",
    "route_contains_inactive_stop"
  ]).has(code);
}

export async function handleRouteMutationFailure(
  error: unknown,
  reload: () => Promise<boolean>,
  locale: Locale,
  scope?: Exclude<RouteFeedbackScope, "page">
) {
  if (!routeConflictRequiresReload(error)) return routeUiError(locale, error);
  const text = routeUiText(locale);
  try {
    if (!await reload()) return withRequestId(locale, text.reloadFailed, error);
    const scopedConflict = scope === "create-route"
      ? text.routeConflictCreateRoute
      : scope === "version-editor"
        ? text.routeConflictVersionEditor
        : scope === "stops"
          ? text.routeConflictStops
          : scope === "stop-editor"
            ? text.routeConflictStopEditor
            : scope === "lifecycle"
              ? text.routeConflictLifecycle
              : text.conflictReloaded;
    if (routeErrorCode(error) === "current_version_conflict") {
      return withRequestId(locale, scopedConflict, error);
    }
    const safeError = routeUiError(locale, error);
    return safeError === routeUiText(locale).genericError
      ? scopedConflict
      : `${safeError} ${scopedConflict}`;
  } catch {
    return withRequestId(locale, text.reloadFailed, error);
  }
}

export function membershipsFromVersion(version: ServiceRouteVersion): RouteStopDraft[] {
  return version.stops.map((membership, index) => ({
    stop_id: membership.stop_id ?? membership.stop?.id ?? (() => { throw new Error("route_stop_id_missing"); })(),
    sequence: index + 1,
    passenger_pickup_allowed: membership.passenger_pickup_allowed,
    passenger_dropoff_allowed: membership.passenger_dropoff_allowed,
    parcel_pickup_allowed: membership.parcel_pickup_allowed,
    parcel_dropoff_allowed: membership.parcel_dropoff_allowed,
    estimated_offset_seconds: membership.estimated_offset_seconds,
    dwell_seconds: membership.dwell_seconds
  }));
}

export function RouteManagement({ api, token, locale }: { api: Api; token: string; locale: Locale }) {
  const text = routeUiText(locale);
  const [view, setView] = useState<RouteViewState>("loading");
  const [routes, setRoutes] = useState<ServiceRoute[]>([]);
  const [stops, setStops] = useState<CanonicalStop[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<ServiceRoute | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<ServiceRouteVersion | null>(null);
  const [ui, dispatch] = useReducer(routeUiReducer, initialRouteUiState);
  const [memberships, setMemberships] = useState<RouteStopDraft[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [directionFilter, setDirectionFilter] = useState("");
  const [serviceRegionFilter, setServiceRegionFilter] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const busyRef = useRef("");
  const mutationKeys = useRef(new Map<string, string>());

  const usedStopIds = useMemo(() => routeUsedStopIds(selectedRoute), [selectedRoute]);
  const actions = lifecycleActions(selectedVersion);
  const readinessIssues = selectedRoute && selectedVersion
    ? publicationReadiness({ ...selectedVersion, service_region_key: selectedRoute.service_region_key }, stops)
    : [];

  function showError(error: unknown) {
    setMessage({ kind: "error", text: routeUiError(locale, error) });
  }

  function beginBusy(label: string) {
    if (busyRef.current) return false;
    busyRef.current = label;
    setBusy(label);
    setMessage(null);
    return true;
  }

  function endBusy() {
    busyRef.current = "";
    setBusy("");
  }

  function pendingMutation(operation: string, payload: unknown) {
    return stableMutationKey(mutationKeys.current, operation, payload);
  }

  function settleMutation(fingerprint: string, error?: unknown) {
    if (error === undefined || mutationFailureIsAuthoritative(error)) mutationKeys.current.delete(fingerprint);
  }

  async function loadCatalog(nextPage = page, requestedFilters?: RouteDirectoryFilters, surfaceFailure = true) {
    if (surfaceFailure) {
      setView("loading");
      setMessage(null);
    }
    const catalogFilters = requestedFilters ?? {
      search,
      status: statusFilter,
      direction: directionFilter,
      serviceRegionKey: serviceRegionFilter
    };
    if (requestedFilters) {
      setSearch(requestedFilters.search);
      setStatusFilter(requestedFilters.status);
      setDirectionFilter(requestedFilters.direction);
      setServiceRegionFilter(requestedFilters.serviceRegionKey);
    }
    try {
      const query = routeCatalogQuery({
        page: nextPage,
        search: catalogFilters.search,
        status: catalogFilters.status,
        direction: catalogFilters.direction,
        serviceRegionKey: catalogFilters.serviceRegionKey
      });
      const [routePage, stopPage] = await Promise.all([
        api.serviceRoutes(token, `?${query}`),
        api.canonicalStops(token, "?limit=50")
      ]);
      setRoutes(routePage.routes);
      setStops(stopPage.stops);
      setTotal(routePage.total);
      setPage(nextPage);
      setView(routePage.routes.length ? "ready" : "empty");
      return true;
    } catch (error) {
      if (surfaceFailure) {
        setView("error");
        showError(error);
      }
      return false;
    }
  }

  async function loadStops(surfaceFailure = true) {
    try {
      const stopPage = await api.canonicalStops(token, "?limit=50");
      setStops(stopPage.stops);
      return true;
    } catch (error) {
      if (surfaceFailure) showError(error);
      return false;
    }
  }

  useEffect(() => {
    void loadCatalog(1);
  }, []);

  async function loadRoute(routeId: string, nested = false, surfaceFailure = true) {
    if (!nested && !beginBusy("route-detail")) return false;
    try {
      const response = await api.serviceRoute(token, routeId);
      setSelectedRoute(response.route);
      const version = selectAuthoritativeRouteVersion(response.route, selectedVersion?.id ?? ui.selectedVersionId);
      selectVersion(version ?? null);
      return true;
    } catch (error) {
      if (surfaceFailure) showError(error);
      return false;
    } finally {
      if (!nested) endBusy();
    }
  }

  function selectVersion(version: ServiceRouteVersion | null) {
    setSelectedVersion(version);
    dispatch({ type: "select-version", versionId: version?.id ?? null });
    setMemberships(version ? membershipsFromVersion(version) : []);
  }

  async function submitRoute(draft: RouteIdentityDraft) {
    if (!beginBusy("create-route")) return;
    const mutation = pendingMutation("route_create", draft);
    try {
      const response = await api.createServiceRoute(token, draft, mutation.key);
      settleMutation(mutation.fingerprint);
      dispatch({ type: "clear-feedback" });
      dispatch({ type: "close-dialog" });
      if (!await loadCatalog(1) || !await loadRoute(response.route.id, true)) return;
      dispatch({ type: "open-route", routeId: response.route.id });
      dispatch({ type: "feedback", scope: "page", kind: "success", text: text.saved });
    } catch (error) {
      settleMutation(mutation.fingerprint, error);
      dispatch({ type: "feedback", scope: "create-route", kind: "error", text: await handleRouteMutationFailure(error, () => loadCatalog(1, undefined, false), locale, "create-route") });
    } finally {
      endBusy();
    }
  }

  async function submitStop(draft: CanonicalStopDraft) {
    if (!beginBusy("create-stop")) return false;
    dispatch({ type: "clear-feedback" });
    const mutation = pendingMutation("stop_create", draft);
    try {
      await api.createCanonicalStop(token, draft, mutation.key);
      settleMutation(mutation.fingerprint);
      if (!await loadStops(false)) {
        dispatch({ type: "feedback", scope: "stop-editor", kind: "error", text: text.reloadFailed });
        return false;
      }
      dispatch({ type: "feedback", scope: "stops", kind: "success", text: text.saved });
      return true;
    } catch (error) {
      settleMutation(mutation.fingerprint, error);
      dispatch({
        type: "feedback",
        scope: "stop-editor",
        kind: "error",
        text: await handleRouteMutationFailure(error, () => loadStops(false), locale, "stop-editor")
      });
      return false;
    } finally {
      endBusy();
    }
  }

  async function saveStop(id: string, draft: CanonicalStopDraft) {
    if (!beginBusy(`edit-stop-${id}`)) return false;
    dispatch({ type: "clear-feedback" });
    const { stop_key: _immutableStopKey, ...update } = draft;
    try {
      await api.updateCanonicalStop(token, id, update);
      if (!await loadStops(false)) {
        dispatch({ type: "feedback", scope: "stop-editor", kind: "error", text: text.reloadFailed });
        return false;
      }
      dispatch({ type: "feedback", scope: "stops", kind: "success", text: text.saved });
      return true;
    } catch (error) {
      dispatch({
        type: "feedback",
        scope: "stop-editor",
        kind: "error",
        text: await handleRouteMutationFailure(error, () => loadStops(false), locale, "stop-editor")
      });
      return false;
    } finally {
      endBusy();
    }
  }

  async function createDraft(draft: RouteVersionDraft) {
    if (!selectedRoute) return;
    if (!beginBusy("create-version")) return;
    const payload = normalizeRouteVersionDraft(draft);
    const mutation = pendingMutation("route_version_create", { routeId: selectedRoute.id, ...payload });
    try {
      const response = await api.createRouteVersion(token, selectedRoute.id, payload, mutation.key);
      settleMutation(mutation.fingerprint);
      if (!await loadRoute(selectedRoute.id, true, false)) {
        dispatch({ type: "feedback", scope: "version-editor", kind: "error", text: text.reloadFailed });
        return;
      }
      selectVersion(response.version);
      dispatch({ type: "feedback", scope: "version-editor", kind: "success", text: text.saved });
    } catch (error) {
      settleMutation(mutation.fingerprint, error);
      dispatch({
        type: "feedback",
        scope: "version-editor",
        kind: "error",
        text: await handleRouteMutationFailure(error, () => loadRoute(selectedRoute.id, true, false), locale, "version-editor")
      });
    } finally {
      endBusy();
    }
  }

  async function saveDraft(draft: RouteVersionDraft) {
    if (!selectedRoute || !selectedVersion || selectedVersion.status !== "draft") return;
    if (!beginBusy("save-version")) return;
    try {
      const payload = normalizeRouteVersionDraft(draft);
      await api.updateRouteVersion(token, selectedVersion.id, { ...payload, expected_revision: selectedVersion.draft_revision });
      if (!await loadRoute(selectedRoute.id, true, false)) {
        dispatch({ type: "feedback", scope: "version-editor", kind: "error", text: text.reloadFailed });
        return;
      }
      dispatch({ type: "feedback", scope: "version-editor", kind: "success", text: text.saved });
    } catch (error) {
      dispatch({
        type: "feedback",
        scope: "version-editor",
        kind: "error",
        text: await handleRouteMutationFailure(error, () => loadRoute(selectedRoute.id, true, false), locale, "version-editor")
      });
    } finally {
      endBusy();
    }
  }

  async function saveStops(nextMemberships: RouteStopDraft[]) {
    if (!selectedVersion || selectedVersion.status !== "draft") return;
    if (!beginBusy("save-stops")) return;
    dispatch({ type: "clear-feedback" });
    try {
      if (nextMemberships.some((membership) => !membership.stop_id?.trim())) {
        throw new Error("route_stop_id_missing");
      }
      const response = await api.replaceRouteStops(token, selectedVersion.id, {
        expected_revision: selectedVersion.draft_revision,
        stops: nextMemberships
      });
      setSelectedRoute((current) => current ? reconcileRouteVersionSnapshot(current, response.version) : current);
      selectVersion(response.version);
      dispatch({ type: "feedback", scope: "stops", kind: "success", text: text.saved });
    } catch (error) {
      dispatch({
        type: "feedback",
        scope: "stops",
        kind: "error",
        text: await handleRouteMutationFailure(error, () => loadRoute(selectedVersion.service_route_id, true, false), locale, "stops")
      });
    } finally {
      endBusy();
    }
  }

  async function cloneVersion() {
    if (!selectedRoute || !selectedVersion) return;
    if (!beginBusy("clone")) return;
    const payload = { routeId: selectedRoute.id, clone_from_version_id: selectedVersion.id };
    const mutation = pendingMutation("route_version_clone", payload);
    try {
      const response = await api.createRouteVersion(
        token,
        selectedRoute.id,
        { clone_from_version_id: selectedVersion.id },
        mutation.key
      );
      settleMutation(mutation.fingerprint);
      if (!await loadRoute(selectedRoute.id, true, false)) {
        dispatch({ type: "feedback", scope: "lifecycle", kind: "error", text: text.reloadFailed });
        return;
      }
      selectVersion(response.version);
      dispatch({ type: "feedback", scope: "page", kind: "success", text: text.saved });
    } catch (error) {
      settleMutation(mutation.fingerprint, error);
      dispatch({
        type: "feedback",
        scope: "lifecycle",
        kind: "error",
        text: await handleRouteMutationFailure(error, () => loadRoute(selectedRoute.id, true, false), locale, "lifecycle")
      });
    } finally {
      endBusy();
    }
  }

  async function versionAction(action: "publish" | "pause" | "resume" | "retire", suppliedReason = "") {
    const reason = suppliedReason.trim();
    if ((action === "pause" || action === "retire") && !reason) {
      dispatch({ type: "feedback", scope: "lifecycle", kind: "error", text: text.reasonRequired });
      return;
    }
    if (!selectedRoute || !selectedVersion) return;
    if (!beginBusy(action)) return;
    const lifecycleExpectation = { expected_current_version_id: selectedRoute.current_version_id };
    const payload = action === "publish"
      ? { id: selectedVersion.id, expected_revision: selectedVersion.draft_revision, ...lifecycleExpectation }
      : { id: selectedVersion.id, action, ...(action === "resume" ? lifecycleExpectation : { reason, ...lifecycleExpectation }) };
    const mutation = pendingMutation(`route_version_${action}`, payload);
    try {
      const response = action === "publish"
        ? await api.publishRouteVersion(
            token,
            selectedVersion.id,
            { expected_revision: selectedVersion.draft_revision, expected_current_version_id: selectedRoute.current_version_id },
            mutation.key
          )
        : await api.routeVersionAction(
            token,
            selectedVersion.id,
            action,
            action === "resume" ? lifecycleExpectation : { reason, ...lifecycleExpectation },
            mutation.key
          );
      settleMutation(mutation.fingerprint);
      if (!await loadRoute(selectedRoute.id, true, false)) {
        dispatch({ type: "feedback", scope: "lifecycle", kind: "error", text: text.reloadFailed });
        return;
      }
      selectVersion(response.version);
      dispatch({ type: "feedback", scope: "page", kind: "success", text: text.saved });
    } catch (error) {
      settleMutation(mutation.fingerprint, error);
      dispatch({
        type: "feedback",
        scope: "lifecycle",
        kind: "error",
        text: await handleRouteMutationFailure(error, () => loadRoute(selectedRoute.id, true, false), locale, "lifecycle")
      });
    } finally {
      endBusy();
    }
  }

  async function retireRoute(suppliedReason = "") {
    const reason = suppliedReason.trim();
    if (!reason) {
      dispatch({ type: "feedback", scope: "lifecycle", kind: "error", text: text.reasonRequired });
      return;
    }
    if (!selectedRoute) return;
    if (!beginBusy("retire-route")) return;
    const retirement = { reason, expected_current_version_id: null as null };
    const payload = { id: selectedRoute.id, ...retirement };
    const mutation = pendingMutation("service_route_retire", payload);
    try {
      await api.retireServiceRoute(token, selectedRoute.id, retirement, mutation.key);
      settleMutation(mutation.fingerprint);
      setSelectedRoute(null);
      selectVersion(null);
      dispatch({ type: "back-to-directory" });
      if (!await loadCatalog(page)) return;
      dispatch({ type: "feedback", scope: "page", kind: "success", text: text.saved });
    } catch (error) {
      settleMutation(mutation.fingerprint, error);
      dispatch({
        type: "feedback",
        scope: "lifecycle",
        kind: "error",
        text: await handleRouteMutationFailure(
          error,
          () => loadRoute(selectedRoute.id, true, false),
          locale,
          "lifecycle"
        )
      });
    } finally {
      endBusy();
    }
  }

  async function retireStop(stop: CanonicalStop, suppliedReason: string) {
    const reason = suppliedReason.trim();
    if (!reason) {
      dispatch({ type: "feedback", scope: "stops", kind: "error", text: text.reasonRequired });
      return false;
    }
    if (!beginBusy(`retire-stop-${stop.id}`)) return false;
    dispatch({ type: "clear-feedback" });
    const payload = { id: stop.id, reason };
    const mutation = pendingMutation("stop_retire", payload);
    try {
      await api.retireCanonicalStop(token, stop.id, reason, mutation.key);
      settleMutation(mutation.fingerprint);
      if (!await loadStops(false)) {
        dispatch({ type: "feedback", scope: "stops", kind: "error", text: text.reloadFailed });
        return false;
      }
      dispatch({ type: "feedback", scope: "stops", kind: "success", text: text.stopRetired });
      return true;
    } catch (error) {
      settleMutation(mutation.fingerprint, error);
      dispatch({
        type: "feedback",
        scope: "stops",
        kind: "error",
        text: await handleRouteMutationFailure(error, () => loadStops(false), locale, "stops")
      });
      return false;
    } finally {
      endBusy();
    }
  }

  if (ui.surface === "directory") {
    return (
      <section className="route-management stack" dir={locale === "ar" ? "rtl" : "ltr"} lang={locale}>
        {ui.feedback?.scope === "page" && <Notice kind={ui.feedback.kind}>{ui.feedback.text}</Notice>}
        {message && <Notice kind={message.kind}>{message.text}</Notice>}
        <RouteDirectory
          locale={locale}
          routes={routes}
          view={view}
          page={page}
          total={total}
          busy={Boolean(busy)}
          filters={{ search, status: statusFilter, direction: directionFilter, serviceRegionKey: serviceRegionFilter }}
          onSearch={(filters) => { void loadCatalog(1, filters); }}
          onPage={(nextPage) => { void loadCatalog(nextPage); }}
          onOpenRoute={(routeId) => {
            dispatch({ type: "open-route", routeId });
            void loadRoute(routeId);
          }}
          onCreateRoute={() => dispatch({ type: "open-dialog", dialog: "create-route" })}
        />
        <CreateRouteDialog
          open={ui.dialog === "create-route"}
          locale={locale}
          busy={busy === "create-route"}
          error={ui.feedback?.scope === "create-route" ? ui.feedback.text : null}
          onSubmit={submitRoute}
          onClose={() => {
            dispatch({ type: "close-dialog" });
            dispatch({ type: "clear-feedback" });
          }}
        />
      </section>
    );
  }

  if (!selectedRoute) {
    return (
      <section className="route-management stack" dir={locale === "ar" ? "rtl" : "ltr"} lang={locale}>
        <Button variant="ghost" size="sm" onClick={() => dispatch({ type: "back-to-directory" })}>
          {locale === "ar" ? "العودة إلى المسارات" : "Back to routes"}
        </Button>
        {message && <Notice kind={message.kind}>{message.text}</Notice>}
        <Card><p className="muted">{text.loading}</p><Skeleton /></Card>
      </section>
    );
  }

  const versionsPanel = <RouteVersions
    locale={locale}
    route={selectedRoute}
    selectedVersion={selectedVersion}
    editing={ui.versionEditMode}
    busy={Boolean(busy)}
    feedback={ui.feedback?.scope === "version-editor" ? ui.feedback : null}
    onSelectVersion={selectVersion}
    onCreateDraft={(draft) => void createDraft(draft)}
    onBeginEdit={() => {
      dispatch({ type: "clear-feedback" });
      dispatch({ type: "begin-version-edit" });
    }}
    onSaveDraft={(draft) => void saveDraft(draft)}
    onCancelEdit={() => {
      dispatch({ type: "cancel-version-edit" });
      dispatch({ type: "clear-feedback" });
    }}
  />;

  const stopDialog = (["add-stop", "create-stop", "edit-stop"] as StopDialogMode[]).includes(ui.dialog as StopDialogMode)
    ? ui.dialog as StopDialogMode
    : null;
  const stopsPanel = <RouteStops
    locale={locale}
    version={selectedVersion}
    memberships={memberships}
    stops={stops}
    usedStopIds={usedStopIds}
    busy={Boolean(busy)}
    feedback={ui.feedback?.scope === "stops" ? ui.feedback : null}
    dialogFeedback={ui.feedback?.scope === "stop-editor" ? ui.feedback : null}
    dialog={stopDialog}
    selectedStopId={ui.selectedStopId}
    onOpenDialog={(dialog, stopId) => {
      dispatch({ type: "clear-feedback" });
      dispatch({ type: "open-dialog", dialog, stopId });
    }}
    onCloseDialog={() => {
      dispatch({ type: "close-dialog" });
      if (ui.feedback?.scope === "stop-editor") dispatch({ type: "clear-feedback" });
    }}
    onMembershipsChange={setMemberships}
    onSaveOrder={saveStops}
    onCreateStop={submitStop}
    onEditStop={saveStop}
    onRetireStop={retireStop}
  />;

  return (
    <section
      className="route-management stack"
      dir={locale === "ar" ? "rtl" : "ltr"}
      lang={locale}
      data-selected-route-id={selectedRoute.id}
    >
      {ui.feedback?.scope === "page" && <Notice kind={ui.feedback.kind}>{ui.feedback.text}</Notice>}
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      <RouteWorkspace
        locale={locale}
        route={selectedRoute}
        selectedVersion={selectedVersion}
        tab={ui.tab}
        onBack={() => {
          setSelectedRoute(null);
          selectVersion(null);
          dispatch({ type: "back-to-directory" });
        }}
        onSelectTab={(tab) => dispatch({ type: "select-tab", tab })}
        overview={
          <RouteOverview
            locale={locale}
            route={selectedRoute}
            version={selectedVersion}
            readinessIssues={readinessIssues}
            actions={actions}
            lifecycleDialogOpen={ui.dialog === "lifecycle"}
            lifecycleFeedback={ui.feedback?.scope === "lifecycle" ? ui.feedback.text : null}
            busy={Boolean(busy)}
            onOpenLifecycleDialog={() => {
              dispatch({ type: "clear-feedback" });
              dispatch({ type: "open-dialog", dialog: "lifecycle" });
            }}
            onCloseLifecycleDialog={() => dispatch({ type: "close-dialog" })}
            onClone={() => void cloneVersion()}
            onPublish={() => void versionAction("publish")}
            onPause={(reason) => void versionAction("pause", reason)}
            onResume={() => void versionAction("resume")}
            onRetireVersion={(reason) => void versionAction("retire", reason)}
            onRetireRoute={(reason) => void retireRoute(reason)}
          />
        }
        versions={versionsPanel}
        stops={stopsPanel}
        fares={<RouteFares api={api} token={token} locale={locale} routeId={selectedRoute.id} />}
      />
    </section>
  );
}
