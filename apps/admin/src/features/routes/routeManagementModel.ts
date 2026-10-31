import type { RouteStopDraft, RouteVersionDraft, ServiceRoute } from "../../api";

export type RouteWorkspaceTab = "overview" | "versions" | "stops" | "fares";
export type RouteStopPermission = keyof Pick<
  RouteStopDraft,
  "passenger_pickup_allowed" | "passenger_dropoff_allowed" | "parcel_pickup_allowed" | "parcel_dropoff_allowed"
>;

export function moveRouteStop(stops: RouteStopDraft[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= stops.length) return stops;
  const reordered = [...stops];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  return reordered.map((stop, current) => ({ ...stop, sequence: current + 1 }));
}

export function removeRouteStop(stops: RouteStopDraft[], index: number) {
  if (index < 0 || index >= stops.length) return stops;
  return stops
    .filter((_, current) => current !== index)
    .map((stop, current) => ({ ...stop, sequence: current + 1 }));
}

export function toggleRouteStopPermission(stops: RouteStopDraft[], index: number, permission: RouteStopPermission) {
  return stops.map((stop, current) =>
    current === index ? { ...stop, [permission]: !stop[permission] } : stop
  );
}

type RouteVersionDraftSource = Pick<
  RouteVersionDraft,
  "name_ar" | "name_en" | "description_ar" | "description_en" | "active_from" | "active_until"
>;

function localDatetimeInput(value: string | null | undefined) {
  if (!value) return "";
  const instant = new Date(value);
  const localInstant = new Date(instant.getTime() - instant.getTimezoneOffset() * 60_000);
  return localInstant.toISOString().slice(0, 16);
}

function normalizeOptionalDescription(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

export function routeVersionDraftFrom(version: RouteVersionDraftSource): Required<RouteVersionDraft> {
  return {
    name_ar: version.name_ar,
    name_en: version.name_en,
    description_ar: version.description_ar ?? "",
    description_en: version.description_en ?? "",
    active_from: localDatetimeInput(version.active_from),
    active_until: localDatetimeInput(version.active_until)
  };
}

export function normalizeRouteVersionDraft(draft: RouteVersionDraft): Required<RouteVersionDraft> {
  return {
    name_ar: draft.name_ar,
    name_en: draft.name_en,
    description_ar: normalizeOptionalDescription(draft.description_ar),
    description_en: normalizeOptionalDescription(draft.description_en),
    active_from: draft.active_from ? new Date(draft.active_from).toISOString() : null,
    active_until: draft.active_until ? new Date(draft.active_until).toISOString() : null
  };
}

export function selectAuthoritativeRouteVersion(route: ServiceRoute, preferredVersionId: string | null) {
  const versions = route.versions ?? [];
  const preferred = preferredVersionId
    ? versions.find((version) => version.id === preferredVersionId)
      ?? (route.current_version?.id === preferredVersionId ? route.current_version : null)
    : null;
  if (preferred) return preferred;

  const current = route.current_version_id
    ? versions.find((version) => version.id === route.current_version_id) ?? route.current_version
    : route.current_version;
  return current ?? versions[0] ?? null;
}

export type RouteLifecycleDialogAction =
  | "clone"
  | "publish"
  | "pause"
  | "resume"
  | "retire-version"
  | "retire-route";

export function lifecycleActionRequiresReason(action: RouteLifecycleDialogAction) {
  return action === "pause" || action === "retire-version" || action === "retire-route";
}

export type RouteDialogName =
  | "create-route"
  | "create-version"
  | "add-stop"
  | "create-stop"
  | "edit-stop"
  | "lifecycle"
  | null;

export type RouteFeedbackScope = "page" | "create-route" | "version-editor" | "stops" | "stop-editor" | "lifecycle";
export type RouteFeedbackKind = "success" | "error";

export type RouteUiState = {
  surface: "directory" | "workspace";
  selectedRouteId: string | null;
  selectedVersionId: string | null;
  selectedStopId: string | null;
  tab: RouteWorkspaceTab;
  dialog: RouteDialogName;
  versionEditMode: boolean;
  feedback: { scope: RouteFeedbackScope; kind: RouteFeedbackKind; text: string } | null;
};

export const initialRouteUiState: RouteUiState = {
  surface: "directory",
  selectedRouteId: null,
  selectedVersionId: null,
  selectedStopId: null,
  tab: "overview",
  dialog: null,
  versionEditMode: false,
  feedback: null
};

export type RouteUiAction =
  | { type: "open-route"; routeId: string }
  | { type: "back-to-directory" }
  | { type: "select-tab"; tab: RouteWorkspaceTab }
  | { type: "select-version"; versionId: string | null }
  | { type: "open-dialog"; dialog: Exclude<RouteDialogName, null>; stopId?: string }
  | { type: "close-dialog" }
  | { type: "begin-version-edit" }
  | { type: "cancel-version-edit" }
  | { type: "feedback"; scope: RouteFeedbackScope; kind: RouteFeedbackKind; text: string }
  | { type: "clear-feedback" };

export function routeUiReducer(state: RouteUiState, action: RouteUiAction): RouteUiState {
  switch (action.type) {
    case "open-route":
      return {
        ...state,
        surface: "workspace",
        selectedRouteId: action.routeId,
        selectedVersionId: null,
        selectedStopId: null,
        tab: "overview",
        dialog: null,
        versionEditMode: false,
        feedback: null
      };
    case "back-to-directory":
      return {
        ...state,
        surface: "directory",
        selectedRouteId: null,
        selectedVersionId: null,
        selectedStopId: null,
        dialog: null,
        versionEditMode: false,
        feedback: null
      };
    case "select-tab":
      return { ...state, tab: action.tab };
    case "select-version":
      return { ...state, selectedVersionId: action.versionId, versionEditMode: false };
    case "open-dialog":
      return { ...state, dialog: action.dialog, selectedStopId: action.dialog === "edit-stop" ? action.stopId ?? null : null };
    case "close-dialog":
      return { ...state, dialog: null, selectedStopId: null };
    case "begin-version-edit":
      return { ...state, versionEditMode: true };
    case "cancel-version-edit":
      return { ...state, versionEditMode: false };
    case "feedback":
      return { ...state, feedback: { scope: action.scope, kind: action.kind, text: action.text } };
    case "clear-feedback":
      return { ...state, feedback: null };
  }
}
