import { type FormEvent, useEffect, useState } from "react";
import type { RouteVersionDraft, ServiceRouteVersion } from "../../api";
import { formatDateTime } from "../../i18n/locale";
import { Button, StatusBadge } from "../../ui";
import { routeVersionDraftFrom } from "./routeManagementModel";

type Locale = "ar" | "en";

export type RouteVersionEditorProps = {
  locale: Locale;
  version: ServiceRouteVersion;
  editing: boolean;
  busy: boolean;
  onBeginEdit: () => void;
  onSaveDraft: (draft: RouteVersionDraft) => void | Promise<void>;
  onCancelEdit: () => void;
};

const copy = {
  ar: {
    title: "تفاصيل الإصدار",
    versionId: "معرّف الإصدار",
    version: "الإصدار",
    status: "الحالة",
    activeFrom: "فعال من",
    activeUntil: "فعال حتى",
    stops: "المحطات",
    nameAr: "الاسم بالعربية",
    nameEn: "الاسم بالإنجليزية",
    descriptionAr: "الوصف بالعربية",
    descriptionEn: "الوصف بالإنجليزية",
    edit: "تعديل المسودة",
    save: "حفظ التغييرات",
    cancel: "إلغاء"
  },
  en: {
    title: "Version details",
    versionId: "Version ID",
    version: "Version",
    status: "Status",
    activeFrom: "Active from",
    activeUntil: "Active until",
    stops: "Stops",
    nameAr: "Arabic name",
    nameEn: "English name",
    descriptionAr: "Arabic description",
    descriptionEn: "English description",
    edit: "Edit draft",
    save: "Save changes",
    cancel: "Cancel"
  }
} as const;

function statusText(locale: Locale, status: ServiceRouteVersion["status"]) {
  const labels = locale === "ar"
    ? { draft: "مسودة", published: "منشور", paused: "متوقف مؤقتاً", retired: "متقاعد" }
    : { draft: "Draft", published: "Published", paused: "Paused", retired: "Retired" };
  return labels[status];
}

export function RouteVersionEditor({
  locale,
  version,
  editing,
  busy,
  onBeginEdit,
  onSaveDraft,
  onCancelEdit
}: RouteVersionEditorProps) {
  const text = copy[locale];
  const editable = version.status === "draft";
  const [draft, setDraft] = useState(() => routeVersionDraftFrom(version));

  useEffect(() => {
    if (!editing) setDraft(routeVersionDraftFrom(version));
  }, [editing, version]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void onSaveDraft(draft);
  }

  return <section className="route-version-editor" aria-label={text.title}>
    <h3>{text.title}</h3>
    {editing && editable ? <form className="field-grid" onSubmit={submit}>
      <label className="field">{text.nameAr}<input name="name_ar" dir="rtl" required value={draft.name_ar} onChange={(event) => setDraft({ ...draft, name_ar: event.target.value })} disabled={busy} /></label>
      <label className="field">{text.nameEn}<input name="name_en" dir="ltr" required value={draft.name_en} onChange={(event) => setDraft({ ...draft, name_en: event.target.value })} disabled={busy} /></label>
      <label className="field">{text.descriptionAr}<textarea name="description_ar" dir="rtl" value={draft.description_ar ?? ""} onChange={(event) => setDraft({ ...draft, description_ar: event.target.value })} disabled={busy} /></label>
      <label className="field">{text.descriptionEn}<textarea name="description_en" dir="ltr" value={draft.description_en ?? ""} onChange={(event) => setDraft({ ...draft, description_en: event.target.value })} disabled={busy} /></label>
      <label className="field">{text.activeFrom}<input name="active_from" type="datetime-local" value={draft.active_from ?? ""} onChange={(event) => setDraft({ ...draft, active_from: event.target.value })} disabled={busy} /></label>
      <label className="field">{text.activeUntil}<input name="active_until" type="datetime-local" value={draft.active_until ?? ""} onChange={(event) => setDraft({ ...draft, active_until: event.target.value })} disabled={busy} /></label>
      <div className="button-row route-version-editor__actions">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onCancelEdit}>{text.cancel}</Button>
        <Button type="submit" size="sm" disabled={busy}>{text.save}</Button>
      </div>
    </form> : <>
      <dl className="route-version-editor__facts">
        <div><dt>{text.versionId}</dt><dd className="technical-value" dir="ltr">{version.id}</dd></div>
        <div><dt>{text.version}</dt><dd>{`v${version.version_number}`}</dd></div>
        <div><dt>{text.status}</dt><dd><StatusBadge status={version.status}>{statusText(locale, version.status)}</StatusBadge></dd></div>
        <div><dt>{text.activeFrom}</dt><dd>{formatDateTime(locale, version.active_from ?? undefined)}</dd></div>
        <div><dt>{text.activeUntil}</dt><dd>{formatDateTime(locale, version.active_until ?? undefined)}</dd></div>
        <div><dt>{text.stops}</dt><dd>{version.stop_count}</dd></div>
      </dl>
      <div className="route-version-editor__summary">
        <strong>{locale === "ar" ? version.name_ar : version.name_en}</strong>
        {(locale === "ar" ? version.description_ar : version.description_en) && <p>{locale === "ar" ? version.description_ar : version.description_en}</p>}
      </div>
      {editable && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onBeginEdit}>{text.edit}</Button>}
    </>}
  </section>;
}
