import type { Comparison } from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import { BentoGrid, Button, Card, CardHeader, EmptyState, KpiCard, MeterBar, StatusBadge } from "../../ui";

/** Darb versus the nearest-driver baseline. */
export function ComparisonPanel({
  comparison,
  canAct,
  onRunComparison
}: {
  comparison: Comparison | null;
  canAct: boolean;
  onRunComparison: () => void;
}) {
  const { t, number } = useLocale();

  if (!comparison) {
    return (
      <Card>
        <CardHeader
          title={t("comparison")}
          action={
            <Button variant="action" icon="play" onClick={onRunComparison} disabled={!canAct}>
              {t("runComparison")}
            </Button>
          }
        />
        <EmptyState icon="analytics" title={t("runComparisonEmpty")} />
      </Card>
    );
  }

  const masariTrips = Number(comparison.masari_trips);
  const baselineTrips = Number(comparison.nearest_driver_trips);
  const peakTrips = Math.max(1, masariTrips, baselineTrips);
  const masariDistance = Number(comparison.masari_estimated_distance);
  const baselineDistance = Number(comparison.nearest_estimated_distance);
  const peakDistance = Math.max(1, masariDistance, baselineDistance);
  const masariCost = Number(comparison.masari_estimated_cost);
  const baselineCost = Number(comparison.nearest_estimated_cost);
  const peakCost = Math.max(1, masariCost, baselineCost);

  return (
    <>
      <section className="kpi-row">
        <KpiCard icon="route" tone="info" label={t("trips")} value={number(comparison.masari_trips)} />
        <KpiCard icon="near_me" tone="success" label={t("estimatedDistance")} value={number(comparison.masari_estimated_distance)} />
        <KpiCard icon="analytics" tone="warning" label={t("estimatedCost")} value={number(comparison.masari_estimated_cost)} />
        <KpiCard icon="directions_car" tone="neutral" label={t("driverUtilization")} value={number(comparison.driver_utilization)} />
      </section>

      <BentoGrid>
        <Card span={7}>
          <CardHeader
            title={t("comparison")}
            badge={
              <StatusBadge tone={comparison.winner === "masari" ? "success" : "neutral"}>
                {comparison.winner === "masari" ? t("masari") : t("nearestDriver")}
              </StatusBadge>
            }
            action={
              <Button variant="ghost" size="sm" icon="refresh" onClick={onRunComparison} disabled={!canAct}>
                {t("runComparison")}
              </Button>
            }
          />
          <div className="stack stack--tight">
            <MeterBar label={`${t("trips")} — ${t("masari")}`} value={(masariTrips / peakTrips) * 100} display={number(masariTrips)} tone="success" />
            <MeterBar label={`${t("trips")} — ${t("nearestDriver")}`} value={(baselineTrips / peakTrips) * 100} display={number(baselineTrips)} tone="neutral" />
            <MeterBar label={`${t("estimatedDistance")} — ${t("masari")}`} value={(masariDistance / peakDistance) * 100} display={number(masariDistance)} tone="success" />
            <MeterBar label={`${t("estimatedDistance")} — ${t("nearestDriver")}`} value={(baselineDistance / peakDistance) * 100} display={number(baselineDistance)} tone="neutral" />
            <MeterBar label={`${t("estimatedCost")} — ${t("masari")}`} value={(masariCost / peakCost) * 100} display={number(masariCost)} tone="success" />
            <MeterBar label={`${t("estimatedCost")} — ${t("nearestDriver")}`} value={(baselineCost / peakCost) * 100} display={number(baselineCost)} tone="neutral" />
          </div>
        </Card>

        <Card span={5}>
          <CardHeader title={t("parcelBatchingBenefit")} />
          <p className="muted">{t("comparisonBenefitDemo")}</p>
          <div className="kv">
            <span className="kv__key">{t("driverUtilization")}</span>
            <strong>{number(comparison.driver_utilization)}</strong>
          </div>
          <div className="kv">
            <span className="kv__key">{t("nearestDriver")}</span>
            <span>{t("baselineSeparateTrips")}</span>
          </div>
        </Card>
      </BentoGrid>
    </>
  );
}
