import { useEffect, useState, type FormEvent } from "react";
import type { OperatingCityDraft } from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import type { TranslationKey } from "../../i18n/translations";
import { Button, Notice } from "../../ui";
import { RouteDialog } from "../routes/RouteDialog";
import { validateCityForm, type CityForm } from "./operatingRoutesModel";

export type AddCityDialogProps = {
  open: boolean;
  busy: boolean;
  error: TranslationKey | null;
  onSubmit: (draft: OperatingCityDraft) => void;
  onClose: () => void;
};

const emptyForm = (): CityForm => ({ name_ar: "", name_en: "", latitude: "", longitude: "" });

export function AddCityDialog({ open, busy, error, onSubmit, onClose }: AddCityDialogProps) {
  const { t, direction } = useLocale();
  const [form, setForm] = useState<CityForm>(emptyForm);
  const [validation, setValidation] = useState<TranslationKey | null>(null);
  // A server error describes the last submission; hide it once the admin edits the form.
  const [serverErrorVisible, setServerErrorVisible] = useState(true);

  useEffect(() => {
    if (!open) {
      setForm(emptyForm());
      setValidation(null);
    }
  }, [open]);

  function update(field: keyof CityForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setValidation(null);
    setServerErrorVisible(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerErrorVisible(true);
    const result = validateCityForm(form);
    if (!result.ok) {
      setValidation(result.error);
      return;
    }
    onSubmit(result.draft);
  }

  const message = validation ?? (serverErrorVisible ? error : null);

  return (
    <RouteDialog
      open={open}
      title={t("opRoutesAddCity")}
      description={t("opCityDialogDescription")}
      dir={direction}
      busy={busy}
      onClose={onClose}
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={busy}>{t("cancel")}</Button>
        <Button form="add-operating-city-form" type="submit" icon="add" disabled={busy}>{busy ? t("saving") : t("opCityCreate")}</Button>
      </>}
    >
      <form id="add-operating-city-form" className="field-grid operating-routes__form" onSubmit={submit} noValidate>
        {message && <div className="operating-routes__form-wide"><Notice kind="error">{t(message)}</Notice></div>}
        <label className="field">
          {t("opCityNameAr")}
          <input name="name_ar" dir="rtl" lang="ar" autoFocus required maxLength={80} value={form.name_ar} disabled={busy} onChange={(event) => update("name_ar", event.target.value)} />
        </label>
        <label className="field">
          {t("opCityNameEn")}
          <input name="name_en" dir="ltr" lang="en" required maxLength={80} value={form.name_en} disabled={busy} onChange={(event) => update("name_en", event.target.value)} />
        </label>
        <label className="field">
          {t("opCityLatitude")}
          <input name="latitude" className="technical-value" dir="ltr" inputMode="decimal" placeholder="31.5326" required value={form.latitude} disabled={busy} onChange={(event) => update("latitude", event.target.value)} />
        </label>
        <label className="field">
          {t("opCityLongitude")}
          <input name="longitude" className="technical-value" dir="ltr" inputMode="decimal" placeholder="35.0998" required value={form.longitude} disabled={busy} onChange={(event) => update("longitude", event.target.value)} />
        </label>
        <p className="muted operating-routes__form-wide">{t("opCityAreaHint")}</p>
      </form>
    </RouteDialog>
  );
}
