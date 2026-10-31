import { useCallback, useEffect, useRef, useState } from "react";
import type { ReportDataset, ReportRange, ReportSummary } from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import type { TranslationKey } from "../../i18n/translations";
import { BentoGrid, Button, Card, CardHeader, EmptyState, Skeleton, StatusBadge } from "../../ui";

type ReportsApi = {
  reportSummary: (token: string, range: ReportRange) => Promise<ReportSummary>;
  reportExport: (token: string, dataset: ReportDataset, range: ReportRange) => Promise<Blob>;
};

const DATASETS: { dataset: ReportDataset; label: TranslationKey }[] = [
  { dataset: "requests", label: "reportsExportRequests" },
  { dataset: "orders", label: "reportsExportOrders" },
  { dataset: "trips", label: "reportsExportTrips" }
];

/** A date input value (YYYY-MM-DD) becomes an inclusive UTC day boundary. */
export function toRange(from: string, to: string): ReportRange {
  return {
    from: from ? `${from}T00:00:00.000Z` : undefined,
    to: to ? `${to}T23:59:59.999Z` : undefined
  };
}

function StatusBreakdown({ counts }: { counts: Record<string, number> }) {
  const { status, number, t } = useLocale();
  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return <p className="muted">{t("reportsNoRecords")}</p>;
  return (
    <div className="stack stack--tight">
      {entries.map(([key, value]) => (
        <div className="split" key={key}>
          <StatusBadge status={key}>{status(key)}</StatusBadge>
          <strong>{number(value)}</strong>
        </div>
      ))}
    </div>
  );
}

export function ReportsPanel({ api, token }: { api: ReportsApi; token: string }) {
  const { t, number, dateTime } = useLocale();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<ReportDataset | null>(null);
  const [exportFailed, setExportFailed] = useState(false);
  const latest = useRef(0);

  const invalidRange = Boolean(from && to && from > to);

  const load = useCallback(async () => {
    if (invalidRange) return;
    const request = ++latest.current;
    setLoading(true);
    setFailed(false);
    try {
      const result = await api.reportSummary(token, toRange(from, to));
      if (request === latest.current) setSummary(result);
    } catch {
      if (request === latest.current) setFailed(true);
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, [api, token, from, to, invalidRange]);

  useEffect(() => {
    void load();
  }, [load]);

  async function download(dataset: ReportDataset) {
    setExporting(dataset);
    setExportFailed(false);
    try {
      const blob = await api.reportExport(token, dataset, toRange(from, to));
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `masari-${dataset}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportFailed(true);
    } finally {
      setExporting(null);
    }
  }

  return (
    <BentoGrid>
      <Card span={12}>
        <CardHeader title={t("reportsRangeTitle")} />
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
        </div>
        {invalidRange && <p className="muted" role="alert">{t("reportsInvalidRange")}</p>}
        {summary && !loading && <p className="muted">{t("reportsGeneratedAt", { time: dateTime(summary.generated_at) })}</p>}
      </Card>

      {failed && !summary && (
        <Card span={12}>
          <EmptyState
            icon="report"
            title={t("resourceLoadError")}
            description={t("resourceLoadErrorDescription")}
            action={<Button size="sm" variant="secondary" icon="refresh" onClick={() => void load()}>{t("retry")}</Button>}
          />
        </Card>
      )}
      {loading && !summary && (
        <Card span={12}>
          <Skeleton lines={4} />
        </Card>
      )}

      {summary && (
        <>
          {failed && <p className="overview-resource-note overview-resource-note--error" role="alert">{t("metricRefreshError")}</p>}
          <Card span={4}>
            <CardHeader title={t("passengerRequests")} badge={<StatusBadge tone="info">{number(summary.passenger_requests.total)}</StatusBadge>} />
            <StatusBreakdown counts={summary.passenger_requests.by_status} />
          </Card>
          <Card span={4}>
            <CardHeader title={t("merchantOrders")} badge={<StatusBadge tone="info">{number(summary.merchant_orders.total)}</StatusBadge>} />
            <StatusBreakdown counts={summary.merchant_orders.by_status} />
            <div className="split">
              <span className="kv__key">{t("parcels")}</span>
              <strong>{number(summary.merchant_orders.parcels)}</strong>
            </div>
          </Card>
          <Card span={4}>
            <CardHeader title={t("trips")} badge={<StatusBadge tone="info">{number(summary.trips.total)}</StatusBadge>} />
            <StatusBreakdown counts={summary.trips.by_status} />
          </Card>
          <Card span={6}>
            <CardHeader title={t("reportsMatches")} badge={<StatusBadge tone="info">{number(summary.matches.total)}</StatusBadge>} />
            <StatusBreakdown counts={summary.matches.by_status} />
          </Card>
          <Card span={6}>
            <CardHeader title={t("reportsDrivers")} />
            <div className="stack stack--tight">
              <div className="split"><span className="kv__key">{t("reportsDriversTotal")}</span><strong>{number(summary.drivers.total)}</strong></div>
              <div className="split"><span className="kv__key">{t("reportsDriversVerified")}</span><strong>{number(summary.drivers.verified)}</strong></div>
              <div className="split"><span className="kv__key">{t("reportsDriversPending")}</span><strong>{number(summary.drivers.pending_verification)}</strong></div>
            </div>
          </Card>
        </>
      )}

      <Card span={12}>
        <CardHeader title={t("reportsExportTitle")} />
        <p className="muted">{t("reportsExportNote")}</p>
        <div className="split">
          {DATASETS.map(({ dataset, label }) => (
            <Button
              key={dataset}
              variant="secondary"
              icon="assessment"
              disabled={exporting !== null || invalidRange}
              onClick={() => void download(dataset)}
            >
              {exporting === dataset ? t("reportsExporting") : t(label)}
            </Button>
          ))}
        </div>
        {exportFailed && <p className="overview-resource-note overview-resource-note--error" role="alert">{t("reportsExportFailed")}</p>}
      </Card>
    </BentoGrid>
  );
}
