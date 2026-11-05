import type { ReactNode } from "react";
import { useLocale } from "../../i18n/LocaleContext";
import { Button } from "../../ui";
import { RouteDialog } from "../routes/RouteDialog";

/** Asks before a destructive or hard-to-undo action. Nothing happens until the admin confirms. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  busy = false,
  destructive = false,
  error,
  children,
  onConfirm,
  onCancel
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  busy?: boolean;
  destructive?: boolean;
  error?: string | null;
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t, direction } = useLocale();
  return (
    <RouteDialog
      open={open}
      title={title}
      description={description}
      busy={busy}
      dir={direction}
      onClose={onCancel}
      footer={
        <div className="button-row">
          <Button variant="outline" size="sm" disabled={busy} onClick={onCancel}>{t("cancel")}</Button>
          <Button variant={destructive ? "destructive" : "primary"} size="sm" disabled={busy} onClick={onConfirm}>
            {busy ? t("saving") : confirmLabel}
          </Button>
        </div>
      }
    >
      {children}
      {error && <p role="alert" className="field__error">{error}</p>}
    </RouteDialog>
  );
}
