import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { ServiceRoute, ServiceRouteVersion } from "../../api";
import { translations } from "../../i18n/translations";
import { Button } from "../../ui";
import type { PublicationReadinessIssue, RouteLifecycleAction } from "./RouteManagement";
import { RouteDialog } from "./RouteDialog";
import { lifecycleActionRequiresReason, type RouteLifecycleDialogAction } from "./routeManagementModel";

type Locale = "ar" | "en";

type Callback = () => void | Promise<void>;
type ReasonCallback = (reason: string) => void | Promise<void>;

export type RouteActionMenuProps = {
  locale: Locale;
  routeStatus: ServiceRoute["status"];
  version: ServiceRouteVersion | null;
  actions: RouteLifecycleAction[];
  readinessIssues: PublicationReadinessIssue[];
  dialogOpen: boolean;
  busy?: boolean;
  feedback?: string | null;
  onOpenDialog: () => void;
  onCloseDialog: () => void;
  onClone: Callback;
  onPublish: Callback;
  onPause: ReasonCallback;
  onResume: Callback;
  onRetireVersion: ReasonCallback;
  onRetireRoute: ReasonCallback;
};

const copy = {
  ar: {
    clone: "إنشاء إصدار مسودة جديد",
    publish: "نشر",
    pause: "إيقاف مؤقت",
    resume: "استئناف",
    retireVersion: "إحالة للتقاعد",
    retireRoute: "إحالة المسار للتقاعد",
    confirmTitle: "تأكيد إجراء دورة الحياة",
    confirm: "تأكيد",
    cancel: "إلغاء",
    description: "هل تريد تنفيذ هذا الإجراء؟ سيُسجل في سجل التدقيق.",
    reason: "سبب الإجراء",
    reasonRequired: "السبب مطلوب لهذا الإجراء.",
    routeVersionIdLabel: "معرّف إصدار المسار"
  },
  en: {
    clone: "Create new draft version",
    publish: "Publish",
    pause: "Pause",
    resume: "Resume",
    retireVersion: "Retire",
    retireRoute: "Retire route",
    confirmTitle: "Confirm lifecycle action",
    confirm: "Confirm",
    cancel: "Cancel",
    description: "Continue with this action? It will be recorded in the audit log.",
    reason: "Action reason",
    reasonRequired: "A reason is required for this action.",
    routeVersionIdLabel: "Route version ID"
  }
} as const;

export function RouteActionMenu({
  locale,
  routeStatus,
  version,
  actions,
  readinessIssues,
  dialogOpen,
  busy = false,
  feedback,
  onOpenDialog,
  onCloseDialog,
  onClone,
  onPublish,
  onPause,
  onResume,
  onRetireVersion,
  onRetireRoute
}: RouteActionMenuProps) {
  const text = copy[locale];
  const instanceId = useId().replaceAll(":", "");
  const triggerId = `route-action-menu-trigger-${instanceId}`;
  const reasonErrorId = `route-action-reason-error-${instanceId}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState<RouteLifecycleDialogAction | null>(null);
  const [reason, setReason] = useState("");
  const [reasonTouched, setReasonTouched] = useState(false);
  const [reasonAttempted, setReasonAttempted] = useState(false);

  const versionItems: Array<{ action: RouteLifecycleDialogAction; label: string; disabled?: boolean }> = [];
  if (actions.includes("publish")) versionItems.push({ action: "publish", label: text.publish, disabled: readinessIssues.length > 0 });
  if (actions.includes("pause")) versionItems.push({ action: "pause", label: text.pause });
  if (actions.includes("resume")) versionItems.push({ action: "resume", label: text.resume });
  if (actions.includes("clone")) versionItems.push({ action: "clone", label: text.clone });
  if (actions.includes("retire")) versionItems.push({ action: "retire-version", label: text.retireVersion });

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMenuOpen(false);
      triggerRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (dialogOpen) return;
    setPending(null);
    setReason("");
    setReasonTouched(false);
    setReasonAttempted(false);
  }, [dialogOpen]);

  function selectAction(action: RouteLifecycleDialogAction) {
    setPending(action);
    setReason("");
    setReasonTouched(false);
    setReasonAttempted(false);
    setMenuOpen(false);
    triggerRef.current?.focus();
    onOpenDialog();
  }

  function closeDialog() {
    setPending(null);
    setReason("");
    setReasonTouched(false);
    setReasonAttempted(false);
    onCloseDialog();
  }

  function confirmAction() {
    if (!pending) return;
    const suppliedReason = reason.trim();
    if (lifecycleActionRequiresReason(pending) && !suppliedReason) {
      setReasonAttempted(true);
      return;
    }
    if (pending === "clone") void onClone();
    if (pending === "publish") void onPublish();
    if (pending === "pause") void onPause(suppliedReason);
    if (pending === "resume") void onResume();
    if (pending === "retire-version") void onRetireVersion(suppliedReason);
    if (pending === "retire-route") void onRetireRoute(suppliedReason);
    closeDialog();
  }

  function moveMenuFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const target = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? (current + 1 + items.length) % items.length
          : (current - 1 + items.length) % items.length;
    items[target]?.focus();
  }

  const requiresReason = pending ? lifecycleActionRequiresReason(pending) : false;
  const showReasonError = requiresReason && !reason.trim() && (reasonTouched || reasonAttempted);
  const targetsVersion = pending !== null && pending !== "retire-route";

  return (
    <div className="route-action-menu">
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className="btn btn--outline btn--md"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={`${triggerId}-menu`}
        onClick={() => setMenuOpen((current) => !current)}
        disabled={busy}
      >
        <span>{translations[locale].routeActionMenu}</span>
      </button>
      <div
        ref={menuRef}
        id={`${triggerId}-menu`}
        className="route-action-menu__items"
        role="menu"
        aria-labelledby={triggerId}
        hidden={!menuOpen}
        onKeyDown={moveMenuFocus}
      >
        {versionItems.map((item) => (
          <button
            key={item.action}
            type="button"
            role="menuitem"
            data-route-version-action={item.action === "retire-version" ? "retire" : item.action}
            disabled={busy || item.disabled}
            onClick={() => selectAction(item.action)}
          >
            {item.label}
          </button>
        ))}
        {versionItems.length === 0 && <span className="route-action-menu__empty">{locale === "ar" ? "لا توجد إجراءات متاحة للإصدار" : "No version actions available"}</span>}
        {routeStatus === "active" && <>
          <span className="route-action-menu__separator" role="separator" />
          <button type="button" role="menuitem" className="is-destructive" disabled={busy} onClick={() => selectAction("retire-route")}>
            {text.retireRoute}
          </button>
        </>}
      </div>

      <RouteDialog
        open={dialogOpen && pending !== null}
        title={text.confirmTitle}
        description={text.description}
        busy={busy}
        dir={locale === "ar" ? "rtl" : "ltr"}
        onClose={closeDialog}
        footer={
          <>
            <Button variant="outline" onClick={closeDialog} disabled={busy}>{text.cancel}</Button>
            <Button
              variant={pending === "retire-version" || pending === "retire-route" ? "destructive" : "action"}
              onClick={confirmAction}
              disabled={busy}
            >
              {text.confirm}
            </Button>
          </>
        }
      >
        {requiresReason && (
          <label className="field">
            {text.reason}
            <input
              name="reason"
              value={reason}
              maxLength={500}
              required
              autoFocus
              aria-invalid={showReasonError || undefined}
              aria-describedby={showReasonError ? reasonErrorId : undefined}
              onBlur={() => setReasonTouched(true)}
              onChange={(event) => setReason(event.target.value)}
            />
            {showReasonError && <span id={reasonErrorId} className="field__error">{text.reasonRequired}</span>}
          </label>
        )}
        {feedback && <p className="field__error" role="alert">{feedback}</p>}
        {version && targetsVersion && (
          <p>
            {text.routeVersionIdLabel}: <span className="technical-value" dir="ltr">{version.id}</span>
          </p>
        )}
      </RouteDialog>
    </div>
  );
}
