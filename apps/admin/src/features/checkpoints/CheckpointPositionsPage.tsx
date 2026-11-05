import { FormEvent, useEffect, useState } from "react";
import {
  CHECKPOINT_CONFIDENCES,
  type ApiClient,
  type ApiError,
  type CheckpointConfidence,
  type CheckpointPosition,
  type CheckpointPositionDraft,
  type CheckpointPositionUpdate,
  type UnplacedCheckpointsResponse
} from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import type { TranslationKey } from "../../i18n/translations";
import { BentoGrid, Button, Card, CardHeader, DataTable, EmptyState, Notice, Skeleton, StatusBadge, TechnicalValue, type Column, type Tone } from "../../ui";
import { RouteDialog } from "../routes/RouteDialog";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { Pager } from "../shared/Pager";
import { useDebouncedValue, usePagedList } from "../shared/usePagedList";

export const CHECKPOINT_POSITIONS_PAGE_SIZE = 50;
/** Same box the API enforces: the West Bank with a small margin. */
export const WEST_BANK_BOUNDS = { minLatitude: 31.3, maxLatitude: 32.6, minLongitude: 34.85, maxLongitude: 35.6 } as const;

export type CheckpointPositionsApi = Pick<
  ApiClient,
  "checkpointPositions" | "createCheckpointPosition" | "updateCheckpointPosition" | "deleteCheckpointPosition" | "unplacedCheckpoints"
>;

export type PositionForm = {
  city_ar: string;
  name_ar: string;
  latitude: string;
  longitude: string;
  confidence: CheckpointConfidence;
  source: string;
  note: string;
};

export type PositionFormError = "names" | "source" | "coordinates" | "outside_area";

const confidenceTone: Record<CheckpointConfidence, Tone> = { high: "success", medium: "info", low: "warning", unverified: "neutral" };

export function emptyPositionForm(city = "", name = ""): PositionForm {
  return { city_ar: city, name_ar: name, latitude: "", longitude: "", confidence: "unverified", source: "", note: "" };
}

export function insideWestBank(latitude: number, longitude: number) {
  return latitude >= WEST_BANK_BOUNDS.minLatitude && latitude <= WEST_BANK_BOUNDS.maxLatitude
    && longitude >= WEST_BANK_BOUNDS.minLongitude && longitude <= WEST_BANK_BOUNDS.maxLongitude;
}

function parseCoordinate(value: string) {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Checks a form the way the API will, so most mistakes are caught before sending. */
export function validatePositionForm(form: PositionForm, mode: "create" | "edit"): PositionFormError | null {
  if (mode === "create" && (form.city_ar.trim().length < 2 || form.name_ar.trim().length < 2)) return "names";
  if (mode === "create" && form.source.trim().length < 2) return "source";
  const latitude = parseCoordinate(form.latitude);
  const longitude = parseCoordinate(form.longitude);
  if (latitude === null || longitude === null) return "coordinates";
  if (!insideWestBank(latitude, longitude)) return "outside_area";
  return null;
}

export function positionDraftFrom(form: PositionForm): CheckpointPositionDraft {
  return {
    city_ar: form.city_ar.trim(),
    name_ar: form.name_ar.trim(),
    latitude: Number(form.latitude.trim()),
    longitude: Number(form.longitude.trim()),
    confidence: form.confidence,
    source: form.source.trim(),
    note: form.note.trim() || null
  };
}

/** Only the fields that differ from the stored position. */
export function positionUpdateFrom(form: PositionForm, current: CheckpointPosition): CheckpointPositionUpdate {
  const update: CheckpointPositionUpdate = {};
  const latitude = Number(form.latitude.trim());
  const longitude = Number(form.longitude.trim());
  const note = form.note.trim() || null;
  if (latitude !== current.latitude) update.latitude = latitude;
  if (longitude !== current.longitude) update.longitude = longitude;
  if (form.confidence !== current.confidence) update.confidence = form.confidence;
  if (note !== current.note) update.note = note;
  return update;
}

function formErrorKey(error: PositionFormError): TranslationKey {
  return `checkpointPositionError_${error}`;
}

function apiErrorKey(error: unknown): TranslationKey {
  const code = (error as ApiError | undefined)?.message;
  if (code === "checkpoint_position_exists") return "checkpointPositionError_exists";
  if (code === "checkpoint_position_not_found") return "checkpointPositionError_missing";
  if ((error as ApiError | undefined)?.status === 400) return "checkpointPositionError_invalid";
  return "checkpointPositionError_failed";
}

function PositionFormFields({ form, mode, busy, onChange }: { form: PositionForm; mode: "create" | "edit"; busy: boolean; onChange: (form: PositionForm) => void }) {
  const { t } = useLocale();
  return (
    <div className="field-grid">
      <label className="field">{t("checkpointPositionCity")}
        <input name="city_ar" dir="rtl" required maxLength={100} disabled={busy || mode === "edit"} value={form.city_ar} onChange={(event) => onChange({ ...form, city_ar: event.target.value })} />
      </label>
      <label className="field">{t("checkpointPositionName")}
        <input name="name_ar" dir="rtl" required maxLength={191} disabled={busy || mode === "edit"} value={form.name_ar} onChange={(event) => onChange({ ...form, name_ar: event.target.value })} />
      </label>
      <label className="field">{t("latitude")}
        <input name="latitude" className="technical-value" dir="ltr" inputMode="decimal" required disabled={busy} value={form.latitude} placeholder="31.9038" onChange={(event) => onChange({ ...form, latitude: event.target.value })} />
      </label>
      <label className="field">{t("longitude")}
        <input name="longitude" className="technical-value" dir="ltr" inputMode="decimal" required disabled={busy} value={form.longitude} placeholder="35.2034" onChange={(event) => onChange({ ...form, longitude: event.target.value })} />
      </label>
      <label className="field">{t("checkpointPositionConfidence")}
        <select name="confidence" disabled={busy} value={form.confidence} onChange={(event) => onChange({ ...form, confidence: event.target.value as CheckpointConfidence })}>
          {CHECKPOINT_CONFIDENCES.map((value) => <option key={value} value={value}>{t(`checkpointConfidence_${value}`)}</option>)}
        </select>
      </label>
      {mode === "create" && (
        <label className="field">{t("checkpointPositionSource")}
          <input name="source" maxLength={100} required disabled={busy} value={form.source} onChange={(event) => onChange({ ...form, source: event.target.value })} />
        </label>
      )}
      <label className="field">{t("checkpointPositionNote")}
        <input name="note" maxLength={500} disabled={busy} value={form.note} onChange={(event) => onChange({ ...form, note: event.target.value })} />
      </label>
    </div>
  );
}

/**
 * Researched map positions for partner checkpoints the OpenStreetMap data
 * cannot place by name. The passenger and driver maps use these pins first.
 */
export function CheckpointPositionsPage({ api, token, search }: { api: CheckpointPositionsApi; token: string; search: string }) {
  const { t, number, dateTime, direction } = useLocale();
  const query = useDebouncedValue(search.trim());
  const [editor, setEditor] = useState<{ mode: "create" | "edit"; position: CheckpointPosition | null; form: PositionForm } | null>(null);
  const [formError, setFormError] = useState<TranslationKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<CheckpointPosition | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unplaced, setUnplaced] = useState<UnplacedCheckpointsResponse | null>(null);
  const [unplacedPhase, setUnplacedPhase] = useState<"loading" | "ready" | "error">("loading");

  const list = usePagedList<CheckpointPosition>(async (page) => {
    const result = await api.checkpointPositions(token, { search: query, page, limit: CHECKPOINT_POSITIONS_PAGE_SIZE });
    return { items: result.positions, total: result.total };
  }, [token, query]);

  async function loadUnplaced() {
    setUnplacedPhase("loading");
    try {
      setUnplaced(await api.unplacedCheckpoints(token));
      setUnplacedPhase("ready");
    } catch {
      setUnplacedPhase("error");
    }
  }

  useEffect(() => { void loadUnplaced(); }, [api, token]);

  function openCreate(city = "", name = "") {
    setNotice(null);
    setFormError(null);
    setEditor({ mode: "create", position: null, form: emptyPositionForm(city, name) });
  }

  function openEdit(position: CheckpointPosition) {
    setNotice(null);
    setFormError(null);
    setEditor({
      mode: "edit",
      position,
      form: {
        city_ar: position.city_ar,
        name_ar: position.name_ar,
        latitude: String(position.latitude),
        longitude: String(position.longitude),
        confidence: position.confidence,
        source: position.source,
        note: position.note ?? ""
      }
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editor) return;
    const invalid = validatePositionForm(editor.form, editor.mode);
    if (invalid) {
      setFormError(formErrorKey(invalid));
      return;
    }
    const update = editor.position ? positionUpdateFrom(editor.form, editor.position) : null;
    if (update && Object.keys(update).length === 0) {
      setEditor(null);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editor.mode === "create") await api.createCheckpointPosition(token, positionDraftFrom(editor.form));
      else await api.updateCheckpointPosition(token, editor.position!.id, update!);
      setNotice(t(editor.mode === "create" ? "checkpointPositionCreated" : "checkpointPositionUpdated"));
      setEditor(null);
      await Promise.all([list.reload(), editor.mode === "create" ? loadUnplaced() : Promise.resolve()]);
    } catch (error) {
      setFormError(apiErrorKey(error));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setSaving(true);
    setDeleteError(null);
    try {
      await api.deleteCheckpointPosition(token, deleting.id);
      setNotice(t("checkpointPositionDeleted"));
      setDeleting(null);
      await Promise.all([list.reload(), loadUnplaced()]);
    } catch (error) {
      setDeleteError(t(apiErrorKey(error)));
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<CheckpointPosition>[] = [
    {
      key: "checkpoint",
      header: t("checkpointPositionColumnCheckpoint"),
      cell: (position) => (
        <div dir="rtl">
          <p className="cell-stack__title">{position.name_ar}</p>
          <p className="cell-stack__sub">{position.city_ar}</p>
        </div>
      )
    },
    {
      key: "coordinates",
      header: t("checkpointPositionColumnCoordinates"),
      cell: (position) => <TechnicalValue>{`${position.latitude.toFixed(6)}, ${position.longitude.toFixed(6)}`}</TechnicalValue>
    },
    {
      key: "confidence",
      header: t("checkpointPositionConfidence"),
      cell: (position) => <StatusBadge tone={confidenceTone[position.confidence]}>{t(`checkpointConfidence_${position.confidence}`)}</StatusBadge>
    },
    {
      key: "source",
      header: t("checkpointPositionSource"),
      cell: (position) => (
        <div>
          <p className="cell-stack__title">{position.source}</p>
          {position.note && <p className="cell-stack__sub">{position.note}</p>}
        </div>
      )
    },
    { key: "updated", header: t("checkpointPositionColumnUpdated"), cell: (position) => dateTime(position.updated_at) },
    {
      key: "actions",
      header: t("columnActions"),
      align: "end",
      cell: (position) => (
        <div className="button-row">
          <Button size="sm" variant="outline" disabled={saving} onClick={() => openEdit(position)}>{t("checkpointPositionEdit")}</Button>
          <Button size="sm" variant="destructive" disabled={saving} onClick={() => { setNotice(null); setDeleteError(null); setDeleting(position); }}>{t("checkpointPositionDelete")}</Button>
        </div>
      )
    }
  ];

  return (
    <BentoGrid>
      <Card span={12} padded={false}>
        <CardHeader
          title={t("checkpointPositionsTitle")}
          badge={list.loaded ? <StatusBadge tone="info">{number(list.total)}</StatusBadge> : undefined}
          action={
            <div className="button-row">
              <Button variant="ghost" size="sm" icon="refresh" disabled={list.phase === "loading"} onClick={() => void list.reload()}>{t("refreshData")}</Button>
              <Button variant="primary" size="sm" icon="add" onClick={() => openCreate()}>{t("checkpointPositionAdd")}</Button>
            </div>
          }
        />
        {notice && <Notice kind="success">{notice}</Notice>}
        {!list.loaded && list.phase === "loading" && <div className="overview-resource-state" role="status" aria-label={t("metricLoading")}><Skeleton lines={4} /></div>}
        {!list.loaded && list.phase === "error" && (
          <EmptyState
            compact
            icon="report"
            title={t("checkpointPositionsLoadFailed")}
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
              rowKey={(position) => position.id}
              empty={<EmptyState compact icon="location_on" title={query ? t("searchNoResults") : t("checkpointPositionsEmpty")} />}
            />
            <Pager page={list.page} total={list.total} limit={CHECKPOINT_POSITIONS_PAGE_SIZE} disabled={list.phase === "loading"} onPage={list.setPage} />
          </>
        )}
      </Card>

      <Card span={12}>
        <CardHeader
          title={t("unplacedCheckpointsTitle")}
          badge={unplaced?.available ? <StatusBadge tone={unplaced.unplaced.length ? "warning" : "success"}>{number(unplaced.unplaced.length)}</StatusBadge> : undefined}
          action={<Button variant="ghost" size="sm" icon="refresh" disabled={unplacedPhase === "loading"} onClick={() => void loadUnplaced()}>{t("refreshData")}</Button>}
        />
        {unplacedPhase === "loading" && <div className="overview-resource-state" role="status" aria-label={t("metricLoading")}><Skeleton lines={2} /></div>}
        {unplacedPhase === "error" && <p className="overview-resource-note overview-resource-note--error" role="alert">{t("metricLoadError")}</p>}
        {unplacedPhase === "ready" && unplaced && !unplaced.available && <p className="muted">{t("unplacedCheckpointsUnavailable")}</p>}
        {unplacedPhase === "ready" && unplaced?.available && unplaced.unplaced.length === 0 && <EmptyState compact icon="check" title={t("unplacedCheckpointsNone")} />}
        {unplacedPhase === "ready" && unplaced?.available && unplaced.unplaced.length > 0 && (
          <div className="card__list">
            {unplaced.unplaced.map((row) => (
              <div className="card__row" key={row.id}>
                <div dir="rtl"><p className="card__row-title">{row.name_ar}</p><p className="card__row-detail">{row.city_ar} · {t(`unplacedReason_${row.reason}`)}</p></div>
                <Button size="sm" variant="secondary" icon="add" onClick={() => openCreate(row.city_ar, row.name_ar)}>{t("checkpointPositionPlace")}</Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <RouteDialog
        open={editor !== null}
        title={editor?.mode === "edit" ? t("checkpointPositionEditTitle") : t("checkpointPositionAddTitle")}
        description={t("checkpointPositionBoundsHint")}
        busy={saving}
        dir={direction}
        onClose={() => { if (!saving) setEditor(null); }}
      >
        {editor && (
          <form className="stack" onSubmit={(event) => void save(event)} noValidate>
            <PositionFormFields form={editor.form} mode={editor.mode} busy={saving} onChange={(form) => { setFormError(null); setEditor({ ...editor, form }); }} />
            {formError && <p role="alert" className="field__error">{t(formError)}</p>}
            <div className="button-row">
              <Button variant="outline" size="sm" disabled={saving} onClick={() => setEditor(null)}>{t("cancel")}</Button>
              <Button type="submit" size="sm" disabled={saving}>{saving ? t("saving") : t("checkpointPositionSave")}</Button>
            </div>
          </form>
        )}
      </RouteDialog>

      <ConfirmDialog
        open={deleting !== null}
        title={t("checkpointPositionDeleteTitle")}
        description={t("checkpointPositionDeleteBody")}
        confirmLabel={t("checkpointPositionDelete")}
        destructive
        busy={saving}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={() => { if (!saving) { setDeleting(null); setDeleteError(null); } }}
      >
        {deleting && <p dir="rtl"><strong>{deleting.name_ar}</strong> · {deleting.city_ar}</p>}
      </ConfirmDialog>
    </BentoGrid>
  );
}
