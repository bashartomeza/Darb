import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ApiClient, ApiError } from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import { Button, Card, KpiCard, Notice, StatusBadge } from "../../ui";
import type { Overview } from "./contracts";
import { createObservationGate, type ObservationState } from "./monitoringState";
import { MatchingResults } from "./MatchingResults";
import { LegacyBatches } from "./LegacyBatches";
import { SimulationComparison } from "../comparison/SimulationComparison";

type Tab = "overview" | "matching" | "batches" | "simulation";
const tabs: Tab[] = ["overview", "matching", "batches", "simulation"];
const matchStatuses = ["proposed", "sent_to_driver", "accepted", "rejected", "expired", "invalidated"] as const;
const batchStatuses = ["created", "proposed", "assigned", "picked_up", "in_transit", "delivered", "cancelled", "failed", "expired"] as const;

function terminalStatus(error: unknown) {
  const status = (error as ApiError | undefined)?.status;
  return status === 401 || status === 403;
}

function OverviewPanel({ api, token }: { api: ApiClient; token: string }) {
  const { t, number, dateTime, status } = useLocale();
  const gateRef = useRef(createObservationGate());
  const [state, setState] = useState<ObservationState<Overview>>({ last: null, loading: true, error: null });

  function load() {
    const generation = gateRef.current.begin();
    setState((previous) => ({ ...previous, loading: true, error: null }));
    void api.monitoringOverview(token).then((response) => {
      if (gateRef.current.isCurrent(generation)) setState({ last: response, loading: false, error: null });
    }).catch((error: unknown) => {
      if (!gateRef.current.isCurrent(generation)) return;
      setState((previous) => ({
        last: terminalStatus(error) ? null : previous.last,
        loading: false,
        error: error instanceof Error ? error.message : t("monitoringLoadFailed")
      }));
    });
  }

  useEffect(() => {
    gateRef.current.invalidate();
    setState({ last: null, loading: true, error: null });
    load();
    return () => gateRef.current.invalidate();
  }, [api, token]);

  const data = state.last?.data;
  if (!data && state.loading) return <div className="monitoring-state" role="status">{t("monitoringLoading")}</div>;
  if (!data) {
    return (
      <Card className="monitoring-state">
        <h2>{t("monitoringOverviewUnavailable")}</h2>
        <p>{state.error ?? t("monitoringLoadFailed")}</p>
        <Button data-testid="overview-refresh" variant="outline" onClick={load}>{t("monitoringRefresh")}</Button>
      </Card>
    );
  }

  const matchEntries = Object.entries(data.match_results_by_status);
  const batchEntries = Object.entries(data.batches_by_status);
  return (
    <div className="monitoring-overview">
      <div className="monitoring-toolbar">
        <div>
          <p className="monitoring-observed">{t("monitoringObserved", { time: "" })}<time dateTime={state.last?.observed_at}>{dateTime(state.last?.observed_at)}</time></p>
          <p className="muted">{t("monitoringIndependentObservations")}</p>
        </div>
        <Button data-testid="overview-refresh" variant="outline" icon="refresh" onClick={load}>
          {state.loading ? t("monitoringRefreshing") : t("monitoringRefresh")}
        </Button>
      </div>
      {state.error && <Notice kind="error">{t("monitoringStaleData")}: {state.error}</Notice>}
      <div className="monitoring-kpis">
        <KpiCard icon="person" label={t("monitoringPendingRequests")} value={number(data.pending_passenger_requests)} status={{ text: t("monitoringAllTimeCurrentState"), tone: "neutral" }} />
        <KpiCard icon="inventory_2" label={t("monitoringSubmittedOrders")} value={number(data.submitted_merchant_orders)} status={{ text: t("monitoringAllTimeCurrentState"), tone: "neutral" }} />
      </div>
      <Card>
        <h2>{t("monitoringMatchCohort")}</h2>
        <p className="muted">{t("monitoringMatchCohortDescription")}</p>
        <p className="monitoring-range technical-value">{dateTime(data.range.from)} – {dateTime(data.range.until)}</p>
        <div className="monitoring-status-grid">
          {matchEntries.map(([key, value]) => { const known = matchStatuses.includes(key as typeof matchStatuses[number]); return <div key={key}><StatusBadge status={known ? key : undefined}>{known ? status(key) : t("monitoringUnknown")}</StatusBadge><strong>{number(value)}</strong></div>; })}
        </div>
      </Card>
      <Card>
        <h2>{t("monitoringBatchCurrentStates")}</h2>
        <p className="muted">{t("monitoringBatchCurrentStatesDescription")}</p>
        <div className="monitoring-status-grid">
          {batchEntries.map(([key, value]) => { const known = batchStatuses.includes(key as typeof batchStatuses[number]); return <div key={key}><StatusBadge status={known ? key : undefined}>{known ? status(key) : t("monitoringUnknown")}</StatusBadge><strong>{number(value)}</strong></div>; })}
          <div><span>{t("monitoringActiveBatches")}</span><strong>{number(data.active_batches)}</strong></div>
          <div><span>{t("monitoringDeliveredBatches")}</span><strong>{number(data.batches_by_status.delivered)}</strong></div>
        </div>
      </Card>
      <Card className="monitoring-capabilities">
        <h2>{t("monitoringAvailability")}</h2>
        <ul>
          <li>{t("monitoringCanonicalUnavailable")}</li>
          <li>{t("monitoringFailedHistoryUnavailable")}</li>
          <li>{t("monitoringCompletedBatchesUnavailable")}</li>
        </ul>
      </Card>
    </div>
  );
}

export function MatchingBatchingMonitoring({ api, token }: { api: ApiClient; token: string }) {
  const { direction, t } = useLocale();
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    let target = index;
    if (event.key === "Home") target = 0;
    else if (event.key === "End") target = tabs.length - 1;
    else {
      const visualForward = direction === "rtl" ? event.key === "ArrowLeft" : event.key === "ArrowRight";
      target = (index + (visualForward ? 1 : -1) + tabs.length) % tabs.length;
    }
    const next = tabs[target]!;
    setActiveTab(next);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[target]?.focus();
  }

  return (
    <section className="matching-monitoring" dir={direction}>
      <header className="monitoring-heading">
        <div><h1>{t("monitoringTitle")}</h1><p>{t("monitoringScope")}</p></div>
      </header>
      <div className="monitoring-tabs" role="tablist" aria-label={t("monitoringSections")}>
        {tabs.map((tab, index) => (
          <button key={tab} type="button" role="tab" id={`monitoring-tab-${tab}`} aria-controls={`monitoring-tabpanel-${tab}`} aria-selected={activeTab === tab} tabIndex={activeTab === tab ? 0 : -1}
            onClick={() => setActiveTab(tab)} onKeyDown={(event) => moveTab(event, index)}>
            {t(tab === "overview" ? "monitoringTabOverview" : tab === "matching" ? "monitoringTabMatching" : tab === "batches" ? "monitoringTabBatches" : "monitoringTabSimulation")}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`monitoring-tabpanel-${activeTab}`} aria-labelledby={`monitoring-tab-${activeTab}`}>
        {activeTab === "overview" && <OverviewPanel api={api} token={token} />}
        {activeTab === "matching" && <MatchingResults api={api} token={token} />}
        {activeTab === "batches" && <LegacyBatches api={api} token={token} />}
        {activeTab === "simulation" && <SimulationComparison api={api} token={token} />}
      </div>
    </section>
  );
}
