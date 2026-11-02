import { type FormEvent, useEffect, useState } from "react";
import type { RouteVersionDraft, ServiceRoute, ServiceRouteVersion } from "../../api";
import { formatDateTime } from "../../i18n/locale";
import { Button, Card, CardHeader, EmptyState, Notice, StatusBadge } from "../../ui";
import { RouteVersionEditor } from "./RouteVersionEditor";

type Locale = "ar" | "en";

export type RouteVersionsProps = {
  locale: Locale;
  route: ServiceRoute;
  selectedVersion: ServiceRouteVersion | null;
  editing: boolean;
  busy: boolean;
  feedback: { kind: "success" | "error"; text: string } | null;
  onSelectVersion: (version: ServiceRouteVersion) => void;
  onCreateDraft: (draft: RouteVersionDraft) => void | Promise<void>;
  onBeginEdit: () => void;
  onSaveDraft: (draft: RouteVersionDraft) => void | Promise<void>;
  onCancelEdit: () => void;
};

const copy = {
  ar: {
    title: "الإصدارات",
    create: "إنشاء إصدار",
    versionId: "معرّف الإصدار",
    stops: "محطات",
    current: "الحالي",
  open: "فتح",
    createDraft: "إنشاء المسودة",
    cancel: "إلغاء",
    nameAr: "الاسم بالعربية",
    nameEn: "الاسم بالإنجليزية",
    descriptionAr: "الوصف بالعربية",
    descriptionEn: "الوصف بالإنجليزية",
    activeFrom: "فعال من",
    activeUntil: "فعال حتى",
    empty: "لا توجد إصدارات لهذا المسار.",
    select: "اختر إصداراً لعرض تفاصيله.",
    shown: "يتم عرض {shown} من أصل {total} إصداراً.",
    truncated: "يتم عرض أحدث {shown} من أصل {total} إصداراً."
  },
  en: {
    title: "Versions",
    create: "Create version",
    versionId: "Version ID",
    stops: "stops",
    current: "Current",
    open: "Open",
    createDraft: "Create draft",
    cancel: "Cancel",
    nameAr: "Arabic name",
    nameEn: "English name",
    descriptionAr: "Arabic description",
    descriptionEn: "English description",
    activeFrom: "Active from",
    activeUntil: "Active until",
    empty: "This route has no versions.",
    select: "Select a version to view its details.",
    shown: "Showing {shown} of {total} route versions.",
    truncated: "Showing the newest {shown} of {total} route versions."
  }
} as const;

function statusText(locale: Locale, status: ServiceRouteVersion["status"]) {
  const labels = locale === "ar"
    ? { draft: "مسودة", published: "منشور", paused: "متوقف مؤقتاً", retired: "متقاعد" }
    : { draft: "Draft", published: "Published", paused: "Paused", retired: "Retired" };
  return labels[status];
}

function historyText(template: string, shown: number, total: number) {
  return template.replace("{shown}", String(shown)).replace("{total}", String(total));
}

function emptyCreateDraft(): RouteVersionDraft {
  return {
    name_ar: "",
    name_en: "",
    description_ar: "",
    description_en: "",
    active_from: "",
    active_until: ""
  };
}

export function RouteVersions({
  locale,
  route,
  selectedVersion,
  editing,
  busy,
  feedback,
  onSelectVersion,
  onCreateDraft,
  onBeginEdit,
  onSaveDraft,
  onCancelEdit
}: RouteVersionsProps) {
  const text = copy[locale];
  const versions = route.versions ?? [];
  const truncated = route.version_count > versions.length;
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState<RouteVersionDraft>(emptyCreateDraft);

  function closeCreate() {
    setCreating(false);
    setCreateDraft(emptyCreateDraft());
  }

  useEffect(() => {
    closeCreate();
  }, [selectedVersion?.id]);

  function submitCreate(event: FormEvent) {
    event.preventDefault();
    void onCreateDraft(createDraft);
  }

  return <Card className="route-versions">
    <CardHeader title={text.title} action={<Button variant="secondary" icon="add" onClick={() => setCreating(true)} disabled={busy}>{text.create}</Button>} />
    <p className="muted route-versions__history">{historyText(truncated ? text.truncated : text.shown, versions.length, route.version_count)}</p>
    {creating && <div className="route-version-create">
      <form className="field-grid" onSubmit={submitCreate}>
        <label className="field">{text.nameAr}<input name="name_ar" dir="rtl" required value={createDraft.name_ar} onChange={(event) => setCreateDraft({ ...createDraft, name_ar: event.target.value })} disabled={busy} /></label>
        <label className="field">{text.nameEn}<input name="name_en" dir="ltr" required value={createDraft.name_en} onChange={(event) => setCreateDraft({ ...createDraft, name_en: event.target.value })} disabled={busy} /></label>
        <label className="field">{text.descriptionAr}<textarea name="description_ar" dir="rtl" value={createDraft.description_ar ?? ""} onChange={(event) => setCreateDraft({ ...createDraft, description_ar: event.target.value })} disabled={busy} /></label>
        <label className="field">{text.descriptionEn}<textarea name="description_en" dir="ltr" value={createDraft.description_en ?? ""} onChange={(event) => setCreateDraft({ ...createDraft, description_en: event.target.value })} disabled={busy} /></label>
        <label className="field">{text.activeFrom}<input name="active_from" type="datetime-local" value={createDraft.active_from ?? ""} onChange={(event) => setCreateDraft({ ...createDraft, active_from: event.target.value })} disabled={busy} /></label>
        <label className="field">{text.activeUntil}<input name="active_until" type="datetime-local" value={createDraft.active_until ?? ""} onChange={(event) => setCreateDraft({ ...createDraft, active_until: event.target.value })} disabled={busy} /></label>
        <div className="button-row">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={closeCreate}>{text.cancel}</Button>
          <Button type="submit" size="sm" disabled={busy}>{text.createDraft}</Button>
        </div>
      </form>
    </div>}
    {versions.length === 0 ? <EmptyState compact icon="route" title={text.empty} /> : <div className="route-versions__list">
      {versions.map((version) => <article className="route-versions__row" data-route-version-id={version.id} key={version.id}>
        <div className="route-versions__row-main">
          <strong>{`v${version.version_number}`}</strong>
          <StatusBadge status={version.status}>{statusText(locale, version.status)}</StatusBadge>
          {route.current_version_id === version.id && <span className="route-versions__current">{text.current}</span>}
        </div>
        <div className="route-versions__metadata">
          <span className="technical-value" dir="ltr">{version.id}</span>
          <span>{formatDateTime(locale, version.active_from ?? undefined)} — {formatDateTime(locale, version.active_until ?? undefined)}</span>
          <span>{version.stop_count} {text.stops}</span>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onSelectVersion(version)}>{text.open}</Button>
      </article>)}
    </div>}
    <div className="route-versions__workspace">
      {feedback && <Notice kind={feedback.kind}>{feedback.text}</Notice>}
      {selectedVersion ? <>
        <RouteVersionEditor
          locale={locale}
          version={selectedVersion}
          editing={editing}
          busy={busy}
          onBeginEdit={onBeginEdit}
          onSaveDraft={onSaveDraft}
          onCancelEdit={onCancelEdit}
        />
      </> : <p className="muted">{text.select}</p>}
    </div>
  </Card>;
}
