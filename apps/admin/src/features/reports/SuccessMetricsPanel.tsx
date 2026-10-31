import { useCallback, useEffect, useRef, useState } from "react";
import type { ReportRange, SuccessMetric, SuccessMetricsResponse } from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import type { TranslationKey } from "../../i18n/translations";
import { BentoGrid, Button, Card, CardHeader, EmptyState, KpiCard, Skeleton } from "../../ui";
import type { Tone } from "../../ui/StatusBadge";
import { toRange } from "./ReportsPanel";

type SuccessMetricsApi = {
  successMetrics: (token: string, range: ReportRange) => Promise<SuccessMetricsResponse>;
  successMetricsExport: (token: string, range: ReportRange) => Promise<Blob>;
};

const STATUS_TONE: Record<SuccessMetric["status"], Tone> = { pass: "success", fail: "danger", no_data: "neutral" };
const STATUS_LABEL: Record<SuccessMetric["status"], TranslationKey> = {
  pass: "successMetricsPass",
  fail: "successMetricsFail",
  no_data: "successMetricsNoData"
};
const TREND_TONE: Record<SuccessMetric["trend"], Tone> = { improving: "success", worsening: "danger", flat: "neutral", none: "neutral" };
const TREND_LABEL: Record<SuccessMetric["trend"], TranslationKey> = {
  improving: "successMetricsTrendImproving",
  worsening: "successMetricsTrendWorsening",
  flat: "successMetricsTrendFlat",
  none: "successMetricsTrendNone"
};

export function SuccessMetricsPanel({ api, token }: { api: SuccessMetricsApi; token: string }) {
  const { t, number } = useLocale();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<SuccessMetricsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const latest = useRef(0);
  const invalidRange = Boolean(from && to && from > to);

  const load = useCallback(async () => {
    if (invalidRange) return;
    const request = ++latest.current;
    setLoading(true);
    setFailed(false);
    try {
      const result = await api.successMetrics(token, toRange(from, to));
      if (request === latest.current) setData(result);
    } catch {
      if (request === latest.current) setFailed(true);
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, [api, token, from, to, invalidRange]);

  useEffect(() => {
    void load();
  }, [load]);

  async function download() {
    setExporting(true);
    setExportFailed(false);
    try {
      const blob = await api.successMetricsExport(token, toRange(from, to));
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "masari-success-metrics.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportFailed(true);
    } finally {
      setExporting(false);
    }
  }

  const unitLabel = (metric: SuccessMetric) => (metric.unit === "percent" ? "%" : metric.unit === "seconds" ? t("successMetricsUnitSeconds") : undefined);
  const valueOf = (value: number | null, metric: SuccessMetric) =>
    value === null ? "-" : `${number(value)}${metric.unit === "percent" ? "%" : ""}`;

  return (
    <BentoGrid>
      <Card span={12}>
        <CardHeader title={t("successMetricsTitle")} />
        <p className="muted">{t("successMetricsDescription")}</p>
        <div className="split">
          <label className="field">
            <span className="kv__key">{t("reportsFrom")}</span>
            <input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label className="field">
            <span className="kv__key">{t("reportsTo")}</span>
            <input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} />
          </label>
          <Button variant="ghost" icon="refresh" onClick={() => void load()} disabled={loading || invalidRange}>
            {t("refreshData")}
          </Button>
          <Button variant="secondary" icon="assessment" onClick={() => void download()} disabled={exporting || invalidRange}>
            {exporting ? t("reportsExporting") : t("successMetricsExport")}
          </Button>
        </div>
        {invalidRange && <p className="muted" role="alert">{t("reportsInvalidRange")}</p>}
        {exportFailed && <p className="overview-resource-note overview-resource-note--error" role="alert">{t("reportsExportFailed")}</p>}
        <p className="muted">{t("successMetricsPrivacy")}</p>
      </Card>

      {failed && !data && (
        <Card span={12}>
          <EmptyState
            icon="report"
            title={t("resourceLoadError")}
            description={t("resourceLoadErrorDescription")}
            action={<Button size="sm" variant="secondary" icon="refresh" onClick={() => void load()}>{t("retry")}</Button>}
          />
        </Card>
      )}
      {loading && !data && (
        <Card span={12}>
          <Skeleton lines={4} />
        </Card>
      )}

      {data && (
        <Card span={12}>
          <div className="kpi-row">
            {data.metrics.map((metric) => (
              <div key={metric.key} data-status={metric.status}>
                <KpiCard
                  metricId={metric.key}
                  icon="assessment"
                  tone={STATUS_TONE[metric.status]}
                  label={t(`sm_${metric.key}` as TranslationKey)}
                  value={valueOf(metric.value, metric)}
                  unit={metric.value === null ? undefined : unitLabel(metric)}
                  status={{ text: `${t(STATUS_LABEL[metric.status])} - ${t("successMetricsTarget", { target: t(`sm_${metric.key}_target` as TranslationKey) })}`, tone: STATUS_TONE[metric.status] }}
                  delta={
                    metric.status === "no_data"
                      ? undefined
                      : { text: t(TREND_LABEL[metric.trend], { value: valueOf(metric.previous_value, metric) }), tone: TREND_TONE[metric.trend] }
                  }
                />
                {metric.status !== "no_data" && <p className="muted">{t("successMetricsSample", { count: number(metric.sample_size) })}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}
    </BentoGrid>
  );
}
