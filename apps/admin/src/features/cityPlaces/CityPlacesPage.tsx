import { FormEvent, useCallback, useEffect, useState } from "react";
import type { ApiClient, ApiError, CityPlace, CityPlaceCity, CityPlaceDraft, CityPlaceUpdate } from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import type { TranslationKey } from "../../i18n/translations";
import { BentoGrid, Button, Card, CardHeader, DataTable, EmptyState, Notice, Skeleton, StatusBadge, TechnicalValue, type Column } from "../../ui";
import { RouteDialog } from "../routes/RouteDialog";
import { useDebouncedValue } from "../shared/usePagedList";

/** Same box the API enforces for places (the whole service area of the operating routes). */
export const SERVICE_AREA = { minLatitude: 29.4, maxLatitude: 33.4, minLongitude: 34.2, maxLongitude: 35.95 } as const;

export type CityPlacesApi = Pick<ApiClient, "cityPlaces" | "createCityPlace" | "updateCityPlace">;

export type PlaceForm = { city_key: string; name_ar: string; name_en: string; latitude: string; longitude: string };
export type PlaceFormError = "names" | "coordinates" | "outside_area";

export function emptyPlaceForm(cityKey = ""): PlaceForm {
  return { city_key: cityKey, name_ar: "", name_en: "", latitude: "", longitude: "" };
}

function parseCoordinate(value: string) {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function insideServiceArea(latitude: number, longitude: number) {
  return latitude >= SERVICE_AREA.minLatitude && latitude <= SERVICE_AREA.maxLatitude
    && longitude >= SERVICE_AREA.minLongitude && longitude <= SERVICE_AREA.maxLongitude;
}

/** Checks a form the way the API will, so most mistakes are caught before sending. */
export function validatePlaceForm(form: PlaceForm): PlaceFormError | null {
  if (form.name_ar.trim().length < 2 || form.name_en.trim().length < 2) return "names";
  const latitude = parseCoordinate(form.latitude);
  const longitude = parseCoordinate(form.longitude);
  if (latitude === null || longitude === null) return "coordinates";
  if (!insideServiceArea(latitude, longitude)) return "outside_area";
  return null;
}

export function placeDraftFrom(form: PlaceForm): CityPlaceDraft {
  return {
    city_key: form.city_key,
    name_ar: form.name_ar.trim(),
    name_en: form.name_en.trim(),
    latitude: Number(form.latitude.trim()),
    longitude: Number(form.longitude.trim())
  };
}

/** Only the fields that differ from the stored place. */
export function placeUpdateFrom(form: PlaceForm, current: CityPlace): CityPlaceUpdate {
  const update: CityPlaceUpdate = {};
  const latitude = Number(form.latitude.trim());
  const longitude = Number(form.longitude.trim());
  if (form.name_ar.trim() !== current.name_ar) update.name_ar = form.name_ar.trim();
  if (form.name_en.trim() !== current.name_en) update.name_en = form.name_en.trim();
  if (latitude !== current.latitude) update.latitude = latitude;
  if (longitude !== current.longitude) update.longitude = longitude;
  return update;
}

function apiErrorKey(error: unknown): TranslationKey {
  const code = (error as ApiError | undefined)?.message;
  if (code === "city_place_exists") return "cityPlacesError_exists";
  if (code === "city_place_not_found") return "cityPlacesError_missing";
  if ((error as ApiError | undefined)?.status === 400) return "cityPlacesError_invalid";
  return "cityPlacesError_failed";
}

/**
 * The villages and towns riders and senders pick as pickup / drop-off, per
 * city. Admins add, correct (rename or move) and disable places here; the apps
 * read the list per route, so a change shows without a release.
 */
export function CityPlacesPage({ api, token, search }: { api: CityPlacesApi; token: string; search: string }) {
  const { t, locale, number, direction } = useLocale();
  const query = useDebouncedValue(search.trim());
  const [cityKey, setCityKey] = useState("");
  const [cities, setCities] = useState<CityPlaceCity[]>([]);
  const [places, setPlaces] = useState<CityPlace[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [editor, setEditor] = useState<{ mode: "create" | "edit"; place: CityPlace | null; form: PlaceForm } | null>(null);
  const [formError, setFormError] = useState<TranslationKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowError, setRowError] = useState<TranslationKey | null>(null);

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const result = await api.cityPlaces(token, { city_key: cityKey, search: query });
      setCities(result.cities);
      setPlaces(result.places);
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, [api, token, cityKey, query]);

  useEffect(() => { void load(); }, [load]);

  const cityName = (city: CityPlaceCity) => (locale === "ar" ? city.name_ar : city.name_en);
  const cityLabel = (key: string) => {
    const city = cities.find((entry) => entry.city_key === key);
    return city ? cityName(city) : key;
  };

  function openCreate() {
    setNotice(null);
    setFormError(null);
    setEditor({ mode: "create", place: null, form: emptyPlaceForm(cityKey || cities[0]?.city_key || "") });
  }

  function openEdit(place: CityPlace) {
    setNotice(null);
    setFormError(null);
    setEditor({
      mode: "edit",
      place,
      form: { city_key: place.city_key, name_ar: place.name_ar, name_en: place.name_en, latitude: String(place.latitude), longitude: String(place.longitude) }
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editor) return;
    const invalid = validatePlaceForm(editor.form);
    if (invalid) {
      setFormError(`cityPlacesError_${invalid}`);
      return;
    }
    const update = editor.place ? placeUpdateFrom(editor.form, editor.place) : null;
    if (update && Object.keys(update).length === 0) {
      setEditor(null);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editor.mode === "create") await api.createCityPlace(token, placeDraftFrom(editor.form));
      else await api.updateCityPlace(token, editor.place!.id, update!);
      setNotice(t(editor.mode === "create" ? "cityPlacesCreated" : "cityPlacesUpdated"));
      setEditor(null);
      await load();
    } catch (error) {
      setFormError(apiErrorKey(error));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(place: CityPlace) {
    setSaving(true);
    setNotice(null);
    setRowError(null);
    try {
      await api.updateCityPlace(token, place.id, { active: !place.active });
      setNotice(t(place.active ? "cityPlacesDisabledDone" : "cityPlacesEnabledDone"));
      await load();
    } catch (error) {
      setRowError(apiErrorKey(error));
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<CityPlace>[] = [
    {
      key: "name",
      header: t("cityPlacesName"),
      cell: (place) => (
        <div>
          <p className="cell-stack__title" dir="rtl">{place.name_ar}</p>
          <p className="cell-stack__sub" dir="ltr">{place.name_en}</p>
        </div>
      )
    },
    { key: "city", header: t("cityPlacesCity"), cell: (place) => cityLabel(place.city_key) },
    {
      key: "position",
      header: t("cityPlacesPosition"),
      cell: (place) => (
        <div>
          <TechnicalValue>{`${place.latitude.toFixed(6)}, ${place.longitude.toFixed(6)}`}</TechnicalValue>
          <p className="cell-stack__sub">
            <StatusBadge tone={place.approximate ? "warning" : "success"}>{t(place.approximate ? "cityPlacesApproximate" : "cityPlacesVerified")}</StatusBadge>{" "}
            {place.source}
          </p>
        </div>
      )
    },
    {
      key: "state",
      header: t("cityPlacesState"),
      cell: (place) => <StatusBadge tone={place.active ? "success" : "neutral"}>{t(place.active ? "cityPlacesActive" : "cityPlacesDisabled")}</StatusBadge>
    },
    {
      key: "actions",
      header: t("columnActions"),
      align: "end",
      cell: (place) => (
        <div className="button-row">
          <Button size="sm" variant="outline" disabled={saving} onClick={() => openEdit(place)}>{t("cityPlacesEdit")}</Button>
          <Button size="sm" variant={place.active ? "destructive" : "secondary"} disabled={saving} onClick={() => void toggle(place)}>
            {t(place.active ? "cityPlacesDisable" : "cityPlacesEnable")}
          </Button>
        </div>
      )
    }
  ];

  return (
    <BentoGrid>
      <Card span={12} padded={false}>
        <CardHeader
          title={t("cityPlacesTitle")}
          badge={phase === "ready" ? <StatusBadge tone="info">{number(places.length)}</StatusBadge> : undefined}
          action={
            <div className="button-row">
              <label className="field field--inline">
                <span className="visually-hidden">{t("cityPlacesCity")}</span>
                <select name="city_filter" value={cityKey} onChange={(event) => setCityKey(event.target.value)}>
                  <option value="">{t("cityPlacesAll")}</option>
                  {cities.map((city) => (
                    <option key={city.city_key} value={city.city_key}>
                      {cityName(city)} ({t("cityPlacesCount", { active: number(city.places_active), total: number(city.places_total) })})
                    </option>
                  ))}
                </select>
              </label>
              <Button variant="ghost" size="sm" icon="refresh" disabled={phase === "loading"} onClick={() => void load()}>{t("refreshData")}</Button>
              <Button variant="primary" size="sm" icon="add" disabled={cities.length === 0} onClick={openCreate}>{t("cityPlacesAdd")}</Button>
            </div>
          }
        />
        {notice && <Notice kind="success">{notice}</Notice>}
        {rowError && <Notice kind="error">{t(rowError)}</Notice>}
        {phase === "loading" && places.length === 0 && <div className="overview-resource-state" role="status" aria-label={t("metricLoading")}><Skeleton lines={4} /></div>}
        {phase === "error" && (
          <EmptyState
            compact
            icon="report"
            title={t("cityPlacesLoadFailed")}
            action={<Button size="sm" variant="secondary" icon="refresh" onClick={() => void load()}>{t("retry")}</Button>}
          />
        )}
        {phase !== "error" && (phase === "ready" || places.length > 0) && (
          <DataTable
            columns={columns}
            rows={places}
            rowKey={(place) => place.id}
            empty={<EmptyState compact icon="location_on" title={query ? t("searchNoResults") : t("cityPlacesEmpty")} />}
          />
        )}
      </Card>

      <RouteDialog
        open={editor !== null}
        title={editor?.mode === "edit" ? t("cityPlacesEditTitle") : t("cityPlacesAddTitle")}
        description={t("cityPlacesBoundsHint")}
        busy={saving}
        dir={direction}
        onClose={() => { if (!saving) setEditor(null); }}
      >
        {editor && (
          <form className="stack" onSubmit={(event) => void save(event)} noValidate>
            <div className="field-grid">
              <label className="field">{t("cityPlacesCity")}
                <select name="city_key" disabled={saving || editor.mode === "edit"} value={editor.form.city_key} onChange={(event) => setEditor({ ...editor, form: { ...editor.form, city_key: event.target.value } })}>
                  {cities.map((city) => <option key={city.city_key} value={city.city_key}>{cityName(city)}</option>)}
                </select>
              </label>
              <label className="field">{t("cityPlacesNameAr")}
                <input name="name_ar" dir="rtl" required maxLength={160} disabled={saving} value={editor.form.name_ar} onChange={(event) => { setFormError(null); setEditor({ ...editor, form: { ...editor.form, name_ar: event.target.value } }); }} />
              </label>
              <label className="field">{t("cityPlacesNameEn")}
                <input name="name_en" dir="ltr" required maxLength={160} disabled={saving} value={editor.form.name_en} onChange={(event) => { setFormError(null); setEditor({ ...editor, form: { ...editor.form, name_en: event.target.value } }); }} />
              </label>
              <label className="field">{t("latitude")}
                <input name="latitude" className="technical-value" dir="ltr" inputMode="decimal" required disabled={saving} value={editor.form.latitude} placeholder="31.5326" onChange={(event) => { setFormError(null); setEditor({ ...editor, form: { ...editor.form, latitude: event.target.value } }); }} />
              </label>
              <label className="field">{t("longitude")}
                <input name="longitude" className="technical-value" dir="ltr" inputMode="decimal" required disabled={saving} value={editor.form.longitude} placeholder="35.0998" onChange={(event) => { setFormError(null); setEditor({ ...editor, form: { ...editor.form, longitude: event.target.value } }); }} />
              </label>
            </div>
            {formError && <p role="alert" className="field__error">{t(formError)}</p>}
            <div className="button-row">
              <Button variant="outline" size="sm" disabled={saving} onClick={() => setEditor(null)}>{t("cancel")}</Button>
              <Button type="submit" size="sm" disabled={saving}>{saving ? t("saving") : t("cityPlacesSave")}</Button>
            </div>
          </form>
        )}
      </RouteDialog>
    </BentoGrid>
  );
}
