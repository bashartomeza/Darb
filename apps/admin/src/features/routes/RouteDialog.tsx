import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from "react";
import { translations } from "../../i18n/translations";

const focusableSelector = "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";

function focusableElements(dialog: HTMLElement) {
  return [...dialog.querySelectorAll<HTMLElement>(focusableSelector)];
}

function autofocusElement(dialog: HTMLElement) {
  const currentFocus = document.activeElement;
  if (currentFocus instanceof HTMLElement && dialog.contains(currentFocus) && focusableElements(dialog).includes(currentFocus)) {
    return currentFocus;
  }
  return focusableElements(dialog).find((element) =>
    element.hasAttribute("autofocus") || ("autofocus" in element && Boolean((element as HTMLInputElement).autofocus))
  );
}

export type RouteDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
};

type RouteDialogDirectionProps = {
  dir?: "ltr" | "rtl";
};

export function RouteDialog({
  open,
  title,
  description,
  busy = false,
  onClose,
  children,
  footer,
  dir = "ltr"
}: RouteDialogProps & RouteDialogDirectionProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();
  const closeLabel = dir === "rtl" ? translations.ar.routeDialogClose : translations.en.routeDialogClose;
  busyRef.current = busy;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open || typeof document === "undefined") return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (!dialog) return;
    (autofocusElement(dialog) ?? focusableElements(dialog)[0] ?? dialog).focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) onCloseRef.current();
      if (event.key !== "Tab") return;

      const controls = focusableElements(dialog);
      if (controls.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = controls[0];
      const last = controls.at(-1)!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || active === dialog || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open]);

  if (!open) return null;

  function closeFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (!busy && event.target === event.currentTarget) onClose();
  }

  return (
    <div className="route-dialog-backdrop" aria-disabled={busy || undefined} onClick={closeFromBackdrop}>
      <div
        ref={dialogRef}
        className="route-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        dir={dir}
        tabIndex={-1}
      >
        <header className="route-dialog__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId} className="muted">{description}</p>}
          </div>
          <button type="button" className="route-dialog__close" aria-label={closeLabel} disabled={busy} onClick={() => { if (!busy) onClose(); }}>
            {closeLabel}
          </button>
        </header>
        <div className="route-dialog__body">{children}</div>
        {footer && <footer className="route-dialog__footer">{footer}</footer>}
      </div>
    </div>
  );
}
