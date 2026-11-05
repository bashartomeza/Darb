import { useState } from "react";
import type { ApiClient, AppRating, AppRatingSummary } from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import { BentoGrid, Button, Card, CardHeader, DataTable, EmptyState, MeterBar, Skeleton, StatusBadge, type Column } from "../../ui";
import { Pager } from "../shared/Pager";
import { usePagedList } from "../shared/usePagedList";

export const APP_RATINGS_PAGE_SIZE = 25;
const STARS = [5, 4, 3, 2, 1] as const;

export type AppRatingsApi = Pick<ApiClient, "appRatings">;

/** A from/to pair the API accepts: both optional, and never reversed. */
export function ratingRangeError(from: string, to: string) {
  return Boolean(from && to && from > to);
}

export function starText(stars: number) {
  const whole = Math.max(0, Math.min(5, Math.round(stars)));
  return "★".repeat(whole) + "☆".repeat(5 - whole);
}

/** What users think of the app, from the rating they can give in Settings. */
export function AppRatingsPage({ api, token }: { api: AppRatingsApi; token: string }) {
  const { t, number, dateTime, role } = useLocale();
  const [stars, setStars] = useState<number | "all">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [summary, setSummary] = useState<AppRatingSummary | null>(null);
  const rangeInvalid = ratingRangeError(from, to);

  const list = usePagedList<AppRating>(async (page) => {
    if (rangeInvalid) return { items: [], total: 0 };
    const result = await api.appRatings(token, {
      stars: stars === "all" ? undefined : stars,
      from: from || undefined,
      to: to || undefined,
      page,
      limit: APP_RATINGS_PAGE_SIZE
    });
    setSummary(result.summary);
    return { items: result.ratings, total: result.total };
  }, [token, stars, from, to]);

  const columns: Column<AppRating>[] = [
    {
      key: "user",
      header: t("appRatingsColumnUser"),
      cell: (rating) => (
        <div>
          <p className="cell-stack__title">{rating.user.name}</p>
          <p className="cell-stack__sub">{role(rating.user.role)}</p>
        </div>
      )
    },
    {
      key: "stars",
      header: t("appRatingsColumnStars"),
      cell: (rating) => <span aria-label={t("appRatingsStarsLabel", { count: number(rating.stars) })}><span aria-hidden="true">{starText(rating.stars)}</span></span>
    },
    { key: "feedback", header: t("appRatingsColumnFeedback"), cell: (rating) => rating.feedback ?? <span className="muted">{t("appRatingsNoFeedback")}</span> },
    { key: "updated", header: t("appRatingsColumnUpdated"), align: "end", cell: (rating) => dateTime(rating.updated_at) }
  ];

  const loadingFirst = !list.loaded && list.phase === "loading";
  const failedFirst = !list.loaded && list.phase === "error";

  return (
    <BentoGrid>
      <Card span={12}>
        <CardHeader
          title={t("appRatingsFilters")}
          action={<Button variant="ghost" size="sm" icon="refresh" disabled={list.phase === "loading"} onClick={() => void list.reload()}>{t("refreshData")}</Button>}
        />
        <div className="card__actions">
          <label className="field field--inline">{t("appRatingsStarsFilter")}
            <select value={String(stars)} onChange={(event) => setStars(event.target.value === "all" ? "all" : Number(event.target.value))}>
              <option value="all">{t("appRatingsAllStars")}</option>
              {STARS.map((value) => <option key={value} value={value}>{t("appRatingsStarsLabel", { count: number(value) })}</option>)}
            </select>
          </label>
          <label className="field field--inline">{t("reportsFrom")}<input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} /></label>
          <label className="field field--inline">{t("reportsTo")}<input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></label>
        </div>
        {rangeInvalid && <p role="alert" className="overview-resource-note overview-resource-note--error">{t("appRatingsRangeInvalid")}</p>}
      </Card>

      <Card span={4}>
        <CardHeader title={t("appRatingsSummary")} />
        {loadingFirst && <div className="overview-resource-state" role="status" aria-label={t("metricLoading")}><Skeleton lines={3} /></div>}
        {failedFirst && <p className="overview-resource-note overview-resource-note--error" role="alert">{t("metricLoadError")}</p>}
        {summary && list.loaded && (
          summary.count === 0
            ? <EmptyState compact icon="star" title={t("appRatingsEmpty")} />
            : <div className="stack stack--tight">
              <p className="kpi__value" data-metric="app-rating-average">{summary.average === null ? "—" : number(summary.average)}</p>
              <p className="muted">{t("appRatingsCount", { count: number(summary.count) })}</p>
              {STARS.map((value) => {
                const count = summary.distribution[String(value) as keyof AppRatingSummary["distribution"]];
                return <MeterBar key={value} label={t("appRatingsStarsLabel", { count: number(value) })} value={(count / summary.count) * 100} display={number(count)} tone={value >= 4 ? "success" : value === 3 ? "warning" : "danger"} />;
              })}
            </div>
        )}
      </Card>

      <Card span={8} padded={false}>
        <CardHeader title={t("appRatingsList")} badge={list.loaded ? <StatusBadge tone="info">{number(list.total)}</StatusBadge> : undefined} />
        {loadingFirst && <div className="overview-resource-state" role="status" aria-label={t("metricLoading")}><Skeleton lines={4} /></div>}
        {failedFirst && (
          <EmptyState
            compact
            icon="report"
            title={t("appRatingsLoadFailed")}
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
              rowKey={(rating) => rating.user.id}
              empty={<EmptyState compact icon="star" title={stars === "all" && !from && !to ? t("appRatingsEmpty") : t("appRatingsNoMatch")} />}
            />
            <Pager page={list.page} total={list.total} limit={APP_RATINGS_PAGE_SIZE} disabled={list.phase === "loading"} onPage={list.setPage} />
          </>
        )}
      </Card>
    </BentoGrid>
  );
}
