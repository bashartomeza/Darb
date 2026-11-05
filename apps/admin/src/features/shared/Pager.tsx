import { useLocale } from "../../i18n/LocaleContext";
import { Button } from "../../ui";

export function pageCount(total: number, limit: number) {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, limit)));
}

/** Previous / next controls for a server-paged list. Renders nothing when everything fits on one page. */
export function Pager({
  page,
  total,
  limit,
  disabled = false,
  onPage
}: {
  page: number;
  total: number;
  limit: number;
  disabled?: boolean;
  onPage: (page: number) => void;
}) {
  const { t, number } = useLocale();
  const pages = pageCount(total, limit);
  if (pages <= 1 && page <= 1) return null;
  return (
    <div className="card__actions" role="navigation" aria-label={t("paginationLabel")}>
      <Button size="sm" variant="ghost" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}>{t("previousPage")}</Button>
      <span className="muted">{t("pageOf", { page: number(page), pages: number(Math.max(pages, page)) })}</span>
      <Button size="sm" variant="ghost" disabled={disabled || page >= pages} onClick={() => onPage(page + 1)}>{t("nextPage")}</Button>
    </div>
  );
}
