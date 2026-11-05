import { useEffect, useState, type FormEvent } from "react";
import { ADMIN_CANCELLATION_REASONS, type AdminCancellationReason, type CancellationBody } from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import type { TranslationKey } from "../../i18n/translations";
import { Button, Notice } from "../../ui";
import { RouteDialog } from "../routes/RouteDialog";
import { CANCELLATION_NOTE_MAX, cancellationErrorKey } from "./cancellationModel";

export type CancelDialogProps = {
  open: boolean;
  /** Says exactly what will be cancelled and who is told. */
  subject: string;
  onClose: () => void;
  /** Sends the cancellation; a rejection keeps the dialog open with its error. */
  onConfirm: (body: CancellationBody) => Promise<void>;
};

/**
 * Asks the Admin for a reason (and an optional note) before anything is
 * cancelled. Nothing is sent until "Confirm cancellation" is pressed with a
 * reason chosen.
 */
export function CancelDialog({ open, subject, onClose, onConfirm }: CancelDialogProps) {
  const { t, direction } = useLocale();
  const [reason, setReason] = useState<AdminCancellationReason | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);

  useEffect(() => {
    if (!open) {
      setReason("");
      setNote("");
      setBusy(false);
      setError(null);
    }
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason || busy) return;
    setBusy(true);
    setError(null);
    const trimmed = note.trim();
    try {
      await onConfirm({ reason, ...(trimmed ? { note: trimmed } : {}) });
    } catch (failure) {
      setError(cancellationErrorKey(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <RouteDialog
      open={open}
      title={t("cancelDialogTitle")}
      description={subject}
      dir={direction}
      busy={busy}
      onClose={onClose}
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={busy}>{t("cancelKeep")}</Button>
        <Button form="admin-cancel-form" type="submit" variant="action" icon="block" disabled={busy || !reason}>
          {busy ? t("saving") : t("cancelConfirm")}
        </Button>
      </>}
    >
      <form id="admin-cancel-form" className="field-grid" onSubmit={(event) => void submit(event)} noValidate>
        {error && <Notice kind="error">{t(error)}</Notice>}
        <label className="field">
          {t("cancelReasonLabel")}
          <select name="reason" value={reason} disabled={busy} autoFocus required onChange={(event) => setReason(event.target.value as AdminCancellationReason | "")}>
            <option value="">{t("cancelReasonChoose")}</option>
            {ADMIN_CANCELLATION_REASONS.map((code) => <option key={code} value={code}>{t(`cancelReason_${code}`)}</option>)}
          </select>
        </label>
        <label className="field">
          {t("cancelNoteLabel")}
          <textarea name="note" rows={3} maxLength={CANCELLATION_NOTE_MAX} value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} />
          <span className="muted">{t("cancelNoteHint")}</span>
        </label>
      </form>
    </RouteDialog>
  );
}
