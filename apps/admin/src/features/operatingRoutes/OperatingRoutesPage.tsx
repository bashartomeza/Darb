import { useEffect, useMemo, useRef, useState } from "react";
import type { AdminOperatingRoute, ApiClient, OperatingCity, OperatingCityDraft, OperatingRouteDraft } from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import type { TranslationKey } from "../../i18n/translations";
import { BentoGrid, Button, Card, CardHeader, DataTable, EmptyState, Notice, RouteChip, Skeleton, StatusBadge, TechnicalValue, type Column } from "../../ui";
import { RouteDialog } from "../routes/RouteDialog";
import { AddCityDialog } from "./AddCityDialog";
import { AddRouteDialog } from "./AddRouteDialog";
import {
  cityCreateErrorKey,
  cityName,
  filterRoutes,
  routeCities,
  routeCreateErrorKey,
  routeName,
  type RouteStatusFilter
} from "./operatingRoutesModel";

export type OperatingRoutesApi = Pick<
  ApiClient,
  "operatingRoutes" | "createOperatingRoute" | "setOperatingRouteActive" | "operatingCities" | "createOperatingCity"
>;

type Props = {
  api: OperatingRoutesApi;
  token: string;
  search?: string;
  /** Link to the older, flag-gated route workspace (stops, fares, versions); hidden when null. */
  advancedHref?: string | null;
};

type PageNotice = { kind: "success" | "error"; message: string } | null;

/**
 * The routes passengers, merchants and drivers choose from: list them, turn
 * them on or off, and add routes and cities. Independent of the
 * `ROUTE_MANAGEMENT_ENABLED` workspace.
 */
export function OperatingRoutesPage({ api, token, search = "", advancedHref = null }: Props) {
  const { t, locale, number, direction } = useLocale();
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [routes, setRoutes] = useState<AdminOperatingRoute[]>([]);
  const [cities, setCities] = useState<OperatingCity[]>([]);
  const [citiesFailed, setCitiesFailed] = useState(false);
  const [cityFilter, setCityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<RouteStatusFilter>("all");
  const [dialog, setDialog] = useState<"route" | "city" | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<TranslationKey | null>(null);
  const [confirmOff, setConfirmOff] = useState<AdminOperatingRoute | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<PageNotice>(null);
  const mounted = useRef(true);
  const loadSequence = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function loadRoutes(quiet = false) {
    const request = ++loadSequence.current;
    if (!quiet) setPhase("loading");
    try {
      const result = await api.operatingRoutes(token);
      if (!mounted.current || request !== loadSequence.current) return;
      setRoutes(result.routes);
      setPhase("ready");
    } catch {
      if (!mounted.current || request !== loadSequence.current) return;
      if (!quiet) setPhase("error");
    }
  }

  async function loadCities() {
    try {
      const result = await api.operatingCities(token);
      if (!mounted.current) return;
      setCities(result.cities);
      setCitiesFailed(false);
    } catch {
      if (mounted.current) setCitiesFailed(true);
    }
  }

  useEffect(() => {
    if (!token) return;
    void loadRoutes();
    void loadCities();
  }, [api, token]);

  const visibleRoutes = useMemo(
    () => filterRoutes(routes, { search, cityId: cityFilter, status: statusFilter }),
    [routes, search, cityFilter, statusFilter]
  );
  const filterCities = useMemo(() => routeCities(routes, cities, locale), [routes, cities, locale]);
  const activeCount = routes.filter((route) => route.active).length;

  async function setActive(route: AdminOperatingRoute, active: boolean) {
    setPendingId(route.id);
    setNotice(null);
    const name = routeName(route, locale);
    try {
      await api.setOperatingRouteActive(token, route.id, active);
      if (!mounted.current) return;
      setRoutes((current) => current.map((row) => (row.id === route.id ? { ...row, active } : row)));
      setNotice({ kind: "success", message: t(active ? "opRoutesTurnedOn" : "opRoutesTurnedOff", { name }) });
    } catch {
      if (!mounted.current) return;
      setNotice({ kind: "error", message: t("opRoutesToggleFailed") });
    } finally {
      if (mounted.current) {
        setPendingId(null);
        setConfirmOff(null);
      }
    }
    void loadRoutes(true);
  }

  function requestToggle(route: AdminOperatingRoute) {
    if (route.active) setConfirmOff(route);
    else void setActive(route, true);
  }

  function openDialog(kind: "route" | "city") {
    setDialogError(null);
    setNotice(null);
    setDialog(kind);
  }

  function closeDialog() {
    if (dialogBusy) return;
    setDialog(null);
    setDialogError(null);
  }

  async function createRoute(draft: OperatingRouteDraft) {
    setDialogBusy(true);
    setDialogError(null);
    try {
      await api.createOperatingRoute(token, draft);
      if (!mounted.current) return;
      setDialog(null);
      setNotice({ kind: "success", message: t(draft.both_directions ? "opRoutesCreatedBoth" : "opRoutesCreated") });
      await loadRoutes(true);
    } catch (error) {
      if (!mounted.current) return;
      setDialogError(routeCreateErrorKey(error));
      // A 409 means the list is out of date; refresh it behind the dialog.
      void loadRoutes(true);
    } finally {
      if (mounted.current) setDialogBusy(false);
    }
  }

  async function createCity(draft: OperatingCityDraft) {
    setDialogBusy(true);
    setDialogError(null);
    try {
      const created = await api.createOperatingCity(token, draft);
      if (!mounted.current) return;
      const city = created?.city ?? (created?.id ? (created as OperatingCity) : null);
      if (city) setCities((current) => (current.some((row) => row.id === city.id) ? current : [...current, city]));
      setDialog(null);
      setNotice({ kind: "success", message: t("opCityCreated", { name: cityName(draft, locale) }) });
      await loadCities();
    } catch (error) {
      if (mounted.current) setDialogError(cityCreateErrorKey(error));
    } finally {
      if (mounted.current) setDialogBusy(false);
    }
  }

  const columns: Column<AdminOperatingRoute>[] = [
    {
      key: "name",
      header: t("opRoutesColumnName"),
      cell: (route) => (
        <div>
          <p className="cell-stack__title">{routeName(route, locale)}</p>
          <p className="cell-stack__sub"><TechnicalValue>{route.route_key}</TechnicalValue></p>
        </div>
      )
    },
    {
      key: "path",
      header: t("opRoutesColumnPath"),
      cell: (route) => <RouteChip from={cityName(route.origin, locale)} to={cityName(route.destination, locale)} />
    },
    {
      key: "status",
      header: t("opRoutesColumnStatus"),
      cell: (route) => (
        <StatusBadge tone={route.active ? "success" : "neutral"} icon={route.active ? "check_circle" : "block"}>
          {t(route.active ? "opRoutesActive" : "opRoutesOff")}
        </StatusBadge>
      )
    },
    { key: "orders", header: t("opRoutesColumnOrders"), cell: (route) => number(route.orders_count ?? 0) },
    {
      key: "toggle",
      header: t("opRoutesColumnActive"),
      align: "end",
      cell: (route) => {
        const name = routeName(route, locale);
        return (
          <button
            type="button"
            role="switch"
            aria-checked={route.active}
            aria-label={t(route.active ? "opRoutesTurnOff" : "opRoutesTurnOn", { name })}
            title={t(route.active ? "opRoutesTurnOff" : "opRoutesTurnOn", { name })}
            className={["operating-routes__switch", route.active ? "is-on" : ""].filter(Boolean).join(" ")}
            data-route-id={route.id}
            disabled={pendingId !== null}
            onClick={() => requestToggle(route)}
          >
            <span className="operating-routes__switch-thumb" aria-hidden="true" />
          </button>
        );
      }
    }
  ];

  const filtersActive = Boolean(search.trim() || cityFilter || statusFilter !== "all");

  return (
    <div className="operating-routes" dir={direction}>
      <BentoGrid>
        <Card span={12} padded={false}>
          <CardHeader
            title={t("opRoutesTitle")}
            badge={phase === "ready" ? <StatusBadge tone="info">{t("opRoutesSummary", { active: number(activeCount), off: number(routes.length - activeCount) })}</StatusBadge> : undefined}
            action={
              <div className="operating-routes__actions">
                <Button size="sm" variant="ghost" icon="refresh" disabled={phase === "loading"} onClick={() => { void loadRoutes(); void loadCities(); }}>{t("refreshData")}</Button>
                <Button size="sm" variant="outline" icon="location_on" onClick={() => openDialog("city")}>{t("opRoutesAddCity")}</Button>
                <Button size="sm" icon="add" onClick={() => openDialog("route")}>{t("opRoutesAddRoute")}</Button>
              </div>
            }
          />

          {notice && <div className="operating-routes__notice"><Notice kind={notice.kind}>{notice.message}</Notice></div>}

          {phase === "ready" && routes.length > 0 && (
            <div className="operating-routes__filters">
              <label className="field">
                {t("opRoutesFilterCity")}
                <select name="city_filter" value={cityFilter} onChange={(event) => setCityFilter(event.target.value)}>
                  <option value="">{t("opRoutesAllCities")}</option>
                  {filterCities.map((city) => <option key={city.id} value={city.id}>{cityName(city, locale)}</option>)}
                </select>
              </label>
              <label className="field">
                {t("opRoutesFilterStatus")}
                <select name="status_filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as RouteStatusFilter)}>
                  <option value="all">{t("all")}</option>
                  <option value="active">{t("opRoutesActive")}</option>
                  <option value="off">{t("opRoutesOff")}</option>
                </select>
              </label>
            </div>
          )}

          {phase === "loading" && <div role="status" aria-label={t("opRoutesLoading")} className="overview-resource-state"><Skeleton lines={5} /></div>}
          {phase === "error" && (
            <EmptyState
              icon="report"
              title={t("opRoutesLoadFailed")}
              description={t("opRoutesLoadFailedDescription")}
              action={<Button size="sm" variant="outline" icon="refresh" onClick={() => { void loadRoutes(); void loadCities(); }}>{t("retry")}</Button>}
            />
          )}
          {phase === "ready" && (
            <DataTable
              columns={columns}
              rows={visibleRoutes}
              rowKey={(route) => route.id}
              empty={
                filtersActive && routes.length > 0
                  ? <EmptyState compact icon="search" title={t("opRoutesNoMatches")} />
                  : <EmptyState
                      icon="edit_road"
                      title={t("opRoutesEmpty")}
                      description={t("opRoutesEmptyDescription")}
                      action={<Button size="sm" icon="add" onClick={() => openDialog("route")}>{t("opRoutesAddRoute")}</Button>}
                    />
              }
            />
          )}

          {advancedHref && (
            <div className="operating-routes__footer">
              <a className="btn btn--ghost btn--sm" href={advancedHref}>{t("opRoutesAdvanced")}</a>
            </div>
          )}
        </Card>
      </BentoGrid>

      <AddRouteDialog
        open={dialog === "route"}
        cities={cities}
        citiesFailed={citiesFailed}
        routes={routes}
        busy={dialogBusy}
        error={dialog === "route" ? dialogError : null}
        onRetryCities={() => void loadCities()}
        onSubmit={(draft) => void createRoute(draft)}
        onClose={closeDialog}
      />
      <AddCityDialog
        open={dialog === "city"}
        busy={dialogBusy}
        error={dialog === "city" ? dialogError : null}
        onSubmit={(draft) => void createCity(draft)}
        onClose={closeDialog}
      />
      <RouteDialog
        open={confirmOff !== null}
        title={t("opRoutesConfirmOffTitle")}
        description={confirmOff ? t("opRoutesConfirmOffBody", { name: routeName(confirmOff, locale) }) : undefined}
        dir={direction}
        busy={pendingId !== null}
        onClose={() => setConfirmOff(null)}
        footer={<>
          <Button variant="outline" disabled={pendingId !== null} onClick={() => setConfirmOff(null)}>{t("cancel")}</Button>
          <Button variant="destructive" icon="block" disabled={pendingId !== null} onClick={() => confirmOff && void setActive(confirmOff, false)}>
            {pendingId !== null ? t("saving") : t("opRoutesConfirmOffAction")}
          </Button>
        </>}
      >
        {confirmOff && <RouteChip from={cityName(confirmOff.origin, locale)} to={cityName(confirmOff.destination, locale)} />}
      </RouteDialog>
    </div>
  );
}
