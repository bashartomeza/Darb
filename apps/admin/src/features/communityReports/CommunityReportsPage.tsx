import { useState } from "react";
import {
  COMMUNITY_REPORT_CATEGORIES,
  type ApiClient,
  type CommunityReport,
  type CommunityReportAction,
  type CommunityReportCategory
} from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import { BentoGrid, Button, Card, CardHeader, DataTable, EmptyState, Notice, Skeleton, StatusBadge, TechnicalValue, type Column } from "../../ui";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { Pager } from "../shared/Pager";
import { usePagedList } from "../shared/usePagedList";

export const COMMUNITY_REPORTS_PAGE_SIZE = 25;

export type CommunityReportsApi = Pick<ApiClient, "communityReports" | "moderateCommunityReport">;
export type ReportQueue = "pending" | "all";
export type ReportVisibility = "all" | "visible" | "hidden";

/** What an admin may do to a report in its current state. */
export function reportActions(report: Pick<CommunityReport, "awaiting_admin_review" | "hidden_at">): CommunityReportAction[] {
  const actions: CommunityReportAction[] = [];
  if (report.awaiting_admin_review && !report.hidden_at) actions.push("reviewed");
  actions.push(report.hidden_at ? "restore" : "hide");
  return actions;
}

/**
 * Moderation of what passengers and drivers report about roads and
 * checkpoints. Reports never change the map by themselves; checkpoint and map
 * corrections, and anything flagged by several users, wait here for an admin.
 */
export function CommunityReportsPage({ api, token }: { api: CommunityReportsApi; token: string }) {
  const { t, number, dateTime } = useLocale();
  const [queue, setQueue] = useState<ReportQueue>("pending");
  const [category, setCategory] = useState<CommunityReportCategory | "all">("all");
  const [visibility, setVisibility] = useState<ReportVisibility>("all");
  const [pendingAction, setPendingAction] = useState<{ report: CommunityReport; action: CommunityReportAction } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const list = usePagedList<CommunityReport>(async (page) => {
    const result = await api.communityReports(token, {
      pending: queue === "pending",
      category: category === "all" ? undefined : category,
      hidden: visibility === "all" ? undefined : visibility === "hidden",
      page,
      limit: COMMUNITY_REPORTS_PAGE_SIZE
    });
    return { items: result.reports, total: result.total };
  }, [token, queue, category, visibility]);

  async function runAction() {
    if (!pendingAction) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await api.moderateCommunityReport(token, pendingAction.report.id, pendingAction.action);
      setNotice(t(`communityReportDone_${pendingAction.action}`));
      setPendingAction(null);
      await list.reload();
    } catch {
      setActionError(t("communityReportActionFailed"));
    } finally {
      setActionBusy(false);
    }
  }

  function ask(report: CommunityReport, action: CommunityReportAction) {
    setNotice(null);
    setActionError(null);
    setPendingAction({ report, action });
  }

  const columns: Column<CommunityReport>[] = [
    {
      key: "report",
      header: t("communityReportColumnReport"),
      cell: (report) => (
        <div>
          <p className="cell-stack__title">{t(`communityCategory_${report.category}`)}</p>
          <p className="cell-stack__sub">{report.description}</p>
        </div>
      )
    },
    {
      key: "place",
      header: t("communityReportColumnPlace"),
      cell: (report) => (
        <div>
          <p className="cell-stack__title">{report.location_name}</p>
          {report.latitude !== null && report.longitude !== null && (
            <p className="cell-stack__sub"><TechnicalValue>{`${report.latitude.toFixed(5)}, ${report.longitude.toFixed(5)}`}</TechnicalValue></p>
          )}
        </div>
      )
    },
    { key: "created", header: t("createdAt"), cell: (report) => dateTime(report.created_at) },
    {
      key: "signals",
      header: t("communityReportColumnSignals"),
      cell: (report) => (
        <span className="muted">
          {t("communityReportVotes", { up: number(report.upvotes), down: number(report.downvotes) })}
          {" · "}
          {t("communityReportFlags", { count: number(report.flag_count ?? 0) })}
        </span>
      )
    },
    {
      key: "state",
      header: t("columnStatus"),
      cell: (report) => (
        <div className="stack stack--tight">
          {report.hidden_at && <StatusBadge tone="neutral">{t("communityReportHidden")}</StatusBadge>}
          {report.awaiting_admin_review
            ? <StatusBadge tone="warning">{t("communityReportAwaitingReview")}</StatusBadge>
            : report.admin_reviewed_at
              ? <StatusBadge tone="success">{t("communityReportReviewed")}</StatusBadge>
              : null}
        </div>
      )
    },
    {
      key: "actions",
      header: t("columnActions"),
      align: "end",
      cell: (report) => (
        <div className="button-row">
          {reportActions(report).map((action) => (
            <Button
              key={action}
              size="sm"
              variant={action === "hide" ? "destructive" : action === "reviewed" ? "secondary" : "ghost"}
              disabled={actionBusy}
              onClick={() => ask(report, action)}
            >
              {t(`communityReportAction_${action}`)}
            </Button>
          ))}
        </div>
      )
    }
  ];

  return (
    <BentoGrid>
      <Card span={12} padded={false}>
        <CardHeader
          title={t("communityReportsTitle")}
          badge={list.loaded ? <StatusBadge tone={queue === "pending" && list.total > 0 ? "warning" : "neutral"}>{number(list.total)}</StatusBadge> : undefined}
          action={<Button variant="ghost" size="sm" icon="refresh" disabled={list.phase === "loading"} onClick={() => void list.reload()}>{t("refreshData")}</Button>}
        />
        <div className="card__actions">
          <label className="field field--inline">{t("communityReportQueue")}
            <select value={queue} onChange={(event) => setQueue(event.target.value as ReportQueue)}>
              <option value="pending">{t("communityReportQueue_pending")}</option>
              <option value="all">{t("communityReportQueue_all")}</option>
            </select>
          </label>
          <label className="field field--inline">{t("communityReportCategory")}
            <select value={category} onChange={(event) => setCategory(event.target.value as CommunityReportCategory | "all")}>
              <option value="all">{t("communityCategory_all")}</option>
              {COMMUNITY_REPORT_CATEGORIES.map((value) => <option key={value} value={value}>{t(`communityCategory_${value}`)}</option>)}
            </select>
          </label>
          <label className="field field--inline">{t("communityReportVisibility")}
            <select value={visibility} onChange={(event) => setVisibility(event.target.value as ReportVisibility)}>
              <option value="all">{t("communityReportVisibility_all")}</option>
              <option value="visible">{t("communityReportVisibility_visible")}</option>
              <option value="hidden">{t("communityReportVisibility_hidden")}</option>
            </select>
          </label>
        </div>
        <p className="muted">{t("communityReportsScopeNote")}</p>
        {notice && <Notice kind="success">{notice}</Notice>}
        {!list.loaded && list.phase === "loading" && <div className="overview-resource-state" role="status" aria-label={t("metricLoading")}><Skeleton lines={4} /></div>}
        {!list.loaded && list.phase === "error" && (
          <EmptyState
            compact
            icon="report"
            title={t("communityReportsLoadFailed")}
            action={<Button size="sm" variant="secondary" icon="refresh" onClick={() => void list.reload()}>{t("retry")}</Button>}
          />
        )}
        {list.loaded && (
          <>
            {list.phase === "loading" && <p className="overview-resource-note" role="status">{t("metricRefreshing")}</p>}
            {list.phase === "error" && <p className="overview-resource-note overview-resource-note--error" role="alert">{t("metricRefreshError")}</p>}
            <DataTable
              columns={columns}
              rows={list.items}
              rowKey={(report) => report.id}
              empty={<EmptyState compact icon="check" title={queue === "pending" ? t("communityReportsEmptyPending") : t("communityReportsEmpty")} />}
            />
            <Pager page={list.page} total={list.total} limit={COMMUNITY_REPORTS_PAGE_SIZE} disabled={list.phase === "loading"} onPage={list.setPage} />
          </>
        )}
      </Card>

      <ConfirmDialog
        open={pendingAction !== null}
        title={pendingAction ? t(`communityReportConfirm_${pendingAction.action}`) : ""}
        description={pendingAction ? t(`communityReportConfirmBody_${pendingAction.action}`) : undefined}
        confirmLabel={pendingAction ? t(`communityReportAction_${pendingAction.action}`) : ""}
        destructive={pendingAction?.action === "hide"}
        busy={actionBusy}
        error={actionError}
        onConfirm={() => void runAction()}
        onCancel={() => { if (!actionBusy) { setPendingAction(null); setActionError(null); } }}
      >
        {pendingAction && (
          <div className="stack stack--tight">
            <p><strong>{t(`communityCategory_${pendingAction.report.category}`)}</strong> · {pendingAction.report.location_name}</p>
            <p className="muted">{pendingAction.report.description}</p>
          </div>
        )}
      </ConfirmDialog>
    </BentoGrid>
  );
}
