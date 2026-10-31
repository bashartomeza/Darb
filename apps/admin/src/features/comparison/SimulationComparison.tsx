import { useEffect, useState } from "react";
import type { ApiClient, ComparisonSimulation, SimulationMetrics, SimulationMethodKey } from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import type { TranslationKey } from "../../i18n/translations";
import { Button, Card, CardHeader, DataTable, EmptyState, MeterBar, Notice, StatusBadge, type Column } from "../../ui";

const methods: Array<{ key: SimulationMethodKey; label: TranslationKey; tone: "success" | "info" | "neutral" }> = [
  { key: "manual", label: "simMethodManual", tone: "neutral" },
  { key: "nearest", label: "simMethodNearest", tone: "info" },
  { key: "masari", label: "simMethodMasari", tone: "success" }
];

const metricRows: Array<{ key: string; label: TranslationKey; read: (m: SimulationMetrics) => number }> = [
  { key: "waitAvg", label: "simWaitAvg", read: (m) => m.waitingMin.avg },
  { key: "waitMedian", label: "simWaitMedian", read: (m) => m.waitingMin.median },
  { key: "waitP90", label: "simWaitP90", read: (m) => m.waitingMin.p90 },
  { key: "matchAvg", label: "simMatchAvg", read: (m) => m.matchingMin.avg },
  { key: "matchP90", label: "simMatchP90", read: (m) => m.matchingMin.p90 },
  { key: "deviation", label: "simDeviation", read: (m) => m.routeDeviationKm },
  { key: "seat", label: "simSeatUtil", read: (m) => m.seatUtilisationPct },
  { key: "parcel", label: "simParcelUtil", read: (m) => m.parcelUtilisationPct },
  { key: "vehicle", label: "simVehicleUtil", read: (m) => m.vehicleUtilisationPct },
  { key: "unmatched", label: "simUnmatched", read: (m) => m.unmatchedPct }
];

// Metrics where a shorter bar is better; shown as bar charts.
const chartRows = metricRows.filter((row) => ["waitAvg", "waitP90", "matchAvg", "deviation", "unmatched"].includes(row.key));

/** Admin view of the simulated manual / nearest-driver / Masari comparison. */
export function SimulationComparison({ api, token }: { api: ApiClient; token: string }) {
  const { t, number } = useLocale();
  const [simulation, setSimulation] = useState<ComparisonSimulation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scenarioKey, setScenarioKey] = useState("all");

  function load() {
    setLoading(true);
    setError(null);
    api.comparisonSimulation(token).then(
      (response) => {
        setSimulation(response.simulation);
        setLoading(false);
      },
      (failure: unknown) => {
        setError(failure instanceof Error ? failure.message : t("simLoadFailed"));
        setLoading(false);
      }
    );
  }

  useEffect(load, [api, token]);

  if (!simulation) {
    return (
      <Card>
        <CardHeader title={t("simTitle")} badge={<StatusBadge tone="warning">{t("simBadge")}</StatusBadge>} />
        {loading ? (
          <div className="monitoring-state" role="status">{t("monitoringLoading")}</div>
        ) : (
          <EmptyState
            icon="analytics"
            title={error ?? t("simLoadFailed")}
            action={<Button variant="outline" icon="refresh" onClick={load}>{t("monitoringRefresh")}</Button>}
          />
        )}
      </Card>
    );
  }

  const selected = simulation.scenarios.find((scenario) => scenario.key === scenarioKey);
  const data = selected ? selected.methods : simulation.aggregate;
  const columns: Column<(typeof metricRows)[number]>[] = [
    { key: "metric", header: t("simMetric"), cell: (row) => t(row.label) },
    ...methods.map((method) => ({
      key: method.key,
      header: t(method.label),
      cell: (row: (typeof metricRows)[number]) => <span data-testid={`sim-${method.key}-${row.key}`}>{number(row.read(data[method.key]))}</span>
    }))
  ];

  return (
    <div className="stack">
      <Notice kind="error">{t("simDisclaimer")}</Notice>
      {error && <Notice kind="error">{error}</Notice>}
      <Card>
        <CardHeader
          title={t("simTitle")}
          badge={<StatusBadge tone="warning">{t("simBadge")}</StatusBadge>}
          action={
            <Button variant="outline" size="sm" icon="refresh" onClick={load} disabled={loading}>
              {loading ? t("monitoringRefreshing") : t("monitoringRefresh")}
            </Button>
          }
        />
        <p className="muted">
          {t("simSeed")}: <span className="technical-value">{simulation.params.seed}</span> · {t("simManualDelay")}:{" "}
          <span className="technical-value">{number(simulation.params.manualResponseDelayMin)}</span>
        </p>
        <label>
          <span className="muted">{t("simScenarios")}</span>{" "}
          <select value={scenarioKey} onChange={(event) => setScenarioKey(event.target.value)} data-testid="sim-scenario">
            <option value="all">{t("simScenarioPooled")}</option>
            {simulation.scenarios.map((scenario) => (
              <option key={scenario.key} value={scenario.key}>
                {scenario.label} ({scenario.origin === "hand_written" ? t("simScenarioHand") : t("simScenarioGenerated")})
              </option>
            ))}
          </select>
        </label>
        {selected && (
          <p className="muted">{t("simRequestsDrivers", { requests: number(selected.requests), drivers: number(selected.drivers) })}</p>
        )}
      </Card>
      <Card>
        <CardHeader title={t("simCharts")} />
        <div className="stack stack--tight">
          {chartRows.map((row) => {
            const peak = Math.max(1, ...methods.map((method) => row.read(data[method.key])));
            return (
              <div key={row.key} className="stack stack--tight">
                <strong>{t(row.label)}</strong>
                {methods.map((method) => {
                  const value = row.read(data[method.key]);
                  return <MeterBar key={method.key} label={t(method.label)} value={(value / peak) * 100} display={number(value)} tone={method.tone} />;
                })}
              </div>
            );
          })}
        </div>
      </Card>
      <Card>
        <DataTable columns={columns} rows={metricRows} rowKey={(row) => row.key} />
      </Card>
    </div>
  );
}
