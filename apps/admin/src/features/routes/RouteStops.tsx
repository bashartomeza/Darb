import { type FormEvent, useMemo, useState } from "react";
import type { CanonicalStop, CanonicalStopDraft, RouteStopDraft, ServiceRouteVersion } from "../../api";
import { Button, Card, CardHeader, EmptyState, Notice, StatusBadge } from "../../ui";
import { RouteDialog } from "./RouteDialog";
import { StopEditor } from "./StopEditor";
import {
  moveRouteStop,
  removeRouteStop,
  toggleRouteStopPermission,
  type RouteStopPermission
} from "./routeManagementModel";

type Locale = "ar" | "en";
type Feedback = { kind: "success" | "error"; text: string } | null;
type MutationResult = void | boolean | Promise<void | boolean>;
type SaveOrderResult = void | Promise<void>;
type StopCreationDraft = Omit<CanonicalStopDraft, "latitude" | "longitude"> & {
  latitude: string;
  longitude: string;
};

export type StopDialogMode = "add-stop" | "create-stop" | "edit-stop" | null;

export type RouteStopsProps = {
  locale: Locale;
  version: ServiceRouteVersion | null;
  memberships: RouteStopDraft[];
  stops: CanonicalStop[];
  usedStopIds: ReadonlySet<string>;
  busy: boolean;
  feedback: Feedback;
  dialogFeedback: Feedback;
  dialog: StopDialogMode;
  selectedStopId: string | null;
  onOpenDialog: (dialog: Exclude<StopDialogMode, null>, stopId?: string) => void;
  onCloseDialog: () => void;
  onMembershipsChange: (memberships: RouteStopDraft[]) => void;
  onSaveOrder: (memberships: RouteStopDraft[]) => SaveOrderResult;
  onCreateStop: (draft: CanonicalStopDraft) => MutationResult;
  onEditStop: (id: string, draft: CanonicalStopDraft) => MutationResult;
  onRetireStop: (stop: CanonicalStop, reason: string) => MutationResult;
};

const permissionKeys: RouteStopPermission[] = [
  "passenger_pickup_allowed",
  "passenger_dropoff_allowed",
  "parcel_pickup_allowed",
  "parcel_dropoff_allowed"
];

const copy = {
  ar: {
    title: "ترتيب المحطات والصلاحيات",
    catalog: "كتالوج المحطات",
    addExisting: "إضافة محطة موجودة",
    createNew: "إنشاء محطة جديدة",
    create: "إنشاء المحطة",
    edit: "تعديل",
    editTitle: "تعديل المحطة",
    remove: "إزالة",
    moveUp: "تحريك لأعلى",
    moveDown: "تحريك لأسفل",
    saveOrder: "حفظ الترتيب",
    selectStop: "اختر محطة",
    add: "إضافة",
    noStops: "لا توجد محطات في هذا الإصدار.",
    noAvailableStops: "لا توجد محطات نشطة متاحة للإضافة.",
    passengerPickup: "صعود ركاب",
    passengerDropoff: "نزول ركاب",
    parcelPickup: "استلام طرد",
    parcelDropoff: "تسليم طرد",
    allowed: "مسموح",
    notAllowed: "غير مسموح",
    active: "نشط",
    retired: "متقاعد",
    stopKey: "مفتاح المحطة",
    region: "منطقة الخدمة",
    nameAr: "الاسم بالعربية",
    nameEn: "الاسم بالإنجليزية",
    latitude: "خط العرض",
    longitude: "خط الطول",
    manualCoordinates: "الإحداثيات مُدخلة يدوياً.",
    invalidCoordinates: "أدخل خط عرض صالحاً (-90 إلى 90) وخط طول صالحاً (-180 إلى 180).",
    retire: "إحالة للتقاعد",
    retirementReason: "سبب إحالة المحطة للتقاعد",
    confirmRetirement: "تأكيد الإحالة للتقاعد",
    cancel: "إلغاء",
    confirm: "هل تريد إحالة هذه المحطة للتقاعد؟ سيُسجل الإجراء في سجل التدقيق."
  },
  en: {
    title: "Stop order and permissions",
    catalog: "Stop catalog",
    addExisting: "Add existing stop",
    createNew: "Create new stop",
    create: "Create stop",
    edit: "Edit",
    editTitle: "Edit stop",
    remove: "Remove",
    moveUp: "Move up",
    moveDown: "Move down",
    saveOrder: "Save order",
    selectStop: "Select a stop",
    add: "Add",
    noStops: "This version has no stops.",
    noAvailableStops: "No active stops are available to add.",
    passengerPickup: "Passenger pickup",
    passengerDropoff: "Passenger drop-off",
    parcelPickup: "Parcel pickup",
    parcelDropoff: "Parcel drop-off",
    allowed: "Allowed",
    notAllowed: "Not allowed",
    active: "Active",
    retired: "Retired",
    stopKey: "Stop key",
    region: "Service region",
    nameAr: "Arabic name",
    nameEn: "English name",
    latitude: "Latitude",
    longitude: "Longitude",
    manualCoordinates: "Coordinates are supplied manually.",
    invalidCoordinates: "Enter valid latitude (-90 to 90) and longitude (-180 to 180).",
    retire: "Retire",
    retirementReason: "Stop retirement reason",
    confirmRetirement: "Confirm retirement",
    cancel: "Cancel",
    confirm: "Retire this stop? The action will be recorded in the audit log."
  }
} as const;

function emptyStop(): StopCreationDraft {
  return { stop_key: "", service_region_key: "", name_ar: "", name_en: "", latitude: "", longitude: "" };
}

function parseCreationDraft(draft: StopCreationDraft): CanonicalStopDraft | null {
  if (!draft.latitude.trim() || !draft.longitude.trim()) return null;
  const latitude = Number(draft.latitude);
  const longitude = Number(draft.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  return { ...draft, latitude, longitude };
}

function stopForMembership(version: ServiceRouteVersion | null, stops: CanonicalStop[], stopId: string) {
  return stops.find((stop) => stop.id === stopId)
    ?? version?.stops.find((membership) => membership.stop_id === stopId)?.stop
    ?? null;
}

function permissionLabel(locale: Locale, permission: RouteStopPermission) {
  const text = copy[locale];
  if (permission === "passenger_pickup_allowed") return text.passengerPickup;
  if (permission === "passenger_dropoff_allowed") return text.passengerDropoff;
  if (permission === "parcel_pickup_allowed") return text.parcelPickup;
  return text.parcelDropoff;
}

function stopControlLabel(locale: Locale, label: string, sequence: number) {
  return locale === "ar" ? `${label} للمحطة ${sequence}` : `${label} stop ${sequence}`;
}

export function RouteStops({
  locale,
  version,
  memberships,
  stops,
  usedStopIds,
  busy,
  feedback,
  dialogFeedback,
  dialog,
  selectedStopId,
  onOpenDialog,
  onCloseDialog,
  onMembershipsChange,
  onSaveOrder,
  onCreateStop,
  onEditStop,
  onRetireStop
}: RouteStopsProps) {
  const text = copy[locale];
  const editableMemberships = version?.status === "draft";
  const [stopToAdd, setStopToAdd] = useState("");
  const [createDraft, setCreateDraft] = useState<StopCreationDraft>(emptyStop);
  const [createCoordinatesInvalid, setCreateCoordinatesInvalid] = useState(false);
  const [retiringStopId, setRetiringStopId] = useState<string | null>(null);
  const [retirementReason, setRetirementReason] = useState("");
  const selectedIds = useMemo(() => new Set(memberships.map((membership) => membership.stop_id)), [memberships]);
  const availableStops = stops.filter((stop) => stop.status === "active" && !selectedIds.has(stop.id));
  const selectedStop = selectedStopId
    ? stopForMembership(version, stops, selectedStopId)
    : null;

  function openDialog(nextDialog: Exclude<StopDialogMode, null>, stopId?: string) {
    setStopToAdd("");
    if (nextDialog === "create-stop") {
      setCreateDraft(emptyStop());
      setCreateCoordinatesInvalid(false);
    }
    onOpenDialog(nextDialog, stopId);
  }

  function addExisting(event: FormEvent) {
    event.preventDefault();
    if (!stopToAdd || selectedIds.has(stopToAdd)) return;
    const next = [
      ...memberships,
      {
        stop_id: stopToAdd,
        sequence: memberships.length + 1,
        passenger_pickup_allowed: memberships.length === 0,
        passenger_dropoff_allowed: false,
        parcel_pickup_allowed: memberships.length === 0,
        parcel_dropoff_allowed: false
      }
    ];
    onMembershipsChange(next);
    setStopToAdd("");
    onCloseDialog();
  }

  async function createStop(event: FormEvent) {
    event.preventDefault();
    const parsedDraft = parseCreationDraft(createDraft);
    if (!parsedDraft) {
      setCreateCoordinatesInvalid(true);
      return;
    }
    const saved = await onCreateStop(parsedDraft);
    if (!saved) return;
    setCreateDraft(emptyStop());
    setCreateCoordinatesInvalid(false);
    onCloseDialog();
  }

  async function editStop(id: string, draft: CanonicalStopDraft) {
    const saved = await onEditStop(id, draft);
    if (saved) onCloseDialog();
    return saved;
  }

  async function retireStop(event: FormEvent, stop: CanonicalStop) {
    event.preventDefault();
    const reason = retirementReason.trim();
    if (!reason) return;
    const retired = await onRetireStop(stop, reason);
    if (!retired) return;
    setRetiringStopId(null);
    setRetirementReason("");
  }

  function editButton(stop: CanonicalStop) {
    if (stop.status !== "active" || usedStopIds.has(stop.id)) return null;
    return <Button variant="outline" size="sm" disabled={busy} onClick={() => openDialog("edit-stop", stop.id)}>{text.edit}</Button>;
  }

  return <div className="route-stops stack">
    <Card className="route-stops__order">
      <CardHeader
        title={text.title}
        action={<div className="button-row route-stops__primary-actions">
          {editableMemberships && <Button variant="secondary" size="sm" icon="add" disabled={busy} onClick={() => openDialog("add-stop")}>{text.addExisting}</Button>}
          <Button variant="outline" size="sm" icon="add" disabled={busy} onClick={() => openDialog("create-stop")}>{text.createNew}</Button>
        </div>}
      />
      {feedback && <Notice kind={feedback.kind}>{feedback.text}</Notice>}
      {memberships.length === 0 && <EmptyState compact icon="location_on" title={text.noStops} />}
      <ol className="route-stops__list">
        {memberships.map((membership, index) => {
          const stop = stopForMembership(version, stops, membership.stop_id);
          const sequence = index + 1;
          return <li className="route-stops__item" data-stop-id={membership.stop_id} key={membership.stop_id}>
            <div className="route-stops__item-header">
              <StatusBadge tone="info">{sequence}</StatusBadge>
              <div className="route-stops__identity">
                {stop ? <>
                  <strong dir="rtl">{stop.name_ar}</strong>
                  <span dir="ltr">{stop.name_en}</span>
                  <span className="technical-value" dir="ltr">{stop.stop_key}</span>
                </> : <strong className="technical-value" dir="ltr">{membership.stop_id}</strong>}
              </div>
              {stop && <StatusBadge status={stop.status}>{stop.status === "active" ? text.active : text.retired}</StatusBadge>}
              <div className="button-row route-stops__row-actions">
                {stop && editButton(stop)}
                {editableMemberships && <>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={stopControlLabel(locale, text.moveUp, sequence)}
                    disabled={index === 0 || busy}
                    onClick={() => onMembershipsChange(moveRouteStop(memberships, index, -1))}
                  >{text.moveUp}</Button>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={stopControlLabel(locale, text.moveDown, sequence)}
                    disabled={index === memberships.length - 1 || busy}
                    onClick={() => onMembershipsChange(moveRouteStop(memberships, index, 1))}
                  >{text.moveDown}</Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    aria-label={stopControlLabel(locale, text.remove, sequence)}
                    disabled={busy}
                    onClick={() => onMembershipsChange(removeRouteStop(memberships, index))}
                  >{text.remove}</Button>
                </>}
              </div>
            </div>
            <div className="route-stops__permissions">
              {permissionKeys.map((permission) => editableMemberships
                ? <label key={permission}>
                    <input
                      type="checkbox"
                      checked={membership[permission]}
                      disabled={busy}
                      onChange={() => onMembershipsChange(toggleRouteStopPermission(memberships, index, permission))}
                    />
                    <span>{permissionLabel(locale, permission)}</span>
                  </label>
                : <span className="route-stops__permission-summary" key={permission}>
                    <span>{permissionLabel(locale, permission)}</span>
                    <b>{membership[permission] ? text.allowed : text.notAllowed}</b>
                  </span>
              )}
            </div>
          </li>;
        })}
      </ol>
      {editableMemberships && <div className="route-stops__save">
        <Button icon="check" disabled={memberships.length < 2 || busy} onClick={() => void onSaveOrder(memberships)}>{text.saveOrder}</Button>
      </div>}
    </Card>

    <Card className="route-stops__catalog">
      <CardHeader title={text.catalog} />
      <div className="route-stops__catalog-list">
        {stops.map((stop) => {
          const canRetire = stop.status === "active";
          const canEdit = canRetire && !usedStopIds.has(stop.id);
          return <article className="route-stops__catalog-item" data-stop-id={stop.id} key={stop.id}>
            <div className="route-stops__catalog-summary">
              <div className="route-stops__identity">
                <strong dir="rtl">{stop.name_ar}</strong>
                <span dir="ltr">{stop.name_en}</span>
                <span className="technical-value" dir="ltr">{stop.stop_key}</span>
              </div>
              <StatusBadge status={stop.status}>{stop.status === "active" ? text.active : text.retired}</StatusBadge>
              {canRetire && <div className="button-row route-stops__catalog-actions">
                {canEdit && editButton(stop)}
                <Button variant="destructive" size="sm" disabled={busy} onClick={() => {
                  setRetiringStopId(stop.id);
                  setRetirementReason("");
                }}>{text.retire}</Button>
              </div>}
            </div>
            {canRetire && retiringStopId === stop.id && <form className="route-stops__retirement" onSubmit={(event) => void retireStop(event, stop)}>
              <p className="muted">{text.confirm}</p>
              <label className="field">{text.retirementReason}<input required maxLength={500} value={retirementReason} disabled={busy} onChange={(event) => setRetirementReason(event.target.value)} /></label>
              <div className="button-row">
                <Button variant="outline" size="sm" disabled={busy} onClick={() => setRetiringStopId(null)}>{text.cancel}</Button>
                <Button type="submit" variant="destructive" size="sm" disabled={busy || !retirementReason.trim()}>{text.confirmRetirement}</Button>
              </div>
            </form>}
          </article>;
        })}
      </div>
    </Card>

    <RouteDialog
      open={dialog === "add-stop"}
      title={text.addExisting}
      busy={busy}
      dir={locale === "ar" ? "rtl" : "ltr"}
      onClose={onCloseDialog}
    >
      {dialogFeedback && <Notice kind={dialogFeedback.kind}>{dialogFeedback.text}</Notice>}
      <form className="route-stops__add-form" onSubmit={addExisting}>
        {availableStops.length === 0 ? <p className="muted">{text.noAvailableStops}</p> : <label className="field">{text.selectStop}
          <select name="stop_id" required autoFocus value={stopToAdd} disabled={busy} onChange={(event) => setStopToAdd(event.target.value)}>
            <option value="">{text.selectStop}</option>
            {availableStops.map((stop) => <option value={stop.id} key={stop.id}>{locale === "ar" ? stop.name_ar : stop.name_en}</option>)}
          </select>
        </label>}
        <div className="button-row">
          <Button variant="outline" size="sm" disabled={busy} onClick={onCloseDialog}>{text.cancel}</Button>
          <Button type="submit" size="sm" disabled={busy || !stopToAdd}>{text.add}</Button>
        </div>
      </form>
    </RouteDialog>

    <RouteDialog
      open={dialog === "create-stop"}
      title={text.createNew}
      busy={busy}
      dir={locale === "ar" ? "rtl" : "ltr"}
      onClose={onCloseDialog}
    >
      {dialogFeedback && <Notice kind={dialogFeedback.kind}>{dialogFeedback.text}</Notice>}
      <form className="field-grid route-stops__create-form" onSubmit={(event) => void createStop(event)}>
        <p className="muted stop-editor-form__help">{text.manualCoordinates}</p>
        <label className="field">{text.stopKey}<input className="technical-value" name="stop_key" dir="ltr" required disabled={busy} value={createDraft.stop_key} onChange={(event) => setCreateDraft({ ...createDraft, stop_key: event.target.value })} /></label>
        <label className="field">{text.region}<input className="technical-value" name="service_region_key" dir="ltr" required disabled={busy} value={createDraft.service_region_key} onChange={(event) => setCreateDraft({ ...createDraft, service_region_key: event.target.value })} /></label>
        <label className="field">{text.nameAr}<input name="name_ar" dir="rtl" required disabled={busy} value={createDraft.name_ar} onChange={(event) => setCreateDraft({ ...createDraft, name_ar: event.target.value })} /></label>
        <label className="field">{text.nameEn}<input name="name_en" dir="ltr" required disabled={busy} value={createDraft.name_en} onChange={(event) => setCreateDraft({ ...createDraft, name_en: event.target.value })} /></label>
        <label className="field">{text.latitude}<input className="technical-value" name="latitude" type="number" min="-90" max="90" step="0.000001" dir="ltr" required disabled={busy} value={createDraft.latitude} onChange={(event) => {
          setCreateCoordinatesInvalid(false);
          setCreateDraft({ ...createDraft, latitude: event.target.value });
        }} /></label>
        <label className="field">{text.longitude}<input className="technical-value" name="longitude" type="number" min="-180" max="180" step="0.000001" dir="ltr" required disabled={busy} value={createDraft.longitude} onChange={(event) => {
          setCreateCoordinatesInvalid(false);
          setCreateDraft({ ...createDraft, longitude: event.target.value });
        }} /></label>
        {createCoordinatesInvalid && <p className="field__error" role="alert">{text.invalidCoordinates}</p>}
        <div className="button-row">
          <Button variant="outline" size="sm" disabled={busy} onClick={onCloseDialog}>{text.cancel}</Button>
          <Button type="submit" size="sm" disabled={busy}>{text.create}</Button>
        </div>
      </form>
    </RouteDialog>

    <RouteDialog
      open={dialog === "edit-stop" && Boolean(selectedStop)}
      title={text.editTitle}
      busy={busy}
      dir={locale === "ar" ? "rtl" : "ltr"}
      onClose={onCloseDialog}
    >
      {dialogFeedback && <Notice kind={dialogFeedback.kind}>{dialogFeedback.text}</Notice>}
      {selectedStop && <StopEditor
        key={`${selectedStop.id}-${selectedStop.name_ar}-${selectedStop.name_en}-${selectedStop.latitude}-${selectedStop.longitude}`}
        stop={selectedStop}
        used={usedStopIds.has(selectedStop.id)}
        busy={busy}
        locale={locale}
        onSave={editStop}
      />}
    </RouteDialog>
  </div>;
}
