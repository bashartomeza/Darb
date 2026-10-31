import { useCallback, useEffect, useRef, useState } from "react";
import type { UncertainAiPage, UncertainAiRecord, UncertainAiStatus } from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import type { TranslationKey } from "../../i18n/translations";
import { BentoGrid, Button, Card, CardHeader, EmptyState, Skeleton, StatusBadge } from "../../ui";
import type { Tone } from "../../ui/StatusBadge";

type UncertainAiApi = {
  uncertainAiRequests: (token: string, query: { status?: UncertainAiStatus; page?: number; limit?: number }) => Promise<UncertainAiPage>;
  resolveUncertainAiRequest: (
    token: string,
    id: string,
    body: { expected_revision: number; note?: string }
  ) => Promise<{ request: UncertainAiRecord }>;
};

/** Mirrors the API's UNCERTAIN_AI_RETENTION_DAYS, shown to reviewers. */
export const UNCERTAIN_AI_RETENTION_DAYS = 30;

const FILTERS: ("all" | UncertainAiStatus)[] = ["open", "resolved", "all"];
const REASON_LABEL: Record<string, TranslationKey> = {
  not_understood: "uncertainAiReasonNotUnderstood",
  low_confidence: "uncertainAiReasonLowConfidence",
  unsupported_place: "uncertainAiReasonUnsupportedPlace",
  route_mismatch: "uncertainAiReasonRouteMismatch",
  missing_pickup: "uncertainAiReasonMissingPickup",
  missing_dropoff: "uncertainAiReasonMissingDropoff",
  missing_time: "uncertainAiReasonMissingTime"
};
const STATUS_TONE: Record<UncertainAiStatus, Tone> = { open: "warning", resolved: "success" };

export function reasonKey(reason: string): TranslationKey {
  return REASON_LABEL[reason] ?? "uncertainAiReasonOther";
}

export function UncertainAiRequests({ api, token }: { api: UncertainAiApi; token: string }) {
  const { t, dateTime, number } = useLocale();
  const [filter, setFilter] = useState<"all" | UncertainAiStatus>("open");
  const [page, setPage] = useState<UncertainAiPage | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; key: TranslationKey } | null>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latest.current;
    setLoading(true);
    setFailed(false);
    try {
      const result = await api.uncertainAiRequests(token, { status: filter === "all" ? undefined : filter, limit: 50 });
      if (request === latest.current) setPage(result);
    } catch {
      if (request === latest.current) setFailed(true);
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, [api, token, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = page?.requests.find((item) => item.id === selectedId) ?? null;

  async function resolve(item: UncertainAiRecord) {
    setBusy(true);
    setMessage(null);
    try {
      await api.resolveUncertainAiRequest(token, item.id, { expected_revision: item.revision, note: note.trim() || undefined });
      setNote("");
      setSelectedId(null);
      setMessage({ tone: "ok", key: "uncertainAiUpdated" });
    } catch (error) {
      setMessage({ tone: "error", key: (error as { status?: number }).status === 409 ? "uncertainAiConflict" : "uncertainAiFailed" });
    } finally {
      setBusy(false);
      await load();
    }
  }

  return (
    <BentoGrid>
      <Card span={12}>
        <CardHeader
          title={t("uncertainAiTitle")}
          badge={page ? <StatusBadge tone="warning">{t("uncertainAiOpenCount", { count: number(page.open_total) })}</StatusBadge> : undefined}
        />
        <div className="split" role="group" aria-label={t("incidentsFilter")}>
          {FILTERS.map((value) => (
            <Button
              key={value}
              size="sm"
              variant={filter === value ? "secondary" : "ghost"}
              aria-pressed={filter === value}
              onClick={() => { setFilter(value); setSelectedId(null); }}
            >
              {value === "all" ? t("incidentsFilterAll") : value === "open" ? t("incidentStatusOpen") : t("uncertainAiResolved")}
            </Button>
          ))}
          <Button size="sm" variant="ghost" icon="refresh" onClick={() => void load()} disabled={loading}>{t("refreshData")}</Button>
        </div>
        <p className="muted">{t("uncertainAiNote", { days: number(UNCERTAIN_AI_RETENTION_DAYS) })}</p>
        {message && (
          <p className={message.tone === "error" ? "overview-resource-note overview-resource-note--error" : "overview-resource-note"} role={message.tone === "error" ? "alert" : "status"}>
            {t(message.key)}
          </p>
        )}
      </Card>

      <Card span={selected ? 7 : 12} padded={false}>
        {loading && !page && <Skeleton lines={4} />}
        {failed && !page && (
          <EmptyState
            icon="report"
            title={t("resourceLoadError")}
            description={t("resourceLoadErrorDescription")}
            action={<Button size="sm" variant="secondary" icon="refresh" onClick={() => void load()}>{t("retry")}</Button>}
          />
        )}
        {page && page.requests.length === 0 && <EmptyState compact icon="check" title={t("uncertainAiEmpty")} />}
        {page && page.requests.length > 0 && (
          <div className="card__list">
            {page.requests.map((item) => (
              <button
                type="button"
                key={item.id}
                className="card__row"
                aria-current={item.id === selectedId ? "true" : undefined}
                onClick={() => { setSelectedId(item.id); setNote(""); setMessage(null); }}
              >
                <div>
                  <p className="card__row-title" dir="auto">{item.text}</p>
                  <p className="card__row-detail">{t(reasonKey(item.reason))} · {number(Math.round(item.confidence * 100))}% · {dateTime(item.created_at)}</p>
                </div>
                <StatusBadge tone={STATUS_TONE[item.status]}>{item.status === "open" ? t("incidentStatusOpen") : t("uncertainAiResolved")}</StatusBadge>
              </button>
            ))}
          </div>
        )}
      </Card>

      {selected && (
        <Card span={5}>
          <CardHeader title={t(reasonKey(selected.reason))} badge={<StatusBadge tone={STATUS_TONE[selected.status]}>{selected.status === "open" ? t("incidentStatusOpen") : t("uncertainAiResolved")}</StatusBadge>} />
          <div className="stack stack--tight">
            <p className="incident-description" dir="auto">{selected.text}</p>
            <div className="split">
              <span className="kv__key">{t("uncertainAiConfidence")}</span>
              <span>{number(Math.round(selected.confidence * 100))}%</span>
            </div>
            <div className="split">
              <span className="kv__key">{t("uncertainAiSource")}</span>
              <span>{selected.source === "provider" ? t("uncertainAiSourceProvider") : t("uncertainAiSourceRules")}</span>
            </div>
            {selected.resolution_note && (
              <div>
                <span className="kv__key">{t("incidentNote")}</span>
                <p>{selected.resolution_note}</p>
              </div>
            )}
            {selected.status === "open" && (
              <>
                <label className="field">
                  {t("uncertainAiNoteLabel")}
                  <textarea value={note} maxLength={500} disabled={busy} onChange={(event) => setNote(event.target.value)} />
                </label>
                <div className="split">
                  <Button variant="primary" disabled={busy} onClick={() => void resolve(selected)}>{t("uncertainAiResolve")}</Button>
                </div>
              </>
            )}
          </div>
        </Card>
      )}
    </BentoGrid>
  );
}
