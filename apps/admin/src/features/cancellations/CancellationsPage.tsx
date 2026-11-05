import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CancellationKind, CancellationPage, CancellationQuery, CancellationRecord, CancellationRole } from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import { BentoGrid, Button, Card, CardHeader, DataTable, EmptyState, Skeleton, StatusBadge, TechnicalValue, type Column } from "../../ui";
import {
  ALL_CANCELLATION_REASONS,
  CANCELLATION_KINDS,
  CANCELLATION_ROLES,
  kindLabelKey,
  orderTypeLabelKey,
  outcomeLabelKey,
  reasonLabelKey,
  roleLabelKey
} from "./cancellationModel";

export type CancellationsApi = {
  cancellations: (token: string, query?: CancellationQuery) => Promise<CancellationPage>;
};

type Filters = { from: string; to: string; kind: CancellationKind | ""; role: CancellationRole | ""; reason: string };
const emptyFilters: Filters = { from: "", to: "", kind: "", role: "", reason: "" };
const PAGE_SIZE = 50;

/** The filters as the API takes them; the "to" day is included up to its last moment. */
export function cancellationQuery(filters: Filters, cursor?: string): CancellationQuery {
  return {
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: `${filters.to}T23:59:59.999Z` } : {}),
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.role ? { role: filters.role } : {}),
    ...(filters.reason ? { reason: filters.reason } : {}),
    ...(cursor ? { cursor } : {}),
    limit: PAGE_SIZE
  };
}

/**
 * Every cancellation, automatic or by a person, newest first: who cancelled,
 * which order or trip, why, the Admin-only note, and what happened to the order.
 */
export function CancellationsPage({ api, token }: { api: CancellationsApi; token: string }) {
  const { t, dateTime } = useLocale();
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [applied, setApplied] = useState<Filters>(emptyFilters);
  const [rows, setRows] = useState<CancellationRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const request = ++latest.current;
    setPhase("loading");
    api
      .cancellations(token, cancellationQuery(applied))
      .then((page) => {
        if (request !== latest.current) return;
        setRows(page.cancellations);
        setCursor(page.next_cursor);
        setPhase("ready");
      })
      .catch(() => {
        if (request === latest.current) setPhase("error");
      });
  }, [api, token, applied]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    const request = latest.current;
    setLoadingMore(true);
    try {
      const page = await api.cancellations(token, cancellationQuery(applied, cursor));
      if (request !== latest.current) return;
      setRows((current) => [...current, ...page.cancellations]);
      setCursor(page.next_cursor);
    } catch {
      if (request === latest.current) setPhase("error");
    } finally {
      setLoadingMore(false);
    }
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApplied({ ...draft });
  }

  const reasonLabel = (code: string) => {
    const key = reasonLabelKey(code);
    return key ? t(key) : code;
  };

  const columns: Column<CancellationRecord>[] = [
    { key: "date", header: t("columnCancelledAt"), cell: (row) => dateTime(row.created_at) },
    {
      key: "kind",
      header: t("cancelFilterKind"),
      cell: (row) => <StatusBadge tone={row.kind === "automatic" ? "info" : "neutral"}>{t(kindLabelKey(row.kind))}</StatusBadge>
    },
    {
      key: "by",
      header: t("columnCancelledBy"),
      cell: (row) => (
        <div>
          <p className="cell-stack__title">{t(roleLabelKey(row.by_role))}</p>
          {row.by && <p className="cell-stack__sub">{row.by.name}</p>}
        </div>
      )
    },
    {
      key: "order",
      header: t("columnCancelledOrder"),
      cell: (row) => row.order ? (
        <div>
          <p className="cell-stack__title">{t(orderTypeLabelKey(row.order.type))} · {row.order.owner.name}</p>
          <p className="cell-stack__sub"><TechnicalValue>{row.order.id}</TechnicalValue></p>
          {row.trip_id && <p className="cell-stack__sub"><TechnicalValue>{row.trip_id}</TechnicalValue></p>}
        </div>
      ) : <span className="muted">{t("noData")}</span>
    },
    { key: "reason", header: t("columnCancelReason"), cell: (row) => reasonLabel(row.reason) },
    { key: "note", header: t("columnCancelNote"), cell: (row) => row.note ?? <span className="muted">{t("noData")}</span> },
    {
      key: "outcome",
      header: t("columnCancelOutcome"),
      align: "end",
      cell: (row) => <StatusBadge tone={row.outcome === "requeued" ? "warning" : "neutral"}>{t(outcomeLabelKey(row.outcome))}</StatusBadge>
    }
  ];

  return (
    <BentoGrid>
      <Card span={12} padded={false}>
        <CardHeader title={t("cancellationsTitle")} badge={<StatusBadge tone="info">{rows.length}</StatusBadge>} />
        <form className="card__actions cancellations__filters" aria-label={t("cancellationsTitle")} onSubmit={apply}>
          <label className="field field--inline">
            {t("cancelFilterFrom")}
            <input type="date" name="from" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} />
          </label>
          <label className="field field--inline">
            {t("cancelFilterTo")}
            <input type="date" name="to" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} />
          </label>
          <label className="field field--inline">
            {t("cancelFilterKind")}
            <select name="kind" value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as Filters["kind"] })}>
              <option value="">{t("all")}</option>
              {CANCELLATION_KINDS.map((kind) => <option key={kind} value={kind}>{t(kindLabelKey(kind))}</option>)}
            </select>
          </label>
          <label className="field field--inline">
            {t("cancelFilterRole")}
            <select name="role" value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as Filters["role"] })}>
              <option value="">{t("all")}</option>
              {CANCELLATION_ROLES.map((role) => <option key={role} value={role}>{t(roleLabelKey(role))}</option>)}
            </select>
          </label>
          <label className="field field--inline">
            {t("cancelFilterReason")}
            <select name="reason" value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })}>
              <option value="">{t("all")}</option>
              {ALL_CANCELLATION_REASONS.map((code) => <option key={code} value={code}>{reasonLabel(code)}</option>)}
            </select>
          </label>
          <Button size="sm" type="submit" icon="search">{t("cancelFilterApply")}</Button>
        </form>
        {phase === "loading" && <div role="status" className="overview-resource-state"><Skeleton lines={4} /></div>}
        {phase === "error" && <EmptyState compact icon="report" title={t("cancellationsLoadFailed")} description={t("resourceLoadErrorDescription")} />}
        {phase === "ready" && (
          <>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              empty={<EmptyState compact icon="history" title={t("cancellationsEmpty")} />}
            />
            {cursor && (
              <div className="card__actions">
                <Button size="sm" variant="ghost" disabled={loadingMore} onClick={() => void loadMore()}>
                  {loadingMore ? t("loading") : t("cancelLoadMore")}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </BentoGrid>
  );
}
