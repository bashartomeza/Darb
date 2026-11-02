import { useCallback, useEffect, useRef, useState } from "react";
import type { IncidentPage, IncidentRecord, IncidentStatus } from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import type { TranslationKey } from "../../i18n/translations";
import { BentoGrid, Button, Card, CardHeader, EmptyState, Skeleton, StatusBadge, TechnicalValue } from "../../ui";
import type { Tone } from "../../ui/StatusBadge";

type IncidentsApi = {
  incidents: (token: string, query: { status?: IncidentStatus; page?: number; limit?: number }) => Promise<IncidentPage>;
  updateIncident: (
    token: string,
    id: string,
    body: { status: Exclude<IncidentStatus, "open">; expected_revision: number; note?: string }
  ) => Promise<{ incident: IncidentRecord }>;
};

const FILTERS: ("all" | IncidentStatus)[] = ["all", "open", "reviewing", "resolved"];
const STATUS_LABEL: Record<IncidentStatus, TranslationKey> = {
  open: "incidentStatusOpen",
  reviewing: "incidentStatusReviewing",
  resolved: "incidentStatusResolved"
};
const STATUS_TONE: Record<IncidentStatus, Tone> = { open: "warning", reviewing: "info", resolved: "success" };
const CATEGORY_LABEL: Record<string, TranslationKey> = {
  safety: "incidentCategorySafety",
  delay: "incidentCategoryDelay",
  parcel_damage: "incidentCategoryParcelDamage",
  behavior: "incidentCategoryBehavior",
  other: "incidentCategoryOther"
};

/** Forward-only, mirroring the server's allowed transitions. */
export function nextActions(status: IncidentStatus): Exclude<IncidentStatus, "open">[] {
  if (status === "open") return ["reviewing", "resolved"];
  if (status === "reviewing") return ["resolved"];
  return [];
}

export function IncidentsPanel({ api, token }: { api: IncidentsApi; token: string }) {
  const { t, role, dateTime, number } = useLocale();
  const [filter, setFilter] = useState<"all" | IncidentStatus>("open");
  const [page, setPage] = useState<IncidentPage | null>(null);
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
      const result = await api.incidents(token, { status: filter === "all" ? undefined : filter, limit: 50 });
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

  const selected = page?.incidents.find((incident) => incident.id === selectedId) ?? null;

  async function apply(incident: IncidentRecord, status: Exclude<IncidentStatus, "open">) {
    setBusy(true);
    setMessage(null);
    try {
      await api.updateIncident(token, incident.id, {
        status,
        expected_revision: incident.revision,
        note: note.trim() || undefined
      });
      setNote("");
      setMessage({ tone: "ok", key: "incidentUpdated" });
    } catch (error) {
      setMessage({ tone: "error", key: (error as { status?: number }).status === 409 ? "incidentConflict" : "incidentUpdateFailed" });
    } finally {
      setBusy(false);
      await load();
    }
  }

  return (
    <BentoGrid>
      <Card span={12}>
        <CardHeader title={t("incidentsQueueTitle")} badge={page ? <StatusBadge tone="warning">{t("incidentsOpenCount", { count: number(page.open_total) })}</StatusBadge> : undefined} />
        <div className="split" role="group" aria-label={t("incidentsFilter")}>
          {FILTERS.map((value) => (
            <Button
              key={value}
              size="sm"
              variant={filter === value ? "secondary" : "ghost"}
              aria-pressed={filter === value}
              onClick={() => { setFilter(value); setSelectedId(null); }}
            >
              {value === "all" ? t("incidentsFilterAll") : t(STATUS_LABEL[value])}
            </Button>
          ))}
          <Button size="sm" variant="ghost" icon="refresh" onClick={() => void load()} disabled={loading}>{t("refreshData")}</Button>
        </div>
        <p className="muted">{t("incidentsScopeNote")}</p>
        {message && <p className={message.tone === "error" ? "overview-resource-note overview-resource-note--error" : "overview-resource-note"} role={message.tone === "error" ? "alert" : "status"}>{t(message.key)}</p>}
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
        {page && page.incidents.length === 0 && <EmptyState compact icon="check" title={t("incidentsEmpty")} />}
        {page && page.incidents.length > 0 && (
          <div className="card__list">
            {page.incidents.map((incident) => (
              <button
                type="button"
                key={incident.id}
                className="card__row"
                aria-current={incident.id === selectedId ? "true" : undefined}
                onClick={() => { setSelectedId(incident.id); setNote(""); setMessage(null); }}
              >
                <div>
                  <p className="card__row-title">{t(CATEGORY_LABEL[incident.category] ?? "incidentCategoryOther")}</p>
                  <p className="card__row-detail">{incident.reporter ? `${incident.reporter.name} · ${role(incident.reporter.role)}` : ""} · {dateTime(incident.created_at)}</p>
                </div>
                <StatusBadge tone={STATUS_TONE[incident.status]}>{t(STATUS_LABEL[incident.status])}</StatusBadge>
              </button>
            ))}
          </div>
        )}
      </Card>

      {selected && (
        <Card span={5}>
          <CardHeader title={t(CATEGORY_LABEL[selected.category] ?? "incidentCategoryOther")} badge={<StatusBadge tone={STATUS_TONE[selected.status]}>{t(STATUS_LABEL[selected.status])}</StatusBadge>} />
          <div className="stack stack--tight">
            <p className="incident-description">{selected.description}</p>
            {selected.trip_id && (
              <div className="split">
                <span className="kv__key">{t("columnTrip")}</span>
                <TechnicalValue>{selected.trip_id}</TechnicalValue>
              </div>
            )}
            {selected.admin_note && (
              <div>
                <span className="kv__key">{t("incidentNote")}</span>
                <p>{selected.admin_note}</p>
              </div>
            )}
            {nextActions(selected.status).length > 0 ? (
              <>
                <label className="field">
                  {t("incidentNote")}
                  <textarea value={note} maxLength={1000} disabled={busy} onChange={(event) => setNote(event.target.value)} />
                </label>
                <div className="split">
                  {nextActions(selected.status).map((status) => (
                    <Button key={status} variant={status === "resolved" ? "primary" : "secondary"} disabled={busy} onClick={() => void apply(selected, status)}>
                      {status === "reviewing" ? t("incidentActionReview") : t("incidentActionResolve")}
                    </Button>
                  ))}
                </div>
              </>
            ) : (
              <p className="muted">{t("incidentFinal")}</p>
            )}
          </div>
        </Card>
      )}
    </BentoGrid>
  );
}
