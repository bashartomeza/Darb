import { useEffect, useState, type FormEvent } from "react";
import type { RouteIdentityDraft } from "../../api";
import { Button, Notice } from "../../ui";
import { RouteDialog } from "./RouteDialog";

type Locale = "ar" | "en";

export type CreateRouteDialogProps = {
  open: boolean;
  locale: Locale;
  busy?: boolean;
  error?: string | null;
  onSubmit: (draft: RouteIdentityDraft) => void | Promise<void>;
  onClose: () => void;
};

const copy = {
  ar: {
    title: "إنشاء مسار",
    description: "أدخل هوية المسار المعتمدة. يمكنك إضافة الإصدارات والمحطات بعد فتحه.",
    routeKey: "مفتاح المسار",
    groupKey: "مجموعة الاتجاهات",
    region: "منطقة الخدمة",
    direction: "الاتجاه",
    outbound: "ذهاب",
    inbound: "عودة",
    loop: "حلقي",
    create: "إنشاء",
    cancel: "إلغاء",
    validation: "أدخل مفتاح المسار ومجموعة الاتجاهات ومنطقة الخدمة."
  },
  en: {
    title: "Create route",
    description: "Enter the approved route identity. You can add versions and stops after opening it.",
    routeKey: "Route key",
    groupKey: "Direction group",
    region: "Service region",
    direction: "Direction",
    outbound: "Outbound",
    inbound: "Inbound",
    loop: "Loop",
    create: "Create route",
    cancel: "Cancel",
    validation: "Enter a route key, direction group, and service region."
  }
} as const;

function emptyDraft(): RouteIdentityDraft {
  return { route_key: "", route_group_key: "", service_region_key: "", direction: "outbound" };
}

export function CreateRouteDialog({ open, locale, busy = false, error, onSubmit, onClose }: CreateRouteDialogProps) {
  const text = copy[locale];
  const [draft, setDraft] = useState<RouteIdentityDraft>(emptyDraft);
  const [validation, setValidation] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setDraft(emptyDraft());
      setValidation(null);
    }
  }, [open]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const route_key = draft.route_key.trim();
    const route_group_key = draft.route_group_key.trim();
    const service_region_key = draft.service_region_key.trim();
    if (!route_key || !route_group_key || !service_region_key) {
      setValidation(text.validation);
      return;
    }
    setValidation(null);
    void onSubmit({ ...draft, route_key, route_group_key, service_region_key });
  }

  return (
    <RouteDialog
      open={open}
      title={text.title}
      description={text.description}
      dir={locale === "ar" ? "rtl" : "ltr"}
      busy={busy}
      onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose} disabled={busy}>{text.cancel}</Button><Button form="create-route-form" type="submit" icon="add" disabled={busy}>{text.create}</Button></>}
    >
      <form id="create-route-form" className="field-grid" onSubmit={submit} noValidate>
        {(validation || error) && <Notice kind="error">{validation || error}</Notice>}
        <label className="field">{text.routeKey}<input name="route_key" className="technical-value" dir="ltr" autoFocus required value={draft.route_key} onChange={(event) => setDraft({ ...draft, route_key: event.target.value })} disabled={busy} /></label>
        <label className="field">{text.groupKey}<input name="route_group_key" className="technical-value" dir="ltr" required value={draft.route_group_key} onChange={(event) => setDraft({ ...draft, route_group_key: event.target.value })} disabled={busy} /></label>
        <label className="field">{text.region}<input name="service_region_key" className="technical-value" dir="ltr" required value={draft.service_region_key} onChange={(event) => setDraft({ ...draft, service_region_key: event.target.value })} disabled={busy} /></label>
        <label className="field">{text.direction}<select name="direction" value={draft.direction} onChange={(event) => setDraft({ ...draft, direction: event.target.value as RouteIdentityDraft["direction"] })} disabled={busy}><option value="outbound">{text.outbound}</option><option value="inbound">{text.inbound}</option><option value="loop">{text.loop}</option></select></label>
      </form>
    </RouteDialog>
  );
}
