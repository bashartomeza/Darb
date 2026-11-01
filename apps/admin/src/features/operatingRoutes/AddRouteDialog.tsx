import { useEffect, useState, type FormEvent } from "react";
import type { AdminOperatingRoute, OperatingCity, OperatingRouteDraft } from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import type { TranslationKey } from "../../i18n/translations";
import { Button, Notice } from "../../ui";
import { RouteDialog } from "../routes/RouteDialog";
import { cityName, sortCities, validateRouteDraft } from "./operatingRoutesModel";

export type AddRouteDialogProps = {
  open: boolean;
  cities: OperatingCity[];
  citiesFailed: boolean;
  routes: AdminOperatingRoute[];
  busy: boolean;
  error: TranslationKey | null;
  onRetryCities: () => void;
  onSubmit: (draft: OperatingRouteDraft) => void;
  onClose: () => void;
};

const emptyDraft = (): OperatingRouteDraft => ({ origin_city_id: "", destination_city_id: "", both_directions: true });

export function AddRouteDialog({ open, cities, citiesFailed, routes, busy, error, onRetryCities, onSubmit, onClose }: AddRouteDialogProps) {
  const { t, locale, direction } = useLocale();
  const [draft, setDraft] = useState<OperatingRouteDraft>(emptyDraft);
  const [validation, setValidation] = useState<TranslationKey | null>(null);
  // A server error describes the last submission; hide it once the admin edits the form.
  const [serverErrorVisible, setServerErrorVisible] = useState(true);

  useEffect(() => {
    if (!open) {
      setDraft(emptyDraft());
      setValidation(null);
    }
  }, [open]);

  const options = sortCities(cities, locale);
  const origin = cities.find((city) => city.id === draft.origin_city_id);
  const destination = cities.find((city) => city.id === draft.destination_city_id);
  // Arabic names read right-to-left, so "الخليل ← بيت لحم" is Hebron to Bethlehem.
  const arrow = locale === "ar" ? "←" : "→";
  const preview = origin && destination && origin.id !== destination.id
    ? [
        `${cityName(origin, locale)} ${arrow} ${cityName(destination, locale)}`,
        ...(draft.both_directions ? [`${cityName(destination, locale)} ${arrow} ${cityName(origin, locale)}`] : [])
      ]
    : [];

  function update(next: Partial<OperatingRouteDraft>) {
    setDraft((current) => ({ ...current, ...next }));
    setValidation(null);
    setServerErrorVisible(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerErrorVisible(true);
    const problem = validateRouteDraft(draft, routes);
    if (problem) {
      setValidation(problem);
      return;
    }
    onSubmit(draft);
  }

  const message = validation ?? (serverErrorVisible ? error : null);
  const disabled = busy || citiesFailed || cities.length === 0;

  return (
    <RouteDialog
      open={open}
      title={t("opRoutesAddRoute")}
      description={t("opRoutesAddRouteDescription")}
      dir={direction}
      busy={busy}
      onClose={onClose}
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={busy}>{t("cancel")}</Button>
        <Button form="add-operating-route-form" type="submit" icon="add" disabled={disabled}>{busy ? t("saving") : t("opRoutesCreate")}</Button>
      </>}
    >
      <form id="add-operating-route-form" className="field-grid operating-routes__form" onSubmit={submit} noValidate>
        {message && <div className="operating-routes__form-wide"><Notice kind="error">{t(message)}</Notice></div>}
        {citiesFailed && (
          <div className="operating-routes__form-wide">
            <Notice kind="error">{t("opRoutesCitiesFailed")}</Notice>
            <Button size="sm" variant="ghost" icon="refresh" onClick={onRetryCities}>{t("retry")}</Button>
          </div>
        )}
        {!citiesFailed && cities.length === 0 && <p className="muted operating-routes__form-wide">{t("opRoutesNoCities")}</p>}
        <label className="field">
          {t("opRoutesOrigin")}
          <select name="origin_city_id" value={draft.origin_city_id} disabled={disabled} autoFocus onChange={(event) => update({ origin_city_id: event.target.value })}>
            <option value="">{t("opRoutesChooseCity")}</option>
            {options.map((city) => <option key={city.id} value={city.id}>{cityName(city, locale)}</option>)}
          </select>
        </label>
        <label className="field">
          {t("opRoutesDestination")}
          <select name="destination_city_id" value={draft.destination_city_id} disabled={disabled} onChange={(event) => update({ destination_city_id: event.target.value })}>
            <option value="">{t("opRoutesChooseCity")}</option>
            {options.map((city) => (
              <option key={city.id} value={city.id} disabled={city.id === draft.origin_city_id}>{cityName(city, locale)}</option>
            ))}
          </select>
        </label>
        <label className="operating-routes__check operating-routes__form-wide">
          <input
            type="checkbox"
            name="both_directions"
            checked={draft.both_directions}
            disabled={busy}
            onChange={(event) => update({ both_directions: event.target.checked })}
          />
          <span>{t("opRoutesBothDirections")}</span>
        </label>
        {preview.length > 0 && (
          <div className="operating-routes__form-wide operating-routes__preview">
            <p className="muted">{t("opRoutesPreview")}</p>
            <ul>{preview.map((name) => <li key={name}>{name}</li>)}</ul>
          </div>
        )}
      </form>
    </RouteDialog>
  );
}
