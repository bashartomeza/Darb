import { FormEvent, useEffect, useState } from "react";
import {
  MAP_PLACE_CATEGORIES,
  type ApiClient,
  type ApiError,
  type MapPlace,
  type MapPlaceDraft,
  type MapPlaceReport,
  type MapPlaceSummary,
  type MapPlaceUpdate
} from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import type { TranslationKey } from "../../i18n/translations";
import { BentoGrid, Button, Card, CardHeader, DataTable, EmptyState, Notice, Skeleton, StatusBadge, TechnicalValue, type Column } from "../../ui";
import { RouteDialog } from "../routes/RouteDialog";
import { Pager } from "../shared/Pager";
import { useDebouncedValue, usePagedList } from "../shared/usePagedList";

export const MAP_PLACES_PAGE_SIZE = 50;
/** Same box the API enforces: the West Bank with a small margin. */
export const WEST_BANK_BOUNDS = { minLatitude: 31.3, maxLatitude: 32.6, minLongitude: 34.85, maxLongitude: 35.6 } as const;

export type MapPlacesApi = Pick<
  ApiClient,
  "mapPlaces" | "mapPlaceSummary" | "createMapPlace" | "updateMapPlace" | "mapPlaceReports" | "reviewMapPlaceReport"
>;

export type PlaceForm = {
  category: string;
  name_ar: string;
  name_en: string;
  latitude: string;
  longitude: string;
  phone: string;
  opening_hours: string;
};

export type PlaceFormError = "names" | "coordinates" | "outside_area" | "phone";

export function emptyPlaceForm(): PlaceForm {
  return { category: MAP_PLACE_CATEGORIES[0], name_ar: "", name_en: "", latitude: "", longitude: "", phone: "", opening_hours: "" };
}

export function placeFormFrom(place: MapPlace): PlaceForm {
  return {
    category: place.category,
    name_ar: place.name_ar ?? "",
    name_en: place.name_en ?? "",
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    phone: place.phone ?? "",
    opening_hours: place.opening_hours ?? ""
  };
}

function parseCoordinate(value: string) {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Checks a form the way the API will, so most mistakes are caught before sending. */
export function validatePlaceForm(form: PlaceForm): PlaceFormError | null {
  if (!form.name_ar.trim() && !form.name_en.trim()) return "names";
  const latitude = parseCoordinate(form.latitude);
  const longitude = parseCoordinate(form.longitude);
  if (latitude === null || longitude === null) return "coordinates";
  if (
    latitude < WEST_BANK_BOUNDS.minLatitude || latitude > WEST_BANK_BOUNDS.maxLatitude ||
    longitude < WEST_BANK_BOUNDS.minLongitude || longitude > WEST_BANK_BOUNDS.maxLongitude
  ) return "outside_area";
  if (form.phone.trim() && !/^[+\d][\d\s().-]{4,30}$/.test(form.phone.trim())) return "phone";
  return null;
}

export function placeDraftFrom(form: PlaceForm): MapPlaceDraft {
  return {
    category: form.category,
    name_ar: form.name_ar.trim() || null,
    name_en: form.name_en.trim() || null,
    latitude: Number(form.latitude.trim()),
    longitude: Number(form.longitude.trim()),
    phone: form.phone.trim() || null,
    opening_hours: form.opening_hours.trim() || null
  };
}

/** Only the fields that differ from the stored place. */
export function placeUpdateFrom(form: PlaceForm, current: MapPlace): MapPlaceUpdate {
  const draft = placeDraftFrom(form);
  const update: MapPlaceUpdate = {};
  if (draft.category !== current.category) update.category = draft.category;
  if (draft.name_ar !== current.name_ar) update.name_ar = draft.name_ar;
  if (draft.name_en !== current.name_en) update.name_en = draft.name_en;
  if (draft.latitude !== current.latitude) update.latitude = draft.latitude;
  if (draft.longitude !== current.longitude) update.longitude = draft.longitude;
  if (draft.phone !== current.phone) update.phone = draft.phone;
  if (draft.opening_hours !== current.opening_hours) update.opening_hours = draft.opening_hours;
  return update;
}

function apiErrorKey(error: unknown): TranslationKey {
  const code = (error as ApiError | undefined)?.message;
  if (code === "map_place_not_found" || code === "map_place_report_not_found") return "mapPlacesError_missing";
  if ((error as ApiError | undefined)?.status === 400) return "mapPlacesError_invalid";
  return "mapPlacesError_failed";
}

function categoryLabelKey(category: string): TranslationKey | null {
  return (MAP_PLACE_CATEGORIES as readonly string[]).includes(category) ? (`mapPlaceCategory_${category}` as TranslationKey) : null;
}

function reasonKey(reason: string): TranslationKey {
  return (`mapPlaceReason_${["closed", "wrong_location", "wrong_info", "not_exists"].includes(reason) ? reason : "other"}`) as TranslationKey;
}

function PlaceFormFields({ form, busy, onChange }: { form: PlaceForm; busy: boolean; onChange: (form: PlaceForm) => void }) {
  const { t } = useLocale();
  return (
    <div className="field-grid">
      <label className="field">{t("mapPlacesCategory")}
        <select name="category" disabled={busy} value={form.category} onChange={(event) => onChange({ ...form, category: event.target.value })}>
          {MAP_PLACE_CATEGORIES.map((value) => <option key={value} value={value}>{t(`mapPlaceCategory_${value}`)}</option>)}
        </select>
      </label>
      <label className="field">{t("mapPlacesNameAr")}
        <input name="name_ar" dir="rtl" maxLength={191} disabled={busy} value={form.name_ar} onChange={(event) => onChange({ ...form, name_ar: event.target.value })} />
      </label>
      <label className="field">{t("mapPlacesNameEn")}
        <input name="name_en" dir="ltr" maxLength={191} disabled={busy} value={form.name_en} onChange={(event) => onChange({ ...form, name_en: event.target.value })} />
      </label>
      <label className="field">{t("latitude")}
        <input name="latitude" className="technical-value" dir="ltr" inputMode="decimal" required disabled={busy} value={form.latitude} placeholder="31.9038" onChange={(event) => onChange({ ...form, latitude: event.target.value })} />
      </label>
      <label className="field">{t("longitude")}
        <input name="longitude" className="technical-value" dir="ltr" inputMode="decimal" required disabled={busy} value={form.longitude} placeholder="35.2034" onChange={(event) => onChange({ ...form, longitude: event.target.value })} />
      </label>
      <label className="field">{t("mapPlacesPhone")}
        <input name="phone" className="technical-value" dir="ltr" maxLength={40} disabled={busy} value={form.phone} onChange={(event) => onChange({ ...form, phone: event.target.value })} />
      </label>
      <label className="field">{t("mapPlacesHours")}
        <input name="opening_hours" className="technical-value" dir="ltr" maxLength={500} disabled={busy} value={form.opening_hours} placeholder="Mo-Sa 08:00-20:00" onChange={(event) => onChange({ ...form, opening_hours: event.target.value })} />
      </label>
    </div>
  );
}

/**
 * The places of interest on the app map (cafes, pharmacies, fuel stations, ...):
 * switch a wrong one off, correct it, add one by hand, and work through the
 * "this place is wrong" reports from the apps. Every change is audited.
 */
export function MapPlacesPage({ api, token, search }: { api: MapPlacesApi; token: string; search: string }) {
  const { t, number, dateTime, direction } = useLocale();
  const query = useDebouncedValue(search.trim());
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState<"" | "true" | "false">("");
  const [editor, setEditor] = useState<{ mode: "create" | "edit"; place: MapPlace | null; form: PlaceForm } | null>(null);
  const [formError, setFormError] = useState<TranslationKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [summary, setSummary] = useState<MapPlaceSummary | null>(null);
  const [reports, setReports] = useState<MapPlaceReport[] | null>(null);

  const list = usePagedList<MapPlace>(async (page) => {
    const result = await api.mapPlaces(token, { search: query, category, active: status || undefined, page, limit: MAP_PLACES_PAGE_SIZE });
    return { items: result.places, total: result.total };
  }, [token, query, category, status]);

  async function loadSide() {
    try {
      const [nextSummary, nextReports] = await Promise.all([api.mapPlaceSummary(token), api.mapPlaceReports(token, { limit: 20 })]);
      setSummary(nextSummary);
      setReports(nextReports.reports);
    } catch {
      setReports((current) => current ?? []);
    }
  }

  useEffect(() => { void loadSide(); }, [api, token]);

  function openCreate() {
    setNotice(null);
    setFormError(null);
    setEditor({ mode: "create", place: null, form: emptyPlaceForm() });
  }

  function openEdit(place: MapPlace) {
    setNotice(null);
    setFormError(null);
    setEditor({ mode: "edit", place, form: placeFormFrom(place) });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editor) return;
    const invalid = validatePlaceForm(editor.form);
    if (invalid) {
      setFormError(`mapPlacesError_${invalid}` as TranslationKey);
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
      if (editor.mode === "create") await api.createMapPlace(token, placeDraftFrom(editor.form));
      else await api.updateMapPlace(token, editor.place!.id, update!);
      setNotice(t(editor.mode === "create" ? "mapPlacesCreated" : "mapPlacesUpdated"));
      setEditor(null);
      await Promise.all([list.reload(), loadSide()]);
    } catch (error) {
      setFormError(apiErrorKey(error));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(place: MapPlace) {
    setSaving(true);
    setNotice(null);
    setErrorNotice(null);
    try {
      await api.updateMapPlace(token, place.id, { active: !place.active });
      setNotice(t("mapPlacesUpdated"));
      await Promise.all([list.reload(), loadSide()]);
    } catch (error) {
      setErrorNotice(t(apiErrorKey(error)));
    } finally {
      setSaving(false);
    }
  }

  async function review(report: MapPlaceReport, status: "resolved" | "dismissed", deactivatePlace: boolean) {
    setSaving(true);
    setNotice(null);
    setErrorNotice(null);
    try {
      await api.reviewMapPlaceReport(token, report.id, { status, ...(deactivatePlace ? { deactivate_place: true } : {}) });
      setNotice(t("mapPlacesReportReviewed"));
      await Promise.all([list.reload(), loadSide()]);
    } catch (error) {
      setErrorNotice(t(apiErrorKey(error)));
    } finally {
      setSaving(false);
    }
  }

  const placeName = (place: MapPlace) => place.name_ar ?? place.name_en ?? place.osm_id ?? place.id;

  const columns: Column<MapPlace>[] = [
    {
      key: "place",
      header: t("mapPlacesColumnPlace"),
      cell: (place) => (
        <div>
          <p className="cell-stack__title" dir={place.name_ar ? "rtl" : "ltr"}>{placeName(place)}</p>
          <p className="cell-stack__sub">{categoryLabelKey(place.category) ? t(categoryLabelKey(place.category)!) : place.category}{place.city ? ` · ${place.city}` : ""}</p>
        </div>
      )
    },
    {
      key: "coordinates",
      header: t("checkpointPositionColumnCoordinates"),
      cell: (place) => <TechnicalValue>{`${place.latitude.toFixed(6)}, ${place.longitude.toFixed(6)}`}</TechnicalValue>
    },
    {
      key: "status",
      header: t("mapPlacesColumnStatus"),
      cell: (place) => <StatusBadge tone={place.active ? "success" : "neutral"}>{place.active ? t("mapPlacesActive") : t("mapPlacesDisabled")}</StatusBadge>
    },
    {
      key: "source",
      header: t("mapPlacesColumnSource"),
      cell: (place) => (
        <div>
          <p className="cell-stack__title">{place.source === "osm" ? "OpenStreetMap" : place.source}</p>
          {place.admin_edited && <p className="cell-stack__sub">{t("mapPlacesEdited")}</p>}
        </div>
      )
    },
    { key: "updated", header: t("checkpointPositionColumnUpdated"), cell: (place) => dateTime(place.updated_at) },
    {
      key: "actions",
      header: t("columnActions"),
      align: "end",
      cell: (place) => (
        <div className="button-row">
          <Button size="sm" variant="outline" disabled={saving} onClick={() => openEdit(place)}>{t("mapPlacesEdit")}</Button>
          <Button size="sm" variant={place.active ? "destructive" : "secondary"} disabled={saving} onClick={() => void toggleActive(place)}>
            {place.active ? t("mapPlacesDisable") : t("mapPlacesEnable")}
          </Button>
        </div>
      )
    }
  ];

  return (
    <BentoGrid>
      <Card span={12}>
        <CardHeader title={t("mapPlacesSummaryTitle")} />
        {!summary && <Skeleton lines={2} />}
        {summary && (
          <div className="card__list">
            {MAP_PLACE_CATEGORIES.map((key) => (
              <div className="card__row" key={key}>
                <p className="card__row-title">{t(`mapPlaceCategory_${key}`)}</p>
                <StatusBadge tone="info">{number(summary.by_category[key]?.active ?? 0)}</StatusBadge>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card span={12} padded={false}>
        <CardHeader
          title={t("mapPlacesTitle")}
          badge={list.loaded ? <StatusBadge tone="info">{number(list.total)}</StatusBadge> : undefined}
          action={
            <div className="button-row">
              <select aria-label={t("mapPlacesCategory")} name="filter_category" value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">{t("mapPlacesAllCategories")}</option>
                {MAP_PLACE_CATEGORIES.map((value) => <option key={value} value={value}>{t(`mapPlaceCategory_${value}`)}</option>)}
              </select>
              <select aria-label={t("mapPlacesColumnStatus")} name="filter_status" value={status} onChange={(event) => setStatus(event.target.value as "" | "true" | "false")}>
                <option value="">{t("mapPlacesAnyStatus")}</option>
                <option value="true">{t("mapPlacesActive")}</option>
                <option value="false">{t("mapPlacesDisabled")}</option>
              </select>
              <Button variant="ghost" size="sm" icon="refresh" disabled={list.phase === "loading"} onClick={() => void list.reload()}>{t("refreshData")}</Button>
              <Button variant="primary" size="sm" icon="add" onClick={openCreate}>{t("mapPlacesAdd")}</Button>
            </div>
          }
        />
        {notice && <Notice kind="success">{notice}</Notice>}
        {errorNotice && <Notice kind="error">{errorNotice}</Notice>}
        {!list.loaded && list.phase === "loading" && <div className="overview-resource-state" role="status" aria-label={t("metricLoading")}><Skeleton lines={4} /></div>}
        {!list.loaded && list.phase === "error" && (
          <EmptyState
            compact
            icon="report"
            title={t("mapPlacesLoadFailed")}
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
              rowKey={(place) => place.id}
              empty={<EmptyState compact icon="location_on" title={query ? t("searchNoResults") : t("mapPlacesEmpty")} />}
            />
            <Pager page={list.page} total={list.total} limit={MAP_PLACES_PAGE_SIZE} disabled={list.phase === "loading"} onPage={list.setPage} />
          </>
        )}
      </Card>

      <Card span={12}>
        <CardHeader title={t("mapPlacesReportsTitle")} badge={reports ? <StatusBadge tone={reports.length ? "warning" : "success"}>{number(reports.length)}</StatusBadge> : undefined} />
        {!reports && <Skeleton lines={2} />}
        {reports && reports.length === 0 && <EmptyState compact icon="check" title={t("mapPlacesReportsNone")} />}
        {reports && reports.length > 0 && (
          <div className="card__list">
            {reports.map((report) => (
              <div className="card__row" key={report.id}>
                <div>
                  <p className="card__row-title" dir={report.place.name_ar ? "rtl" : "ltr"}>{placeName(report.place)}</p>
                  <p className="card__row-detail">{t(reasonKey(report.reason))}{report.note ? ` · ${report.note}` : ""}</p>
                </div>
                <div className="button-row">
                  <Button size="sm" variant="secondary" disabled={saving} onClick={() => void review(report, "resolved", false)}>{t("mapPlacesReportResolve")}</Button>
                  <Button size="sm" variant="destructive" disabled={saving} onClick={() => void review(report, "resolved", true)}>{t("mapPlacesReportDisablePlace")}</Button>
                  <Button size="sm" variant="outline" disabled={saving} onClick={() => void review(report, "dismissed", false)}>{t("mapPlacesReportDismiss")}</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <RouteDialog
        open={editor !== null}
        title={editor?.mode === "edit" ? t("mapPlacesEditTitle") : t("mapPlacesAddTitle")}
        description={t("mapPlacesBoundsHint")}
        busy={saving}
        dir={direction}
        onClose={() => { if (!saving) setEditor(null); }}
      >
        {editor && (
          <form className="stack" onSubmit={(event) => void save(event)} noValidate>
            <PlaceFormFields form={editor.form} busy={saving} onChange={(form) => { setFormError(null); setEditor({ ...editor, form }); }} />
            {formError && <p role="alert" className="field__error">{t(formError)}</p>}
            <div className="button-row">
              <Button variant="outline" size="sm" disabled={saving} onClick={() => setEditor(null)}>{t("cancel")}</Button>
              <Button type="submit" size="sm" disabled={saving}>{saving ? t("saving") : t("mapPlacesSave")}</Button>
            </div>
          </form>
        )}
      </RouteDialog>
    </BentoGrid>
  );
}
