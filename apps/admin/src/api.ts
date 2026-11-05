import type {
  BatchQueryInput,
  BatchRow,
  CurrentOrderParcelsPage,
  MatchQueryInput,
  MatchRow,
  Observed,
  Overview,
  Page,
  PageQuery,
  Range
} from "./features/monitoring/contracts";

export type ApiError = Error & { status?: number; details?: unknown };
/**
 * The `token` each method takes is the console's in-memory sign-in handle
 * (see `newAdminSessionHandle`), not a credential: requests authenticate with
 * the HttpOnly session cookie, which JavaScript never sees. The handle only
 * lets a late failure from an earlier sign-in be ignored.
 */
export type ApiClientOptions = { onSessionEnded?: (error: ApiError, requestSession: string) => void };

/**
 * Sent with every request. It asks the Admin sign-in for a cookie session and
 * is the API's CSRF check for cookie-authenticated requests.
 */
export const ADMIN_SESSION_HEADER = "X-Darb-Admin-Session";

function sessionHeaders(headers: Record<string, string> = {}): Record<string, string> {
  return { ...headers, [ADMIN_SESSION_HEADER]: "1" };
}
export type RouteLifecycleExpectation = {
  expected_current_version_id: string | null;
};
type RouteVersionActionPayload = {
  pause: RouteLifecycleExpectation & { reason: string };
  resume: RouteLifecycleExpectation;
  retire: RouteLifecycleExpectation & { reason: string };
};
type RouteRetirementPayload = { reason: string; expected_current_version_id: null };

export function createApiClient(apiBaseUrl: string, clientOptions: ApiClientOptions = {}) {
  async function apiRequest<T>(path: string, options: { method?: string; token?: string; body?: unknown; idempotencyKey?: string; reportSessionEnd?: boolean } = {}) {
    const headers = sessionHeaders({ "Content-Type": "application/json" });
    if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

    const response = await fetch(`${apiBaseUrl}/api/v1${path}`, {
      method: options.method ?? "GET",
      headers,
      credentials: "include",
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const error = new Error(data?.error ?? `Request failed with ${response.status}`) as ApiError;
      error.status = response.status;
      error.details = data;
      if (options.token && options.reportSessionEnd !== false) clientOptions.onSessionEnded?.(error, options.token);
      throw error;
    }
    return data as T;
  }

  async function downloadCsv(path: string, token: string) {
    const response = await fetch(`${apiBaseUrl}/api/v1${path}`, { headers: sessionHeaders(), credentials: "include" });
    if (!response.ok) {
      // The API's error code (e.g. `session_expired`) lets an ended session show the sign-in screen.
      const data = await response.json().catch(() => null) as { error?: unknown } | null;
      const error = new Error(typeof data?.error === "string" ? data.error : `Export failed with ${response.status}`) as ApiError;
      error.status = response.status;
      clientOptions.onSessionEnded?.(error, token);
      throw error;
    }
    return response.blob();
  }

  function reportQuery(range: ReportRange, extra: Record<string, string> = {}) {
    const query = new URLSearchParams(extra);
    if (range.from) query.set("from", range.from);
    if (range.to) query.set("to", range.to);
    const text = query.toString();
    return text ? `?${text}` : "";
  }

  function operationalQuery(query: OperationalListQuery) {
    return { page: query.page, limit: query.limit, search: query.search?.trim() || undefined };
  }

  function withQuery(path: string, values: Record<string, string | number | undefined>) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) query.set(key, String(value));
    }
    const encoded = query.toString();
    return encoded ? `${path}?${encoded}` : path;
  }

return {
  incidents: (token: string, query: { status?: IncidentStatus; page?: number; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (query.status) params.set("status", query.status);
    if (query.page) params.set("page", String(query.page));
    if (query.limit) params.set("limit", String(query.limit));
    const text = params.toString();
    return apiRequest<IncidentPage>(`/admin/incidents${text ? `?${text}` : ""}`, { token });
  },
  updateIncident: (token: string, id: string, body: { status: Exclude<IncidentStatus, "open">; expected_revision: number; note?: string }) =>
    apiRequest<{ incident: IncidentRecord }>(`/admin/incidents/${encodeURIComponent(id)}`, { method: "PATCH", token, body }),
  uncertainAiRequests: (token: string, query: { status?: UncertainAiStatus; page?: number; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (query.status) params.set("status", query.status);
    if (query.page) params.set("page", String(query.page));
    if (query.limit) params.set("limit", String(query.limit));
    const text = params.toString();
    return apiRequest<UncertainAiPage>(`/admin/ai-uncertain-requests${text ? `?${text}` : ""}`, { token });
  },
  resolveUncertainAiRequest: (token: string, id: string, body: { expected_revision: number; note?: string }) =>
    apiRequest<{ request: UncertainAiRecord }>(`/admin/ai-uncertain-requests/${encodeURIComponent(id)}`, { method: "PATCH", token, body }),
  reportSummary: (token: string, range: ReportRange) => apiRequest<ReportSummary>(`/admin/reports/summary${reportQuery(range)}`, { token }),
  reportExport: (token: string, dataset: ReportDataset, range: ReportRange) => downloadCsv(`/admin/reports/export${reportQuery(range, { dataset })}`, token),
  successMetrics: (token: string, range: ReportRange) => apiRequest<SuccessMetricsResponse>(`/admin/success-metrics${reportQuery(range)}`, { token }),
  successMetricsExport: (token: string, range: ReportRange) => downloadCsv(`/admin/success-metrics/export${reportQuery(range)}`, token),
  login: (email: string, password: string) => apiRequest<LoginResponse>("/auth/admin/login", { method: "POST", body: { email, password } }),
  googleLogin: (id_token: string) => apiRequest<LoginResponse>("/auth/admin/google", { method: "POST", body: { id_token } }),
  authCapabilities: () => apiRequest<{ google_admin_login_available: boolean; google_admin_client_id: string | null }>("/auth/capabilities"),
  // Revokes the server session on sign-out. A failure here must not look like a session expiry.
  logout: (token: string) => apiRequest<{ ok: boolean }>("/auth/logout", { method: "POST", token, reportSessionEnd: false }),
  me: (token: string) => apiRequest<MeResponse>("/me", { token }),
  // On page load: resumes a cookie session that is still alive. No session yet, so a 401 here is not an expiry.
  currentSession: () => apiRequest<MeResponse>("/me"),
  capabilities: (token: string) => apiRequest<CapabilitiesResponse>("/capabilities", { token }),
  dashboard: (token: string) => apiRequest<DashboardResponse>("/admin/dashboard", { token }),
  comparisonSimulation: (token: string, query?: { seed?: number; manual_response_delay_min?: number }) =>
    apiRequest<{ simulation: ComparisonSimulation }>(withQuery("/compare/simulation", query ?? {}), { token }),
  monitoringOverview: (token: string, query?: Range) =>
    apiRequest<Observed<Overview>>(withQuery("/admin/matching-batching/overview", query ?? {}), { token }),
  monitoringMatches: (token: string, query: MatchQueryInput) =>
    apiRequest<Page<MatchRow>>(withQuery("/admin/matching-batching/matches", query), { token }),
  monitoringMatch: (token: string, id: string) =>
    apiRequest<Observed<MatchRow>>(`/admin/matching-batching/matches/${encodeURIComponent(id)}`, { token }),
  monitoringBatches: (token: string, query: BatchQueryInput) =>
    apiRequest<Page<BatchRow>>(withQuery("/admin/matching-batching/batches", query), { token }),
  monitoringBatch: (token: string, id: string) =>
    apiRequest<Observed<BatchRow>>(`/admin/matching-batching/batches/${encodeURIComponent(id)}`, { token }),
  monitoringParcels: (token: string, id: string, query: PageQuery) =>
    apiRequest<CurrentOrderParcelsPage>(
      withQuery(`/admin/matching-batching/batches/${encodeURIComponent(id)}/parcels`, query),
      { token }
    ),
  users: (
    token: string,
    role: UserRoleFilter = "all",
    accountStatus: UserAccountStatus | "all" = "all",
    page = 1,
    limit = 50,
    search = "",
    demoAccount: "all" | "demo" | "real" = "all"
  ) => {
    const query = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      search
    });
    if (role !== "all") query.set("role", role);
    if (accountStatus !== "all") query.set("account_status", accountStatus);
    if (search) query.set("search", search);
    if (demoAccount !== "all") query.set("demo_account", demoAccount === "demo" ? "true" : "false");
    return apiRequest<UserPage>(`/admin/users?${query.toString()}`, { token });
  },
  user: (token: string, id: string) => apiRequest<{ user: UserDetail }>(`/admin/users/${encodeURIComponent(id)}`, { token }),
  /** Without a page or limit the API returns every driver (the overview's view); with one, a page plus `total`. */
  drivers: (token: string, query: OperationalListQuery = {}) =>
    apiRequest<{ drivers: DriverProfile[] } & Partial<PageMeta>>(withQuery("/admin/drivers", operationalQuery(query)), { token }),
  driverVerifications: (token: string, status: DriverVerificationStatus = "pending", page = 1, limit = 50) =>
    apiRequest<DriverVerificationPage>(
      `/admin/driver-verifications?status=${encodeURIComponent(status)}&page=${page}&limit=${limit}`,
      { token }
    ),
  driverVerification: (token: string, userId: string) =>
    apiRequest<{ verification: DriverVerification }>(
      `/admin/driver-verifications/${encodeURIComponent(userId)}`,
      { token }
    ),
  approveDriverVerification: (
    token: string,
    userId: string,
    expectedRevision: number,
    profile?: DriverProfileDraft,
    expiry?: DriverExpiryInput
  ) =>
    apiRequest<{ verification: DriverVerification }>(
      `/admin/driver-verifications/${encodeURIComponent(userId)}/approve`,
      { method: "POST", token, body: { expected_revision: expectedRevision, ...(profile ? { profile } : {}), ...(expiry && Object.keys(expiry).length ? { expiry } : {}) } }
    ),
  driverVerificationsExpiring: (token: string, withinDays = 30, kind?: DriverExpiryKind, page = 1, limit = 50) =>
    apiRequest<DriverVerificationPage>(
      `/admin/driver-verifications/expiring?within_days=${withinDays}${kind ? `&kind=${kind}` : ""}&page=${page}&limit=${limit}`,
      { token }
    ),
  driverVerificationsReReview: (token: string, state: DriverReReviewState = "submitted", page = 1, limit = 50) =>
    apiRequest<DriverVerificationPage>(
      `/admin/driver-verifications/re-review?state=${state}&page=${page}&limit=${limit}`,
      { token }
    ),
  rejectDriverVerification: (token: string, userId: string, expectedRevision: number, reason: string) =>
    apiRequest<{ verification: DriverVerification }>(
      `/admin/driver-verifications/${encodeURIComponent(userId)}/reject`,
      { method: "POST", token, body: { expected_revision: expectedRevision, reason } }
    ),
  reopenDriverVerification: (token: string, userId: string, expectedRevision: number, reason: string) =>
    apiRequest<{ verification: DriverVerification }>(
      `/admin/driver-verifications/${encodeURIComponent(userId)}/reopen`,
      { method: "POST", token, body: { expected_revision: expectedRevision, reason } }
    ),
  downloadDriverDocument: (token: string, userId: string, documentId: string) =>
    downloadCsv(`/admin/driver-verifications/${encodeURIComponent(userId)}/documents/${encodeURIComponent(documentId)}`, token),
  recordDriverEvidence: (token: string, userId: string, expectedRevision: number, kind: EvidenceKind, note?: string) =>
    apiRequest<{ verification: DriverVerification }>(
      `/admin/driver-verifications/${encodeURIComponent(userId)}/evidence`,
      { method: "POST", token, body: note ? { expected_revision: expectedRevision, kind, note } : { expected_revision: expectedRevision, kind } }
    ),
  merchantDocuments: (token: string, userId: string) =>
    apiRequest<{ documents: Array<{ id: string; kind: string; mime_type: string; size_bytes: number; created_at: string }> }>(
      `/admin/merchant-approvals/${encodeURIComponent(userId)}/documents`,
      { token }
    ),
  downloadMerchantDocument: (token: string, userId: string, documentId: string) =>
    downloadCsv(`/admin/merchant-approvals/${encodeURIComponent(userId)}/documents/${encodeURIComponent(documentId)}`, token),
  decideMerchantApproval: (token: string, userId: string, decision: "approve" | "reject", reason?: string) =>
    apiRequest<{ user: AdminUser }>(
      `/admin/merchant-approvals/${encodeURIComponent(userId)}/${decision}`,
      { method: "POST", token, body: reason ? { reason } : {} }
    ),
  adminInvitations: (token: string, query: { page?: number; limit?: number } = {}) =>
    apiRequest<InvitationPage>(withQuery("/admin/invitations", query), { token }),
  createAdminInvitation: (token: string, body: { role: InvitationRole; phone: string; contact_email: string }) =>
    apiRequest<{ invitation: InvitationRecord; code: string }>("/admin/invitations", { method: "POST", token, body }),
  revokeAdminInvitation: (token: string, id: string, reason: string) =>
    apiRequest<{ invitation: InvitationRecord }>(`/admin/invitations/${encodeURIComponent(id)}/revoke`, { method: "POST", token, body: { reason } }),
  consentReleases: (token: string) =>
    apiRequest<{ releases: ConsentRelease[] }>("/admin/consent-releases", { token }),
  currentConsentRelease: (token: string) =>
    apiRequest<ConsentCurrentResponse>("/admin/consent-releases/current", { token }),
  createConsentRelease: (token: string, draft: ConsentReleaseDraft) =>
    apiRequest<{ release: ConsentRelease }>("/admin/consent-releases", { method: "POST", token, body: draft }),
  updateConsentRelease: (token: string, version: string, expectedRevision: number, draft: Omit<ConsentReleaseDraft, "version">) =>
    apiRequest<{ release: ConsentRelease }>(`/admin/consent-releases/${encodeURIComponent(version)}`, {
      method: "PUT",
      token,
      body: { expected_revision: expectedRevision, ...draft }
    }),
  approveConsentRelease: (token: string, version: string, expectedRevision: number) =>
    apiRequest<{ release: ConsentRelease }>(`/admin/consent-releases/${encodeURIComponent(version)}/approve`, {
      method: "POST",
      token,
      body: { expected_revision: expectedRevision, legal_approval_confirmed: true }
    }),
  activateConsentRelease: (token: string, version: string, expectedRevision: number, expectedCurrentReleaseId: string | null) =>
    apiRequest<{ release: ConsentRelease }>(`/admin/consent-releases/${encodeURIComponent(version)}/activate`, {
      method: "POST",
      token,
      body: { expected_revision: expectedRevision, expected_current_release_id: expectedCurrentReleaseId, activation_confirmed: true }
    }),
  retireConsentRelease: (token: string, version: string, expectedRevision: number, reason: string) =>
    apiRequest<{ release: ConsentRelease }>(`/admin/consent-releases/${encodeURIComponent(version)}/retire`, {
      method: "POST",
      token,
      body: { expected_revision: expectedRevision, reason, confirm_disable_onboarding: true }
    }),
  /**
   * Suspend, disable or reactivate an account.
   *
   * The API requires a reason of at least three characters for anything other
   * than `active`, revokes every session the account holds, and writes an audit
   * event — so this is the one genuinely destructive control in the console.
   */
  updateUserStatus: (token: string, id: string, status: AccountStatus, reason: string | undefined, expectedStatus: UserAccountStatus) => {
    if (!expectedStatus) return Promise.reject(new Error("Expected account status is required"));
    return apiRequest<{ user: AdminUser }>(`/admin/users/${id}/status`, {
      method: "PATCH",
      token,
      body: { status, ...(reason ? { reason } : {}), expected_status: expectedStatus }
    });
  },
  requests: (token: string, query: OperationalListQuery = {}) =>
    apiRequest<{ requests: PassengerRequest[] } & Partial<PageMeta>>(withQuery("/admin/requests", operationalQuery(query)), { token }),
  /** Merchant orders only: passenger parcels have their own list. */
  orders: (token: string, query: OperationalListQuery = {}) =>
    apiRequest<{ orders: MerchantOrder[] } & Partial<PageMeta>>(withQuery("/admin/orders", operationalQuery(query)), { token }),
  passengerParcels: (token: string) => apiRequest<{ parcels: PassengerParcelRow[] }>("/admin/passenger-parcels", { token }),
  routes: (token: string, query: OperationalListQuery = {}) =>
    apiRequest<{ routes: DriverRoute[] } & Partial<PageMeta>>(withQuery("/admin/routes", operationalQuery(query)), { token }),
  updateDriverExpiry: (token: string, userId: string, expectedRevision: number, expiry: DriverExpiryInput) =>
    apiRequest<{ verification: DriverVerification }>(
      `/admin/driver-verifications/${encodeURIComponent(userId)}/expiry`,
      { method: "POST", token, body: { expected_revision: expectedRevision, expiry } }
    ),
  communityReports: (token: string, query: CommunityReportQuery = {}) =>
    apiRequest<CommunityReportPage>(withQuery("/admin/community-reports", {
      pending: query.pending === undefined ? undefined : String(query.pending),
      category: query.category,
      hidden: query.hidden === undefined ? undefined : String(query.hidden),
      page: query.page,
      limit: query.limit
    }), { token }),
  moderateCommunityReport: (token: string, id: string, action: CommunityReportAction) =>
    apiRequest<{ report: CommunityReport }>(`/admin/community-reports/${encodeURIComponent(id)}`, { method: "PATCH", token, body: { action } }),
  appRatings: (token: string, query: AppRatingQuery = {}) =>
    apiRequest<AppRatingPage>(withQuery("/admin/app-ratings", query), { token }),
  mapPlaces: (token: string, query: MapPlaceQuery = {}) =>
    apiRequest<MapPlacePage>(withQuery("/admin/map-places", { ...query, search: query.search || undefined, category: query.category || undefined, active: query.active || undefined }), { token }),
  mapPlaceSummary: (token: string) => apiRequest<MapPlaceSummary>("/admin/map-places/summary", { token }),
  createMapPlace: (token: string, body: MapPlaceDraft) =>
    apiRequest<{ place: MapPlace }>("/admin/map-places", { method: "POST", token, body }),
  updateMapPlace: (token: string, id: string, body: MapPlaceUpdate) =>
    apiRequest<{ place: MapPlace }>(`/admin/map-places/${encodeURIComponent(id)}`, { method: "PATCH", token, body }),
  mapPlaceReports: (token: string, query: { page?: number; limit?: number } = {}) =>
    apiRequest<MapPlaceReportPage>(withQuery("/admin/map-place-reports", { ...query, status: "open" }), { token }),
  reviewMapPlaceReport: (token: string, id: string, body: { status: "resolved" | "dismissed"; deactivate_place?: boolean }) =>
    apiRequest<{ report: { id: string; status: string } }>(`/admin/map-place-reports/${encodeURIComponent(id)}`, { method: "PATCH", token, body }),
  checkpointPositions: (token: string, query: { search?: string; page?: number; limit?: number } = {}) =>
    apiRequest<CheckpointPositionPage>(withQuery("/admin/checkpoint-positions", { ...query, search: query.search || undefined }), { token }),
  createCheckpointPosition: (token: string, body: CheckpointPositionDraft) =>
    apiRequest<{ position: CheckpointPosition }>("/admin/checkpoint-positions", { method: "POST", token, body }),
  updateCheckpointPosition: (token: string, id: string, body: CheckpointPositionUpdate) =>
    apiRequest<{ position: CheckpointPosition }>(`/admin/checkpoint-positions/${encodeURIComponent(id)}`, { method: "PATCH", token, body }),
  deleteCheckpointPosition: (token: string, id: string) =>
    apiRequest<{ deleted: true }>(`/admin/checkpoint-positions/${encodeURIComponent(id)}`, { method: "DELETE", token }),
  unplacedCheckpoints: (token: string) =>
    apiRequest<UnplacedCheckpointsResponse>("/admin/checkpoint-positions/unplaced", { token }),
  /** Every city's places, disabled ones included; optionally one city or a name search. */
  cityPlaces: (token: string, query: { city_key?: string; search?: string } = {}) =>
    apiRequest<{ cities: CityPlaceCity[]; places: CityPlace[] }>(withQuery("/admin/city-places", { city_key: query.city_key || undefined, search: query.search || undefined }), { token }),
  createCityPlace: (token: string, body: CityPlaceDraft) =>
    apiRequest<{ place: CityPlace }>("/admin/city-places", { method: "POST", token, body }),
  updateCityPlace: (token: string, id: string, body: CityPlaceUpdate) =>
    apiRequest<{ place: CityPlace }>(`/admin/city-places/${encodeURIComponent(id)}`, { method: "PATCH", token, body }),
  /** Every predefined route, active and turned off, with how many orders use it. */
  operatingRoutes: (token: string) => apiRequest<{ routes: AdminOperatingRoute[] }>("/admin/operating-routes", { token }),
  createOperatingRoute: (token: string, body: OperatingRouteDraft) =>
    apiRequest<OperatingRouteCreateResponse>("/admin/operating-routes", { method: "POST", token, body }),
  /** Turning a route off pauses its current version: new orders cannot use it, existing ones continue. */
  setOperatingRouteActive: (token: string, id: string, active: boolean) =>
    apiRequest<OperatingRouteCreateResponse>(`/admin/operating-routes/${encodeURIComponent(id)}`, { method: "PATCH", token, body: { active } }),
  operatingCities: (token: string) => apiRequest<{ cities: OperatingCity[] }>("/admin/cities", { token }),
  createOperatingCity: (token: string, body: OperatingCityDraft) =>
    apiRequest<OperatingCityCreateResponse>("/admin/cities", { method: "POST", token, body }),
  adminTrips: (
    token: string,
    status: TripStatus | "all" = "all",
    kind: AdminTripKind | "all" = "all",
    page = 1,
    limit = 25,
    search = "",
  ) => {
    const query = new URLSearchParams({ page: String(page), limit: String(limit), search });
    if (status !== "all") query.set("status", status);
    if (kind !== "all") query.set("kind", kind);
    return apiRequest<AdminTripPage>(`/admin/trips?${query.toString()}`, { token });
  },
  adminTrip: (token: string, id: string) =>
    apiRequest<{ trip: AdminTripDetail }>(`/admin/trips/${encodeURIComponent(id)}`, { token }),
  advanceAdminTrip: (token: string, id: string, status: AdminForwardTripStatus, expectedStatus: TripStatus) =>
    apiRequest<{ trip: { id: string; status: TripStatus } }>(`/admin/trips/${encodeURIComponent(id)}/status`, {
      method: "POST",
      token,
      body: { status, expected_status: expectedStatus },
    }),
  /** Cancels a trip that is not finished; the driver and every rider or sender on it are told why. */
  cancelAdminTrip: (token: string, id: string, body: CancellationBody) =>
    apiRequest<{ cancelled: true }>(`/admin/trips/${encodeURIComponent(id)}/cancel`, { method: "POST", token, body }),
  /** Cancels a ride request (and its trip, if a driver accepted it). */
  cancelPassengerRequest: (token: string, id: string, body: CancellationBody) =>
    apiRequest<{ cancelled: true }>(`/admin/requests/${encodeURIComponent(id)}/cancel`, { method: "POST", token, body }),
  /** Cancels one merchant order or passenger parcel; on a shared trip only this order leaves it. */
  cancelMerchantOrder: (token: string, id: string, body: CancellationBody) =>
    apiRequest<{ cancelled: true }>(
      `/admin/orders/${encodeURIComponent(id)}/cancel`,
      { method: "POST", token, body }
    ),
  /** The cancellation history, newest first; pass `next_cursor` back as `cursor` for the next page. */
  cancellations: (token: string, query: CancellationQuery = {}) =>
    apiRequest<CancellationPage>(withQuery("/admin/cancellations", query), { token }),
  serviceRoutes: (token: string, query = "") => apiRequest<RoutePage>(`/admin/service-routes${query}`, { token }),
  serviceRoute: (token: string, id: string) => apiRequest<{ route: ServiceRoute }>(`/admin/service-routes/${id}`, { token }),
  createServiceRoute: (token: string, body: RouteIdentityDraft, key: string) => apiRequest<{ route: ServiceRoute }>("/admin/service-routes", { method: "POST", token, body, idempotencyKey: key }),
  createRouteVersion: (token: string, routeId: string, body: RouteVersionDraft | { clone_from_version_id: string }, key: string) => apiRequest<{ version: ServiceRouteVersion }>(`/admin/service-routes/${routeId}/versions`, { method: "POST", token, body, idempotencyKey: key }),
  updateRouteVersion: (token: string, id: string, body: RouteVersionDraft & { expected_revision: number }) => apiRequest<{ version: ServiceRouteVersion }>(`/admin/route-versions/${id}`, { method: "PATCH", token, body }),
  replaceRouteStops: (token: string, id: string, body: { expected_revision: number; stops: RouteStopDraft[] }) => apiRequest<{ version: ServiceRouteVersion }>(`/admin/route-versions/${id}/stops`, { method: "PUT", token, body }),
  publishRouteVersion: (token: string, id: string, body: { expected_revision: number; expected_current_version_id: string | null }, key: string) => apiRequest<{ version: ServiceRouteVersion }>(`/admin/route-versions/${id}/publish`, { method: "POST", token, body, idempotencyKey: key }),
  routeVersionAction: <Action extends keyof RouteVersionActionPayload>(
    token: string,
    id: string,
    action: Action,
    body: RouteVersionActionPayload[Action],
    key: string
  ) => apiRequest<{ version: ServiceRouteVersion }>(`/admin/route-versions/${id}/${action}`, { method: "POST", token, body, idempotencyKey: key }),
  routeFares: (token: string, routeId: string) =>
    apiRequest<RouteFaresResponse>(`/admin/service-routes/${encodeURIComponent(routeId)}/fares`, { token }),
  setRouteFares: (token: string, routeId: string, body: RouteFaresUpdate) =>
    apiRequest<RouteFaresResponse>(`/admin/service-routes/${encodeURIComponent(routeId)}/fares`, { method: "PUT", token, body }),
  retireServiceRoute: (token: string, id: string, body: RouteRetirementPayload, key: string) => apiRequest<{ route: ServiceRoute }>(`/admin/service-routes/${id}/retire`, { method: "POST", token, body, idempotencyKey: key }),
  canonicalStops: (token: string, query = "") => apiRequest<StopPage>(`/admin/stops${query}`, { token }),
  createCanonicalStop: (token: string, body: CanonicalStopDraft, key: string) => apiRequest<{ stop: CanonicalStop }>("/admin/stops", { method: "POST", token, body, idempotencyKey: key }),
  updateCanonicalStop: (token: string, id: string, body: Omit<CanonicalStopDraft, "stop_key">) => apiRequest<{ stop: CanonicalStop }>(`/admin/stops/${id}`, { method: "PATCH", token, body }),
  retireCanonicalStop: (token: string, id: string, reason: string, key: string) => apiRequest<{ stop: CanonicalStop }>(`/admin/stops/${id}/retire`, { method: "POST", token, body: { reason }, idempotencyKey: key })
};
}

export function createDemoApiClient(apiBaseUrl: string, clientOptions: ApiClientOptions = {}) {
  if (!__DARB_DEMO_BUILD__) return null;
  const apiRequest = async <T>(path: string, options: { method?: string; token?: string; body?: unknown; resetKey?: string } = {}) => {
    const headers = sessionHeaders({ "Content-Type": "application/json" });
    if (options.resetKey) headers["x-demo-reset-key"] = options.resetKey;
    const response = await fetch(`${apiBaseUrl}/api/v1${path}`, {
      method: options.method ?? "GET",
      headers,
      credentials: "include",
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const error = new Error(data?.error ?? `Request failed with ${response.status}`) as ApiError;
      error.status = response.status;
      error.details = data;
      if (options.token) clientOptions.onSessionEnded?.(error, options.token);
      throw error;
    }
    return data as T;
  };
  return {
    reset: (token: string | undefined, resetKey: string) => apiRequest<{ ok: boolean; seed: unknown }>("/demo/reset", { method: "POST", token, resetKey, body: {} }),
    runMatch: (token: string, passengerRequestId?: string, merchantOrderId?: string) =>
      apiRequest<MatchRunResponse>("/matches/run", { method: "POST", token, body: { passengerRequestId, merchantOrderId } }),
    batchOrder: (token: string, orderId: string) => apiRequest<BatchResponse>(`/merchant/orders/${orderId}/batch`, { method: "POST", token, body: {} }),
    runComparison: (token: string, passengerRequestId?: string, merchantOrderId?: string) =>
      apiRequest<{ comparison: Comparison }>("/compare/run", { method: "POST", token, body: { scenarioKey: "darb_batch_wins", passengerRequestId, merchantOrderId } }),
    acceptMatch: (token: string, id: string) => apiRequest<{ trip: Trip; matchId: string }>(`/matches/${id}/accept`, { method: "POST", token, body: {} }),
    updateTripStatus: (token: string, id: string, status: string) =>
      apiRequest<{ trip: Trip }>(`/trips/${id}/status`, { method: "POST", token, body: { status } }),
    simulateStep: (token: string, id: string) => apiRequest<{ location: LocationEvent }>(`/trips/${id}/simulate/step`, { method: "POST", token, body: {} })
  };
}

export type User = { id: string; name: string; phone: string; role: string };
export type CapabilitiesResponse = { demo_reset_available: boolean };

/** The three values `PATCH /admin/users/:id/status` accepts. */
export type AccountStatus = "active" | "suspended" | "disabled";
/** Every account state the read-only Admin APIs can return. */
export type UserAccountStatus = AccountStatus | "pending";
export type UserRoleFilter = "all" | "passenger" | "driver" | "merchant" | "admin";

export type UserRoleContextDriver = {
  kind: "driver";
  driver_profile_exists: boolean;
  driver_profile_verified: boolean;
  driver_verification_status: DriverVerificationStatus | "none";
  /** False while an open-signup applicant has not sent the required documents for review. */
  application_submitted?: boolean;
  /** True when neither the email nor the phone was proven by a code (direct sign-up). */
  contact_unverified?: boolean;
};
export type UserRoleContextMerchant = { kind: "merchant"; merchant_approval_connected: boolean; application_submitted?: boolean; contact_unverified?: boolean };
export type UserRoleContextPassenger = { kind: "passenger" };
export type UserRoleContextAdmin = { kind: "admin" };
export type UserRoleContext = UserRoleContextDriver | UserRoleContextMerchant | UserRoleContextPassenger | UserRoleContextAdmin;

/**
 * A user as the admin endpoints serialise it — the `safeUserSelect` shape,
 * which deliberately omits the password hash and security version.
 */
export type AdminUser = User & {
  account_status: UserAccountStatus;
  status_reason: string | null;
  status_updated_at: string;
  last_login_at: string | null;
  demo_account: boolean;
  created_at: string;
};
export type UserListItem = AdminUser & { role_context: UserRoleContext };
export type UserPage = { users: UserListItem[]; page: number; limit: number; total: number };

export type UserDetail = {
  id: string;
  name: string;
  phone: string;
  role: "passenger" | "driver" | "merchant" | "admin";
  account_status: UserAccountStatus;
  status_reason: string | null;
  status_updated_at: string;
  last_login_at: string | null;
  demo_account: boolean;
  created_at: string;
  role_context: UserRoleContext;
  driver_profile: (DriverProfile & { created_at?: string }) | null;
  driver_verification: DriverVerification | null;
  active_session_count: number;
  last_session_at: string | null;
  passenger_request_count: number;
  merchant_order_count: number;
};

export const TRUST_COMPONENT_KEYS = ["experience", "cancellation", "departure", "arrival", "rating"] as const;
export type TrustComponentKey = (typeof TRUST_COMPONENT_KEYS)[number];
/** value is 0..1 after damping; sample is the number of observations behind it. */
export type TrustComponents = Record<TrustComponentKey, { value: number; sample: number; weight: number }>;

/**
 * A driver profile from `GET /admin/drivers`.
 *
 * `verified` is stored on the row but no endpoint writes it, so the console can
 * report the flag and must not offer to change it.
 */
export type DriverProfile = {
  id: string;
  vehicle_type: string;
  seats_total: number;
  parcel_capacity: number;
  /** Declared by the applicant at Google onboarding; absent for Admin-created profiles. */
  vehicle_make_model?: string | null;
  vehicle_color?: string | null;
  plate_number?: string | null;
  national_id_number?: string | null;
  licence_number?: string | null;
  verified: boolean;
  trust_score: number;
  /** Per-component breakdown of the trust score; null until first computed. */
  trust_components?: TrustComponents | null;
  trust_computed_at?: string | null;
  created_at: string;
  user?: AdminUser;
  routes?: DriverRoute[];
};
export type DriverVerificationStatus = "pending" | "approved" | "rejected" | "documents_expired";
export const EXPIRY_KINDS = ["licence", "vehicle_registration", "insurance", "contract"] as const;
export type DriverExpiryKind = (typeof EXPIRY_KINDS)[number];
/** YYYY-MM-DD, the last valid day; null clears a recorded date. */
export type DriverExpiryInput = Partial<Record<DriverExpiryKind, string | null>>;
export type DriverReReviewState = "submitted" | "awaiting_driver" | "all";
export type DriverExpiry = Record<DriverExpiryKind, { expires_on: string; days_left: number } | null>;
export type DriverProfileDraft = {
  vehicle_type: string;
  seats_total: number;
  parcel_capacity: number;
};
export type DriverVerification = {
  id: string;
  revision: number;
  status: DriverVerificationStatus;
  expiry?: DriverExpiry;
  documents_expired_at?: string | null;
  renewal_submitted_at?: string | null;
  rejection_reason: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  reviewer: { id: string; name: string } | null;
  candidate: AdminUser;
  /** True when the applicant's email and phone were never proven by a code. */
  contact_unverified?: boolean;
  driver_profile: DriverProfile | null;
  history: DriverVerificationHistoryEntry[];
  evidence: DriverVerificationEvidence;
};
export const EVIDENCE_KINDS = ["driver_licence", "vehicle_registration", "vehicle_photo", "national_id", "insurance", "other"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export type DriverVerificationEvidence = {
  status: "not_collected" | "recorded";
  items: { id: string; kind: EvidenceKind; note: string | null; recorded_by: { id: string; name: string } | null; created_at: string }[];
  documents: { id: string; kind: EvidenceKind; mime_type: string; size_bytes: number; created_at: string }[];
};
export type DriverVerificationHistoryEntry = {
  id: string;
  revision: number;
  decision: "approved" | "rejected" | "reopened" | "documents_expired" | "renewal_submitted";
  reason: string | null;
  decided_by: { id: string; name: string } | null;
  created_at: string;
};
export type DriverVerificationPage = {
  verifications: DriverVerification[];
  page: number;
  limit: number;
  total: number;
};
export type ConsentDocumentType = "terms" | "privacy" | "adult_self_attestation";
export type ConsentLocale = "ar" | "en";
export type ConsentReleaseStatus = "draft" | "approved" | "effective" | "retired";
export type ConsentReleaseDocument = {
  id: string;
  type: ConsentDocumentType;
  locale: ConsentLocale;
  version: string;
  content: string | null;
  content_digest: string;
  effective_at: string;
  retired_at: string | null;
  legal_approved_at: string | null;
  legal_approved_by: string | null;
};
export type InvitationRole = "passenger" | "driver" | "merchant";
export type InvitationRecord = {
  id: string;
  role: InvitationRole;
  /** Already masked by the API. */
  phone: string | null;
  contact_email: string | null;
  status: "unused" | "used" | "expired" | "revoked";
  expires_at: string;
  created_at: string;
};
export type InvitationPage = { invitations: InvitationRecord[]; page: number; limit: number; total: number };
export type ConsentRelease = {
  id: string;
  version: string;
  status: ConsentReleaseStatus;
  revision: number;
  intended_effective_at: string;
  legal_approved_at: string | null;
  legal_approved_by: string | null;
  activated_at: string | null;
  activated_by: string | null;
  retired_at: string | null;
  retired_by: string | null;
  retirement_reason: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  documents: ConsentReleaseDocument[];
};
export type ConsentReleaseDraft = {
  version: string;
  intended_effective_at: string;
  documents: Array<{ type: ConsentDocumentType; locale: ConsentLocale; content: string }>;
};
export type ConsentCurrentResponse = {
  ready: boolean;
  ambiguous: boolean;
  release: ConsentRelease | null;
};
export type ApiClient = ReturnType<typeof createApiClient>;
/** The session credential is the HttpOnly cookie the response sets; the body carries no token. */
export type LoginResponse = { user: User };
export type MeResponse = { user: User };

export type DashboardResponse = {
  counts: {
    users: number;
    drivers: number;
    routes: number;
    passenger_requests: number;
    /** Merchant orders only; passenger parcels are counted in `passenger_parcels`. */
    merchant_orders: number;
    passenger_parcels?: number;
    parcels: number;
    active_drivers: number;
    pending_driver_approvals: number;
    open_incidents: number;
  };
  /** Absent from older API builds. */
  alerts?: {
    unmatched_requests: number;
    unbatched_orders: number;
    unverified_driver_routes: number;
  };
  /** The five newest of each, newest first. */
  recent?: {
    passenger_requests: PassengerRequest[];
    merchant_orders: MerchantOrder[];
    routes: DriverRoute[];
  };
  /** Trip figures counted in the database over every trip. Absent from older API builds. */
  trips?: {
    by_status: Partial<Record<TripStatus, number>>;
    /** Trips from the start of pickup until delivery is recorded. */
    active_total: number;
    /** The newest in-progress trips (at most 50), newest first. */
    active: DashboardActiveTrip[];
  };
};

export type DashboardActiveTrip = {
  id: string;
  status: TripStatus;
  driver_route_id: string;
  created_at: string;
  started_at: string | null;
  driver_route: {
    id: string;
    origin_label: string;
    destination_label: string;
    driver: { id: string; user: AdminUser };
  };
};

export type PageMeta = { page: number; limit: number; total: number };
export type OperationalListQuery = { page?: number; limit?: number; search?: string };

export const COMMUNITY_REPORT_CATEGORIES = [
  "road_closure",
  "road_reopened",
  "road_congestion",
  "checkpoint_open_marked_closed",
  "checkpoint_closed_marked_open",
  "checkpoint_outdated",
  "safety_alert",
  "driver_report",
  "incorrect_map_info",
  "other"
] as const;
export type CommunityReportCategory = (typeof COMMUNITY_REPORT_CATEGORIES)[number];
export type CommunityReportAction = "reviewed" | "hide" | "restore";
export type CommunityReport = {
  id: string;
  category: CommunityReportCategory;
  description: string;
  location_name: string;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  upvotes: number;
  downvotes: number;
  awaiting_admin_review: boolean;
  has_trip: boolean;
  author_id: string;
  trip_id: string | null;
  hidden_at: string | null;
  admin_reviewed_at?: string | null;
  flag_count?: number;
};
export type CommunityReportQuery = {
  pending?: boolean;
  category?: CommunityReportCategory;
  hidden?: boolean;
  page?: number;
  limit?: number;
};
export type CommunityReportPage = { reports: CommunityReport[] } & PageMeta;

export type AppRating = {
  user: { id: string; name: string; role: string };
  stars: number;
  feedback: string | null;
  created_at: string;
  updated_at: string;
};
export type AppRatingQuery = { stars?: number; from?: string; to?: string; page?: number; limit?: number };
export type AppRatingSummary = {
  count: number;
  average: number | null;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
};
export type AppRatingPage = { ratings: AppRating[]; summary: AppRatingSummary } & PageMeta;

export const MAP_PLACE_CATEGORIES = ["cafe", "restaurant", "fuel", "pharmacy", "hospital", "clinic", "supermarket", "atm", "mosque", "car_repair", "rest_stop", "ev_charging"] as const;
export type MapPlace = {
  id: string;
  category: string;
  name_ar: string | null;
  name_en: string | null;
  latitude: number;
  longitude: number;
  phone: string | null;
  opening_hours: string | null;
  city: string | null;
  source: string;
  osm_id: string | null;
  active: boolean;
  admin_edited: boolean;
  created_at: string;
  updated_at: string;
};
export type MapPlaceQuery = { search?: string; category?: string; active?: "true" | "false"; page?: number; limit?: number };
export type MapPlacePage = { places: MapPlace[] } & PageMeta;
export type MapPlaceDraft = {
  category: string;
  name_ar?: string | null;
  name_en?: string | null;
  latitude: number;
  longitude: number;
  phone?: string | null;
  opening_hours?: string | null;
};
export type MapPlaceUpdate = Partial<MapPlaceDraft & { active: boolean }>;
export type MapPlaceSummary = { by_category: Record<string, { active: number; inactive: number }>; by_city: Record<string, number> };
export type MapPlaceReport = { id: string; reason: string; note: string | null; status: string; created_at: string; resolved_at: string | null; place: MapPlace };
export type MapPlaceReportPage = { reports: MapPlaceReport[] } & PageMeta;

export const CHECKPOINT_CONFIDENCES = ["high", "medium", "low", "unverified"] as const;
export type CheckpointConfidence = (typeof CHECKPOINT_CONFIDENCES)[number];
export type CheckpointPosition = {
  id: string;
  city_ar: string;
  name_ar: string;
  latitude: number;
  longitude: number;
  confidence: CheckpointConfidence;
  source: string;
  dataset_name: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};
export type CheckpointPositionDraft = {
  city_ar: string;
  name_ar: string;
  latitude: number;
  longitude: number;
  confidence: CheckpointConfidence;
  source: string;
  note?: string | null;
};
export type CheckpointPositionUpdate = Partial<Pick<CheckpointPosition, "latitude" | "longitude" | "confidence" | "note">>;
export type CheckpointPositionPage = { positions: CheckpointPosition[] } & PageMeta;
export type UnplacedCheckpointsResponse = {
  available: boolean;
  fetched_at?: string;
  unplaced: Array<{ id: string; city_ar: string; name_ar: string; reason: "no_name_match" | "ambiguous" | "outside_city" }>;
};

export type DriverRoute = {
  id: string;
  driver_id?: string;
  status: string;
  origin_label: string;
  destination_label: string;
  seats_available: number;
  parcel_capacity_available: number;
  driver?: { user?: User; trust_score?: number; verified?: boolean };
};

/** A city a route starts or ends at (a `Stop` row whose coordinates are the city centre). */
export type OperatingCity = { id: string; name_ar: string; name_en: string; latitude: number; longitude: number };
export type OperatingCityDraft = Omit<OperatingCity, "id">;
/** `POST /admin/cities` returns the new city; accept it bare or wrapped. */
export type OperatingCityCreateResponse = Partial<OperatingCity> & { city?: OperatingCity };
export type OperatingRoute = {
  id: string;
  route_key: string;
  name_ar: string;
  name_en: string;
  origin: OperatingCity;
  destination: OperatingCity;
};
export type FareRangeView = { min_minor: number; max_minor: number } | null;
/** A route's current prices as the operating-routes list returns them; null when none is set. */
export type OperatingRouteFares = {
  currency: string;
  passenger_seat_minor: number | null;
  parcel_minor: { S: number | null; M: number | null; L: number | null };
  driver_price_range?: {
    passenger_seat: FareRangeView;
    parcel: { S: FareRangeView; M: FareRangeView; L: FareRangeView };
  };
} | null;
export type AdminOperatingRoute = OperatingRoute & { active: boolean; orders_count: number; fares?: OperatingRouteFares };
export type OperatingRouteDraft = { origin_city_id: string; destination_city_id: string; both_directions: boolean };
/** The contract does not pin the success body, so the console reloads the list instead of reading it. */
export type OperatingRouteCreateResponse = { route?: AdminOperatingRoute; routes?: AdminOperatingRoute[] };

/**
 * Route-based order fields (docs/routes/route-based-orders.md). Optional and
 * nullable: older API builds omit them and rows created before routes have null.
 */
export type OrderRouteFields = {
  service_route_id?: string | null;
  route_name_ar?: string | null;
  route_name_en?: string | null;
  /** The village / town picked from the route's city list; null for older free-text orders. */
  pickup_place_name_ar?: string | null;
  pickup_place_name_en?: string | null;
  dropoff_place_name_ar?: string | null;
  dropoff_place_name_en?: string | null;
};

/** A named village or town riders and senders pick as pickup / drop-off inside a city. */
export type CityPlace = {
  id: string;
  city_key: string;
  name_ar: string;
  name_en: string;
  latitude: number;
  longitude: number;
  /** True for a village-centre point from a map extract; false once an admin set or moved it. */
  approximate: boolean;
  source: string;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};
export type CityPlaceCity = { city_key: string; name_ar: string; name_en: string; places_total: number; places_active: number };
export type CityPlaceDraft = { city_key: string; name_ar: string; name_en: string; latitude: number; longitude: number };
export type CityPlaceUpdate = Partial<{ name_ar: string; name_en: string; latitude: number; longitude: number; active: boolean; sort_order: number }>;

/** The reasons an Admin can give when cancelling (the API's `admin` list). */
export const ADMIN_CANCELLATION_REASONS = ["customer_request", "driver_unavailable", "safety_concern", "duplicate", "policy_violation", "other"] as const;
export type AdminCancellationReason = (typeof ADMIN_CANCELLATION_REASONS)[number];
export type CancellationBody = { reason: AdminCancellationReason; note?: string };
export type CancellationKind = "automatic" | "manual";
export type CancellationRole = "system" | "passenger" | "merchant" | "driver" | "admin";
export type CancellationOutcome = "cancelled" | "requeued" | "removed";
export type CancellationOrderType = "ride" | "merchant_order" | "parcel";
export type CancellationRecord = {
  id: string;
  created_at: string;
  kind: CancellationKind;
  by_role: CancellationRole;
  by: { id: string; name: string } | null;
  reason: string;
  note: string | null;
  outcome: CancellationOutcome;
  trip_id: string | null;
  order: { type: CancellationOrderType; id: string; status: string; owner: { id: string; name: string } } | null;
};
export type CancellationPage = { cancellations: CancellationRecord[]; next_cursor: string | null; reasons: Record<string, string[]> };
export type CancellationQuery = {
  from?: string;
  to?: string;
  kind?: CancellationKind;
  role?: CancellationRole;
  reason?: string;
  cursor?: string;
  limit?: number;
};

export type PassengerRequest = OrderRouteFields & {
  id: string;
  status: string;
  pickup_label: string;
  destination_label: string;
  passenger_count: number;
  passenger?: User;
  pickup_details?: string | null;
  dropoff_details?: string | null;
};

export type PassengerParcelTrackingState =
  | "searching"
  | "assigned"
  | "picked_up"
  | "in_transit"
  | "delivered"
  | "cancelled"
  | "failed"
  | "expired";

/** Receiver details are deliberately absent from this shape. */
export type PassengerParcelRow = OrderRouteFields & {
  pickup_details?: string | null;
  dropoff_details?: string | null;
  id: string;
  sender: { id: string; name: string };
  size: string;
  pickup_label: string;
  dropoff_label: string | null;
  tracking_state: PassengerParcelTrackingState;
  dispatch_status: string | null;
  requested_departure_from: string | null;
  requested_departure_until: string | null;
  created_at: string;
};

export type MerchantOrder = OrderRouteFields & {
  id: string;
  status: string;
  pickup_label: string;
  pickup_details?: string | null;
  merchant?: User;
  parcels?: Array<{ id: string; status: string; destination_label: string; size: string; priority: string; dropoff_details?: string | null }>;
};

export type Match = {
  id: string;
  status: string;
  score: string;
  method: string;
  explanation: string;
  driver_route_id: string;
  passenger_request_id?: string;
  merchant_order_id?: string;
  driver_route?: DriverRoute;
};

export type MatchRunResponse = { match: Match; scoringBreakdown: Record<string, number>; candidatesConsidered: number };
export type BatchResponse = { batch: { id: string; status: string; estimated_distance_saved: string; explanation: string; merchant_order?: MerchantOrder } };
export type SimulationMethodKey = "manual" | "nearest" | "darb";
export type SimulationDistribution = { avg: number; median: number; p90: number };
export type SimulationMetrics = {
  requests: number;
  matched: number;
  unmatched: number;
  unmatchedPct: number;
  waitingMin: SimulationDistribution;
  matchingMin: SimulationDistribution;
  routeDeviationKm: number;
  routeDeviationKmPerMatched: number;
  vehiclesUsed: number;
  vehiclesTotal: number;
  vehicleUtilisationPct: number;
  seatUtilisationPct: number;
  parcelUtilisationPct: number;
};
export type ComparisonSimulation = {
  simulated: true;
  version: string;
  params: { seed: number; manualResponseDelayMin: number; nearestMatchDelayMin: number; darbOfferDelayMin: number; darbBatchWindowMin: number };
  aggregate: Record<SimulationMethodKey, SimulationMetrics>;
  scenarios: Array<{
    key: string;
    label: string;
    origin: "hand_written" | "generated";
    requests: number;
    passengerRequests: number;
    parcelOrders: number;
    drivers: number;
    methods: Record<SimulationMethodKey, SimulationMetrics>;
  }>;
};
export type Comparison = {
  id: string;
  winner: string;
  darb_trips: number;
  nearest_driver_trips: number;
  darb_estimated_distance: string;
  nearest_estimated_distance: string;
  darb_estimated_cost: string;
  nearest_estimated_cost: string;
  parcel_batching_benefit: string;
  driver_utilization: string;
};
export type Trip = { id: string; status: string; driver_route_id: string; passenger_request_id?: string; merchant_order_id?: string; created_at?: string };
export type LocationEvent = { id: string; lat: string; lng: string; source: string; sequence: number; recorded_at: string };

export type TripStatus = "created" | "accepted" | "pickup_started" | "picked_up" | "in_transit" | "delivered" | "completed" | "cancelled" | "failed";
export type AdminForwardTripStatus = "pickup_started" | "picked_up" | "in_transit" | "delivered" | "completed";
export type AdminTripKind = "legacy" | "canonical" | "shared";
export type AdminTripPerson = { id: string; name: string; phone: string; demo_account: boolean };
export type AdminTripManifestMember = {
  id: string;
  demand_type: string;
  member_status: string;
  member_sequence: number;
  passenger_seats: number;
  parcel_units: number;
  passenger_request: { id: string; passenger_count: number; passenger: AdminTripPerson } | null;
  merchant_order: { id: string; merchant: AdminTripPerson; _count: { parcels: number } } | null;
};
export type AdminTripListItem = {
  id: string;
  kind: AdminTripKind;
  status: TripStatus;
  driver_id: string;
  driver_route_id: string;
  passenger_request_id: string | null;
  merchant_order_id: string | null;
  parcel_batch_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  operational_mode: string;
  canonical_trip_version: string | null;
  manifest_id: string | null;
  route_version_id: string | null;
  route_version: { id: string; version_number: number; status: string; name_ar: string; name_en: string } | null;
  driver_route: OrderRouteFields & {
    id: string;
    origin_label: string;
    destination_label: string;
    departure_at: string | null;
    driver: { id: string; vehicle_type: string; seats_total: number; parcel_capacity: number; verified: boolean; trust_score: number; user: AdminTripPerson };
  };
  passenger_request: (OrderRouteFields & {
    id: string;
    pickup_label: string;
    destination_label: string;
    passenger_count: number;
    passenger: AdminTripPerson;
    pickup_details?: string | null;
    dropoff_details?: string | null;
  }) | null;
  merchant_order: (OrderRouteFields & {
    id: string;
    pickup_label: string;
    pickup_details?: string | null;
    merchant: AdminTripPerson;
    _count: { parcels: number };
  }) | null;
  parcel_batch: { id: string; status: string } | null;
  canonical_manifest: {
    id: string;
    lifecycle_status: string;
    member_count: number;
    passenger_request_count: number;
    passenger_seat_count: number;
    merchant_order_count: number;
    parcel_unit_count: number;
    members?: AdminTripManifestMember[];
  } | null;
  _count: { location_events: number };
  has_stored_location: boolean;
  demo_context: boolean;
  supported_admin_transition: AdminForwardTripStatus | null;
  delivery_confirmation?: AdminTripDeliveryConfirmation | null;
};
export type AdminTripDeliveryConfirmation = {
  required: boolean;
  total_orders: number;
  confirmed_orders: number;
  methods: Array<"receiver_code" | "receiver_unavailable" | "admin_override">;
  flagged: boolean;
  reasons: string[];
};
export type AdminTripDetail = AdminTripListItem & {
  latest_stored_location: {
    lat: string;
    lng: string;
    source: string;
    sequence: number;
    recorded_at: string;
  } | null;
};
export type AdminTripPage = { trips: AdminTripListItem[]; page: number; limit: number; total: number };

export type CanonicalStop = {
  id: string;
  stop_key: string;
  service_region_key: string;
  name_ar: string;
  name_en: string;
  latitude: number;
  longitude: number;
  status: "active" | "retired";
};
export type CanonicalStopDraft = Omit<CanonicalStop, "id" | "status">;
export type RouteStopDraft = {
  stop_id: string;
  sequence: number;
  passenger_pickup_allowed: boolean;
  passenger_dropoff_allowed: boolean;
  parcel_pickup_allowed: boolean;
  parcel_dropoff_allowed: boolean;
  estimated_offset_seconds?: number | null;
  dwell_seconds?: number | null;
};
export type RouteVersionStop = RouteStopDraft & { id: string; stop: CanonicalStop };
export type ServiceRouteVersion = {
  id: string;
  service_route_id: string;
  version_number: number;
  status: "draft" | "published" | "paused" | "retired";
  name_ar: string;
  name_en: string;
  description_ar: string | null;
  description_en: string | null;
  active_from: string | null;
  active_until: string | null;
  draft_revision: number;
  stop_count: number;
  stops: RouteVersionStop[];
  geometry: { status: "pending" | "available" | "unavailable"; ready: boolean };
};
export type RouteVersionDraft = {
  name_ar: string;
  name_en: string;
  description_ar?: string | null;
  description_en?: string | null;
  active_from?: string | null;
  active_until?: string | null;
};
export type RouteIdentityDraft = {
  route_key: string;
  route_group_key: string;
  service_region_key: string;
  direction: "outbound" | "inbound" | "loop";
};
export type ServiceRoute = RouteIdentityDraft & {
  id: string;
  status: "active" | "retired";
  current_version_id: string | null;
  current_version: ServiceRouteVersion | null;
  versions?: ServiceRouteVersion[];
  version_count: number;
  created_at: string;
  updated_at: string;
};
export type IncidentStatus = "open" | "reviewing" | "resolved";
export type IncidentRecord = {
  id: string;
  trip_id: string | null;
  category: string;
  description: string;
  status: IncidentStatus;
  admin_note: string | null;
  revision: number;
  reviewed_at: string | null;
  resolved_at: string | null;
  created_at: string;
  reporter?: { id: string; name: string; role: string };
};
export type IncidentPage = { incidents: IncidentRecord[]; page: number; limit: number; total: number; open_total: number };
export type UncertainAiStatus = "open" | "resolved";
export type UncertainAiRecord = {
  id: string;
  locale: string;
  text: string;
  intent_type: string;
  confidence: number;
  source: string;
  reason: string;
  pickup_key: string | null;
  dropoff_key: string | null;
  status: UncertainAiStatus;
  resolution_note: string | null;
  resolved_at: string | null;
  revision: number;
  created_at: string;
  expires_at: string;
};
export type UncertainAiPage = { requests: UncertainAiRecord[]; page: number; limit: number; total: number; open_total: number };
export type ReportRange = { from?: string; to?: string };
export type SuccessMetricKey = "matching_time" | "ai_understanding" | "status_continuity" | "batch_efficiency" | "driver_utilization" | "user_satisfaction" | "driver_verification" | "pickup_clarity" | "route_deviation";
export type SuccessMetric = {
  key: SuccessMetricKey;
  unit: "seconds" | "percent" | "ratio" | "score";
  target: string;
  value: number | null;
  status: "pass" | "fail" | "no_data";
  sample_size: number;
  previous_value: number | null;
  trend: "improving" | "worsening" | "flat" | "none";
};
export type SuccessMetricsResponse = { range: { from: string; to: string }; generated_at: string; metrics: SuccessMetric[] };
export type ReportDataset = "requests" | "orders" | "trips";
type StatusCounts = Record<string, number>;
export type ReportSummary = {
  range: { from: string | null; to: string | null };
  generated_at: string;
  passenger_requests: { total: number; by_status: StatusCounts };
  merchant_orders: { total: number; by_status: StatusCounts; parcels: number };
  trips: { total: number; by_status: StatusCounts };
  matches: { total: number; by_status: StatusCounts };
  drivers: { total: number; verified: number; pending_verification: number };
};
export type RouteFareItem = "passenger_seat" | "parcel_s" | "parcel_m" | "parcel_l";
/** A fare in force: the default and the range a driver may choose within (both null: fixed). */
export type RouteFareCurrent = {
  fare_id: string;
  amount_minor: number;
  min_minor?: number | null;
  max_minor?: number | null;
  currency: string;
  effective_from: string;
} | null;
export type RouteFareHistoryRow = {
  id: string;
  item: RouteFareItem;
  amount_minor: number | null;
  min_minor?: number | null;
  max_minor?: number | null;
  currency: string;
  effective_from: string;
  reason: string | null;
  created_at: string;
  created_by: { id: string; name: string } | null;
};
export type RouteFaresResponse = {
  route_id: string;
  currency: string;
  display_only: true;
  current: Record<RouteFareItem, RouteFareCurrent>;
  history: RouteFareHistoryRow[];
  server_now: string;
};
export type RouteFaresUpdate = {
  changes: Array<{ item: RouteFareItem; amount_minor: number | null; min_minor?: number | null; max_minor?: number | null }>;
  effective_from?: string;
  reason: string;
};
export type RoutePage = { routes: ServiceRoute[]; page: number; limit: number; total: number };
export type StopPage = { stops: CanonicalStop[]; page: number; limit: number; total: number };
