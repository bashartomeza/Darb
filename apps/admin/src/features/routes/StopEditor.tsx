import { FormEvent, useEffect, useState } from "react";
import type { CanonicalStop, CanonicalStopDraft } from "../../api";
import { translations } from "../../i18n/translations";
import { Button } from "../../ui";

type Locale = "ar" | "en";

export type StopEditorProps = {
  stop: CanonicalStop;
  used: boolean;
  busy: boolean;
  locale: Locale;
  onSave: (id: string, draft: CanonicalStopDraft) => void | boolean | Promise<void | boolean>;
};

type StopEditorDraft = Omit<CanonicalStopDraft, "latitude" | "longitude"> & {
  latitude: string;
  longitude: string;
};

function draftFromStop(stop: CanonicalStop): StopEditorDraft {
  return {
    stop_key: stop.stop_key,
    service_region_key: stop.service_region_key,
    name_ar: stop.name_ar,
    name_en: stop.name_en,
    latitude: String(stop.latitude),
    longitude: String(stop.longitude)
  };
}

function parsedDraft(draft: StopEditorDraft): CanonicalStopDraft | null {
  if (!draft.latitude.trim() || !draft.longitude.trim()) return null;
  const latitude = Number(draft.latitude);
  const longitude = Number(draft.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  return { ...draft, latitude, longitude };
}

export function StopEditor({ stop, used, busy, locale, onSave }: StopEditorProps) {
  const text = translations[locale];
  const [draft, setDraft] = useState(() => draftFromStop(stop));
  const [coordinateError, setCoordinateError] = useState(false);
  const editable = stop.status === "active" && !used;

  useEffect(() => {
    setDraft(draftFromStop(stop));
    setCoordinateError(false);
  }, [stop]);

  if (!editable) {
    return <div className="stop-editor-form__summary">
      <strong>{locale === "ar" ? stop.name_ar : stop.name_en}</strong>
      <span className="technical-value" dir="ltr">{stop.stop_key}</span>
    </div>;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const validatedDraft = parsedDraft(draft);
    if (!validatedDraft) {
      setCoordinateError(true);
      return;
    }
    setCoordinateError(false);
    await onSave(stop.id, validatedDraft);
  }

  function updateCoordinate(field: "latitude" | "longitude", value: string) {
    const nextDraft = { ...draft, [field]: value };
    setDraft(nextDraft);
    if (parsedDraft(nextDraft)) setCoordinateError(false);
  }

  return <form className="field-grid stop-editor-form" onSubmit={(event) => void submit(event)}>
    <p className="muted stop-editor-form__help">{locale === "ar" ? "الإحداثيات مُدخلة يدوياً." : "Coordinates are supplied manually."}</p>
    <label className="field">{text.routeStopKey}<input className="technical-value" name="stop_key" readOnly dir="ltr" value={draft.stop_key} /></label>
    <label className="field">{text.routeRegion}<input className="technical-value" name="service_region_key" dir="ltr" required disabled={busy} value={draft.service_region_key} onChange={(event) => setDraft({ ...draft, service_region_key: event.target.value })} /></label>
    <label className="field">{text.routeNameAr}<input name="name_ar" dir="rtl" required disabled={busy} value={draft.name_ar} onChange={(event) => setDraft({ ...draft, name_ar: event.target.value })} /></label>
    <label className="field">{text.routeNameEn}<input name="name_en" dir="ltr" required disabled={busy} value={draft.name_en} onChange={(event) => setDraft({ ...draft, name_en: event.target.value })} /></label>
    <label className="field">{text.latitude}<input className="technical-value" name="latitude" type="number" min="-90" max="90" step="0.000001" dir="ltr" required disabled={busy} value={draft.latitude} onChange={(event) => updateCoordinate("latitude", event.target.value)} /></label>
    <label className="field">{text.longitude}<input className="technical-value" name="longitude" type="number" min="-180" max="180" step="0.000001" dir="ltr" required disabled={busy} value={draft.longitude} onChange={(event) => updateCoordinate("longitude", event.target.value)} /></label>
    {coordinateError && <p className="field__error" role="alert">{locale === "ar"
      ? "أدخل خط عرض صالحاً (من -90 إلى 90) وخط طول صالحاً (من -180 إلى 180)."
      : "Enter valid latitude (-90 to 90) and longitude (-180 to 180)."}</p>}
    <div className="button-row">
      <Button type="submit" size="sm" disabled={busy}>{text.routeSaveStopEdit}</Button>
    </div>
  </form>;
}
