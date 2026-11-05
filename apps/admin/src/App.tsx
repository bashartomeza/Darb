import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createApiClient, createDemoApiClient, type AccountStatus, type DashboardResponse, type DriverRoute, type Trip, type User, type UserAccountStatus } from "./api";
import { demoUiEnabled, getAdminBuildConfig, routeManagementUiEnabled, type AdminBuildConfig } from "./config";
import { useLocale } from "./i18n/LocaleContext";
import type { TranslationKey } from "./i18n/translations";
import { createAdminSessionExpiryHandler, isAdminSessionEndError, newAdminSessionHandle, purgeStoredAdminTokens, type TokenStorage } from "./session";
import { RouteManagement } from "./features/routes/RouteManagement";
import { OperatingRoutesPage } from "./features/operatingRoutes/OperatingRoutesPage";
import { OverviewDashboard, type OverviewData } from "./features/overview/OverviewDashboard";
import {
  OVERVIEW_RESOURCE_KEYS,
  beginOverviewRefresh,
  completeOverviewRefresh,
  createInitialOverviewResourceStates,
  loadOverviewResources,
  summarizeOverviewResults
} from "./features/overview/overviewState";
import { RequestsBoard } from "./features/requests/RequestsBoard";
import { PassengerParcelsPanel } from "./features/requests/PassengerParcelsPanel";
import { TripsManagement } from "./features/trips/TripsManagement";
import { MatchingBatchingMonitoring } from "./features/monitoring/MatchingBatchingMonitoring";
import { InvitationsPage } from "./features/invitations/InvitationsPage";
import { SettingsPanel } from "./features/settings/SettingsPanel";
import { DriversPage } from "./features/verification/DriversPage";
import { UsersDirectory } from "./features/users/UsersDirectory";
import { DemoControl } from "./features/demo/DemoControl";
import { ModuleUnavailable } from "./features/placeholder/ModuleUnavailable";
import { ReportsPanel } from "./features/reports/ReportsPanel";
import { SuccessMetricsPanel } from "./features/reports/SuccessMetricsPanel";
import { AppRatingsPage } from "./features/ratings/AppRatingsPage";
import { IncidentsPanel } from "./features/incidents/IncidentsPanel";
import { UncertainAiRequests } from "./features/incidents/UncertainAiRequests";
import { CommunityReportsPage } from "./features/communityReports/CommunityReportsPage";
import { CheckpointPositionsPage } from "./features/checkpoints/CheckpointPositionsPage";
import { ProfilePanel } from "./features/profile/ProfilePanel";
import {
  hashForModule,
  moduleFromHash,
  navItemForModule,
  resolveActiveModule,
  visibleNavItems,
  type AdminRouteId
} from "./navigation";
import { AppShell, Button, Notice, SideNav, TopBar } from "./ui";
import { GoogleAdminSignIn } from "./GoogleAdminSignIn";

export { ADMIN_TOKEN_KEY, purgeStoredAdminTokens } from "./session";

type NoticeState = { type: "success" | "error"; message: string } | null;
type DemoStep = { key: TranslationKey; statusValue?: string };

function getErrorMessage(error: unknown, t: (key: TranslationKey) => string) {
  if (!(error instanceof Error)) return t("unexpectedError");
  if (["invalid_credentials", "email_verification_required", "account_unavailable"].includes(error.message)) return t("authFailed");
  if (error.message === "Failed to fetch") return t("failedToFetch");
  if (error.message === "forbidden" || error.message === "unauthorized") return t("unauthorized");
  if (error.message === "demo_reset_database_not_allowed" || error.message === "demo_reset_real_data_present") {
    return t("demoResetUnavailable");
  }
  return error.message || t("unexpectedError");
}

export function App({
  config = getAdminBuildConfig(),
  sessionStore = window.sessionStorage,
  legacyStore = window.localStorage
}: {
  config?: AdminBuildConfig;
  /** Browser stores where older builds kept a bearer token; they are only purged. */
  sessionStore?: TokenStorage;
  legacyStore?: TokenStorage;
} = {}) {
  const { direction, locale, toggleLocale, t, status } = useLocale();
  const demoEnabled = demoUiEnabled(config, __DARB_DEMO_BUILD__);
  const routeManagementEnabled = routeManagementUiEnabled(config);
  // `token` is the in-memory handle of the current sign-in, never a credential:
  // the API authenticates the HttpOnly session cookie. The ref mirrors it for
  // callbacks that outlive a render.
  const [token, setToken] = useState(() => {
    purgeStoredAdminTokens(sessionStore, legacyStore);
    return "";
  });
  const sessionRef = useRef("");
  function setSession(handle: string) {
    sessionRef.current = handle;
    setToken(handle);
  }
  const [restoring, setRestoring] = useState(true);
  const [admin, setAdmin] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const authAttempt = useRef(0);
  useEffect(() => () => { authAttempt.current += 1; }, []);
  const [password, setPassword] = useState(demoEnabled ? config.demo?.adminPassword ?? "" : "");
  const [resetKey, setResetKey] = useState(demoEnabled ? config.demo?.resetKey ?? "" : "");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeState>(null);

  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [routes, setRoutes] = useState<DriverRoute[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [overviewResources, setOverviewResources] = useState(createInitialOverviewResourceStates);
  const overviewRefreshRef = useRef<{
    token: string;
    promise: Promise<{ succeeded: number; failed: number }>;
  } | null>(null);
  const [demoSteps, setDemoSteps] = useState<DemoStep[]>([]);
  const [demoResetAvailable, setDemoResetAvailable] = useState(false);
  const [activeModule, setActiveModule] = useState<AdminRouteId>(() => moduleFromHash(window.location.hash));
  const [search, setSearch] = useState("");

  const flags = { demoEnabled, routeManagementEnabled };
  const navItems = visibleNavItems(flags);
  const currentModule = resolveActiveModule(activeModule, flags);

  function clearAuthenticatedData() {
    setBusy(null);
    setAdmin(null);
    setDashboard(null);
    setRoutes([]);
    setTrips([]);
    setOverviewResources(createInitialOverviewResourceStates());
    setDemoSteps([]);
    setDemoResetAvailable(false);
  }

  const sessionExpiry = useMemo(
    () => createAdminSessionExpiryHandler({
      currentSession: () => sessionRef.current,
      onExpired: () => {
        authAttempt.current += 1;
        setSession("");
        clearAuthenticatedData();
        setNotice({ type: "error", message: t("sessionExpired") });
      }
    }),
    [t]
  );
  const api = useMemo(
    () => createApiClient(config.apiBaseUrl, { onSessionEnded: sessionExpiry.handle }),
    [config.apiBaseUrl, sessionExpiry]
  );
  useEffect(() => {
    let mounted = true;
    api.authCapabilities().then((capabilities) => {
      if (mounted) setGoogleClientId(capabilities.google_admin_login_available && capabilities.google_admin_client_id ? capabilities.google_admin_client_id : null);
    }).catch(() => { if (mounted) setGoogleClientId(null); });
    return () => { mounted = false; };
  }, [api]);
  useEffect(() => {
    // A reload keeps the staff member signed in while the cookie session is
    // alive. Without one the sign-in screen shows, with no expiry notice. A
    // sign-in started meanwhile wins over this check.
    const attempt = authAttempt.current;
    api.currentSession()
      .then((result) => {
        if (attempt !== authAttempt.current || result?.user?.role !== "admin") return;
        sessionExpiry.reset();
        setSession(newAdminSessionHandle());
        setAdmin(result.user);
      })
      .catch(() => undefined)
      .finally(() => setRestoring(false));
  }, []);
  const demoApi = useMemo(
    () => createDemoApiClient(config.apiBaseUrl, { onSessionEnded: sessionExpiry.handle }),
    [config.apiBaseUrl, sessionExpiry]
  );

  const canAct = Boolean(token) && !busy;

  async function runAction<T>(label: string, action: () => Promise<T>, success?: string) {
    setBusy(label);
    setNotice(null);
    try {
      const result = await action();
      if (success) setNotice({ type: "success", message: success });
      return result;
    } catch (error) {
      if (token && isAdminSessionEndError(error)) return null;
      setNotice({ type: "error", message: getErrorMessage(error, t) });
      return null;
    } finally {
      setBusy(null);
    }
  }

  function refreshOverview(currentToken = token): Promise<{ succeeded: number; failed: number }> {
    if (!currentToken) return Promise.resolve({ succeeded: 0, failed: 0 });
    if (overviewRefreshRef.current?.token === currentToken) return overviewRefreshRef.current.promise;

    const promise = (async () => {
      setOverviewResources((current) => beginOverviewRefresh(current));
      const results = await loadOverviewResources({
        dashboard: () => api.dashboard(currentToken),
        routes: () => api.routes(currentToken),
        trips: () => api.trips(currentToken)
      });

      if (results.dashboard.status === "fulfilled") setDashboard(results.dashboard.value);
      if (results.routes.status === "fulfilled") setRoutes(results.routes.value.routes);
      if (results.trips.status === "fulfilled") setTrips(results.trips.value.trips);

      for (const key of OVERVIEW_RESOURCE_KEYS) {
        const result = results[key];
        if (result.status === "rejected") console.error(`[admin overview] ${key} request failed`, result.reason);
      }
      setOverviewResources((current) => completeOverviewRefresh(current, results));
      return summarizeOverviewResults(results);
    })();

    overviewRefreshRef.current = { token: currentToken, promise };
    void promise.finally(() => {
      if (overviewRefreshRef.current?.promise === promise) overviewRefreshRef.current = null;
    });
    return promise;
  }

  /**
   * Suspend, disable or reactivate an account.
   *
   * The API revokes the target's sessions and may reject the change (the last
   * active admin cannot be suspended), so the caller reloads its list to show
   * what the server actually decided.
   */
  async function updateUserStatus(userId: string, status: AccountStatus, reason: string | undefined, expectedStatus: UserAccountStatus) {
    const result = await runAction(
      "user-status",
      () => api.updateUserStatus(token, userId, status, reason, expectedStatus),
      t("accountStatusUpdated")
    );
    if (result) void refreshOverview();
    return Boolean(result);
  }

  async function refreshData() {
    const summary = await runAction("refresh", () => refreshOverview());
    if (!summary) return;
    if (summary.failed === 0) setNotice({ type: "success", message: t("dataRefreshed") });
    else if (summary.succeeded === 0) setNotice({ type: "error", message: t("overviewLoadFailed") });
    else setNotice({ type: "error", message: t("overviewPartialLoad") });
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    const attempt = ++authAttempt.current;
    setBusy("login"); setNotice(null);
    try {
      const result = await api.login(email, password);
      if (attempt !== authAttempt.current) return;
      setNotice({ type: "success", message: t("adminLoggedIn") });
      await acceptLogin(attempt, result);
    } catch (error) {
      if (attempt === authAttempt.current) setNotice({ type: "error", message: getErrorMessage(error, t) });
    } finally {
      if (attempt === authAttempt.current) setBusy(null);
    }
  }

  async function acceptLogin(attempt: number, result: Awaited<ReturnType<typeof api.login>>) {
    if (attempt !== authAttempt.current) return false;
    sessionExpiry.reset();
    const session = newAdminSessionHandle();
    setSession(session);
    setAdmin(result.user);
    const capabilities = await api.capabilities(session).catch(() => ({ demo_reset_available: false }));
    if (attempt !== authAttempt.current) return false;
    setDemoResetAvailable(capabilities.demo_reset_available === true);
    await refreshOverview(session);
    return true;
  }

  function signOut() {
    // Best effort: start revoking the server session (and clearing its cookie)
    // first, but never let a slow or failed request keep this browser signed in.
    const signedIn = sessionRef.current || token;
    if (signedIn) void api.logout(signedIn).catch(() => undefined);
    authAttempt.current += 1;
    purgeStoredAdminTokens(sessionStore, legacyStore);
    sessionExpiry.reset();
    clearAuthenticatedData();
    setNotice(null);
    setSession("");
  }

  async function loadMe(currentToken = token) {
    const result = await runAction("me", () => api.me(currentToken), t("sessionLoaded"));
    if (result) setAdmin(result.user);
    return result !== null;
  }

  async function resetDemo() {
    if (!demoApi || !demoResetAvailable) return;
    const attempt = ++authAttempt.current;
    const result = await runAction("reset", () => demoApi.reset(token || undefined, resetKey), t("demoDataReset"));
    if (!result) return;
    const signedIn = await api.login(email, password);
    if (attempt !== authAttempt.current) return;
    sessionExpiry.reset();
    const session = newAdminSessionHandle();
    setSession(session);
    setAdmin(signedIn.user);
    setDemoSteps([]);
    await refreshOverview(session);
  }

  async function runFullDemoSequence() {
    if (!demoApi || !demoResetAvailable) return;
    const attempt = ++authAttempt.current;
    await runAction("full-demo", async () => {
      const steps: DemoStep[] = [];
      const mark = (key: TranslationKey, statusValue?: string) => {
        steps.push({ key, statusValue });
        setDemoSteps([...steps]);
      };

      mark("stepReset");
      await demoApi.reset(token || undefined, resetKey);
      mark("stepLogin");
      const signedIn = await api.login(email, password);
      if (attempt !== authAttempt.current) return;
      sessionExpiry.reset();
      const currentToken = newAdminSessionHandle();
      setSession(currentToken);
      setAdmin(signedIn.user);
      mark("stepLoadInputs");
      const overview = await Promise.all([api.requests(currentToken), api.orders(currentToken)]);
      const request = overview[0].requests[0];
      const order = overview[1].orders[0];
      if (!request || !order) throw new Error(t("seededInputsMissingAfterReset"));
      mark("stepCreateBatch");
      await demoApi.batchOrder(currentToken, order.id);
      mark("stepRunMatch");
      const match = await demoApi.runMatch(currentToken, request.id, order.id);
      mark("stepRunComparison");
      await demoApi.runComparison(currentToken, request.id, order.id);
      mark("stepAcceptTrip");
      const accepted = await demoApi.acceptMatch(currentToken, match.match.id);
      let trip = accepted.trip;
      for (const status of ["pickup_started", "picked_up", "in_transit", "delivered", "completed"]) {
        mark("stepAdvanceTrip", status);
        trip = (await demoApi.updateTripStatus(currentToken, trip.id, status)).trip;
      }
      mark("stepRecordTracking");
      await demoApi.simulateStep(currentToken, trip.id);
      await refreshOverview(currentToken);
      mark("stepDemoComplete");
    }, t("fullDemoCompleted"));
  }

  useEffect(() => {
    if (!token) return;
    void loadMe(token).then(() => {
      // A transient /me failure must not leave the overview in permanent
      // skeleton state. Terminal session failures end the current sign-in, so
      // only a still-current Admin session proceeds with independent loads.
      if (sessionRef.current === token) {
        void api.capabilities(token)
          .then((capabilities) => setDemoResetAvailable(capabilities.demo_reset_available === true))
          .catch(() => setDemoResetAvailable(false));
        void refreshOverview(token);
      }
    });
  }, [token]);

  useEffect(() => {
    const syncModuleFromUrl = () => setActiveModule(moduleFromHash(window.location.hash));
    window.addEventListener("hashchange", syncModuleFromUrl);
    if (!window.location.hash) window.history.replaceState(null, "", hashForModule(activeModule));
    return () => window.removeEventListener("hashchange", syncModuleFromUrl);
  }, []);

  function navigateToModule(id: AdminRouteId) {
    setActiveModule(id);
    setNotice(null);
    const nextHash = hashForModule(id);
    if (window.location.hash !== nextHash) window.location.hash = nextHash.slice(1);
  }

  if (!token && restoring) {
    return (
      <main className="login-shell" dir={direction} lang={locale} aria-busy="true">
        <p className="login-card__description" role="status">{t("sessionRestoring")}</p>
      </main>
    );
  }

  if (!token) {
    return (
      <main className="login-shell" dir={direction} lang={locale}>
        <form className="login-card" onSubmit={login}>
          <div className="login-card__actions">
            <Button variant="ghost" size="sm" icon="language" onClick={() => { setNotice(null); toggleLocale(); }}>
              {t("languageSwitch")}
            </Button>
          </div>
          <div className="login-card__brand">
            <div>
              <img className="login-card__logo" src="/darb-logo.png" width={550} height={228} alt={t("brandName")} />
              <p className="sidenav__brand-subtitle">{t("appName")}</p>
            </div>
          </div>
          <h1>{t("loginHeading")}</h1>
          <p className="login-card__description">{t("loginDescription", { apiBaseUrl: config.apiBaseUrl })}</p>
          {demoEnabled && <p className="login-card__hint technical">{t("demoCredentials")}</p>}
          <label className="field">{t("adminEmail")}<input className="technical" type="email" dir="ltr" autoComplete="username" required maxLength={191} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="field">{t("password")}<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button className="btn btn--primary" disabled={busy === "login"}>{busy === "login" ? t("signingIn") : t("signIn")}</button>
          {googleClientId && <GoogleAdminSignIn clientId={googleClientId} onCredential={async (credential) => {
            const attempt = ++authAttempt.current;
            setBusy(null); setNotice(null);
            try {
              const result = await api.googleLogin(credential);
              return await acceptLogin(attempt, result);
            } catch (error) {
              if (attempt !== authAttempt.current) return false;
              throw error;
            }
          }} />}
          {notice && <Notice kind={notice.type}>{notice.message}</Notice>}
        </form>
      </main>
    );
  }

  const overviewData: OverviewData = { dashboard, routes, trips, resources: overviewResources };
  const overviewRefreshing = Object.values(overviewResources).some((resource) => resource.phase === "loading");
  const activeNavId = navItemForModule(currentModule);
  const activeNavItem = navItems.find((item) => item.id === activeNavId);
  const moduleTitle = currentModule === "profile"
    ? t("navProfile")
    : activeNavItem
      ? t(activeNavItem.labelKey)
      : t("navOverview");

  function renderModule() {
    switch (currentModule) {
      case "overview":
        return (
          <>
            {demoEnabled && demoApi && (
              <DemoControl
                resetKey={resetKey}
                onResetKeyChange={setResetKey}
                steps={demoSteps.map((step) => t(step.key, step.statusValue ? { status: status(step.statusValue) } : {}))}
                canAct={canAct}
                resetAvailable={demoResetAvailable}
                busy={busy}
                onReset={() => void resetDemo()}
                onRefresh={() => void refreshData()}
                onRunFullDemo={() => void runFullDemoSequence()}
              />
            )}
            <OverviewDashboard
              data={overviewData}
              search={search}
              busy={Boolean(busy) || overviewRefreshing}
              onRefresh={() => void refreshData()}
            />
          </>
        );

      case "deliveries":
        return (
          <>
            <RequestsBoard api={api} token={token} search={search} />
            <PassengerParcelsPanel api={api} token={token} search={search} />
          </>
        );

      case "matchingBatching":
        return <MatchingBatchingMonitoring api={api} token={token} />;

      case "trips":
        return <TripsManagement api={api} token={token} search={search} canAct={canAct} />;

      case "routes":
        return (
          <OperatingRoutesPage
            api={api}
            token={token}
            search={search}
            advancedHref={routeManagementEnabled ? hashForModule("routeWorkspace") : null}
          />
        );

      // Hidden: the older versioned route editor, reachable only from the
      // Routes page when the build enables route management.
      case "routeWorkspace":
        return routeManagementEnabled ? (
          <RouteManagement api={api} token={token} locale={locale} />
        ) : (
          <ModuleUnavailable icon="edit_road" reason="no-api" />
        );

      case "checkpointPositions":
        return <CheckpointPositionsPage api={api} token={token} search={search} />;

      case "settings":
        return <SettingsPanel config={config} admin={admin} api={api} token={token} />;

      case "profile":
        return <ProfilePanel admin={admin} />;

      case "invitations":
        return <InvitationsPage api={api} token={token} />;

      case "users":
        return <UsersDirectory api={api} token={token} admin={admin} search={search} canAct={canAct} />;

      case "drivers":
        return (
          <DriversPage
            api={api}
            token={token}
            search={search}
            busy={Boolean(busy)}
            onUpdateStatus={updateUserStatus}
          />
        );

      case "incidentsSafety":
        return (
          <>
            <IncidentsPanel api={api} token={token} />
            <UncertainAiRequests api={api} token={token} />
          </>
        );

      case "communityReports":
        return <CommunityReportsPage api={api} token={token} />;

      case "reports":
        return (
          <>
            <ReportsPanel api={api} token={token} />
            <SuccessMetricsPanel api={api} token={token} />
          </>
        );

      case "appRatings":
        return <AppRatingsPage api={api} token={token} />;

      default:
        return null;
    }
  }

  const moduleDescription: Partial<Record<AdminRouteId, string>> = {
    overview: t("overviewDescription"),
    deliveries: t("requestsDescription"),
    matchingBatching: t("matchingDescription"),
    trips: t("tripsDescription"),
    routes: t("operatingRoutesDescription"),
    checkpointPositions: t("checkpointPositionsDescription"),
    users: t("usersDescription"),
    invitations: t("invitationsDescription"),
    drivers: t("verificationDescription"),
    reports: t("reportsDescription"),
    appRatings: t("appRatingsDescription"),
    incidentsSafety: t("incidentsDescription"),
    communityReports: t("communityReportsDescription"),
    settings: t("settingsDescription"),
    profile: t("profileDescription")
  };

  return (
    <div dir={direction} lang={locale}>
      <AppShell
        sidenav={
          <SideNav
            items={navItems}
            active={activeNavId}
            onSelect={navigateToModule}
            labels={{
              brand: t("brandName"),
              subtitle: t("adminConsoleSubtitle"),
              navigation: t("navigationLabel"),
              label: (item) => t(item.labelKey),
              groupLabel: (labelKey) => t(labelKey)
            }}
            footer={
              <>
                <Button
                  variant="ghost"
                  icon="account_circle"
                  className={currentModule === "profile" ? "is-active" : undefined}
                  aria-current={currentModule === "profile" ? "page" : undefined}
                  onClick={() => navigateToModule("profile")}
                >
                  {t("navProfile")}
                </Button>
                <Button variant="ghost" icon="language" onClick={() => { setNotice(null); toggleLocale(); }}>
                  {t("languageSwitch")}
                </Button>
                <Button
                  variant="ghost"
                  icon="logout"
                  className="btn--signout"
                  disabled={Boolean(busy)}
                  onClick={signOut}
                >
                  {t("logout")}
                </Button>
              </>
            }
          />
        }
        topbar={
          <TopBar
            title={moduleTitle}
            search={search}
            onSearch={setSearch}
            searchPlaceholder={t("searchPlaceholder")}
            searchLabel={t("searchLabel")}
            notificationsLabel={t("notificationsLabel")}
            notificationsTitle={t("notificationsTitle")}
            notificationsDescription={t("notificationsUnavailableDescription")}
            closeNotificationsLabel={t("closeNotifications")}
            user={{ name: admin?.name ?? "Admin", detail: admin?.phone ?? "" }}
          />
        }
      >
        {/* The module title already sits in the top bar, so the canvas shows only its description. */}
        {moduleDescription[currentModule] && <p className="muted">{moduleDescription[currentModule]}</p>}
        {notice && <Notice kind={notice.type}>{notice.message}</Notice>}
        {renderModule()}
      </AppShell>
    </div>
  );
}
