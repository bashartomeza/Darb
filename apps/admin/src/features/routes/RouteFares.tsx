import { useCallback, useEffect, useRef, useState } from "react";
import type { RouteFareItem, RouteFaresResponse, RouteFaresUpdate } from "../../api";
import { Button, Card, Notice, Skeleton } from "../../ui";
import { FARE_ITEMS, diffFares, draftsFromCurrent, formatMoney, formatRange, type FareDraft, type FareDrafts } from "./routeFaresModel";

type Locale = "ar" | "en";

export type RouteFaresApi = {
  routeFares: (token: string, routeId: string) => Promise<RouteFaresResponse>;
  setRouteFares: (token: string, routeId: string, body: RouteFaresUpdate) => Promise<RouteFaresResponse>;
};

export const routeFareCopy = {
  ar: {
    title: "الأجرة التقديرية للمسار",
    note: "للعرض فقط: لا تتم معالجة أي مدفوعات في التطبيق. يرى الركاب والسائقون والتجار هذه الأجرة كتقدير يُدفع مباشرة إلى السائق.",
    item: { passenger_seat: "المقعد (للراكب)", parcel_s: "طرد صغير (S)", parcel_m: "طرد متوسط (M)", parcel_l: "طرد كبير (L)" },
    current: "الأجرة الحالية",
    none: "غير محددة",
    amount: "السعر الافتراضي (₪)",
    amountHint: "اتركه فارغًا لسحب الأجرة. حتى منزلتين عشريتين.",
    min: "أقل سعر للسائق (₪)",
    max: "أعلى سعر للسائق (₪)",
    rangeHint: "يختار السائق سعره بين الحدين عند بدء العمل على المسار. اتركهما فارغين ليبقى السعر الافتراضي ثابتًا.",
    range: "نطاق السائق",
    fixed: "ثابت",
    effectiveFrom: "تسري اعتبارًا من (اختياري)",
    effectiveHint: "إن تُرك فارغًا تسري فورًا. الطلبات السابقة لا تتغير أبدًا.",
    reason: "سبب التغيير",
    save: "حفظ الأجرة",
    saved: "تم حفظ الأجرة وتسجيلها في السجل.",
    unchanged: "لا توجد تغييرات للحفظ.",
    invalid: "أدخل مبلغًا صحيحًا بحد أقصى منزلتين عشريتين.",
    rangeInvalid: "أدخل الحدين معًا، بحيث يكون الأقل ≤ السعر الافتراضي ≤ الأعلى.",
    reasonRequired: "سبب التغيير مطلوب (3 أحرف على الأقل).",
    failed: "تعذر حفظ الأجرة. راجع القيم وحاول مرة أخرى.",
    loadFailed: "تعذر تحميل الأجرة.",
    retry: "إعادة المحاولة",
    history: "سجل التغييرات",
    historyEmpty: "لا توجد تغييرات بعد.",
    colItem: "البند",
    colAmount: "المبلغ",
    colRange: "نطاق السائق",
    colFrom: "تسري من",
    colBy: "بواسطة",
    colReason: "السبب",
    withdrawn: "سُحبت"
  },
  en: {
    title: "Estimated route fares",
    note: "Display only: no payment is processed in the app. Passengers, drivers and merchants see this as an estimate paid directly to the driver.",
    item: { passenger_seat: "Seat (per passenger)", parcel_s: "Parcel small (S)", parcel_m: "Parcel medium (M)", parcel_l: "Parcel large (L)" },
    current: "Current fare",
    none: "Not set",
    amount: "Default price (ILS)",
    amountHint: "Leave empty to withdraw the fare. Up to two decimals.",
    min: "Driver minimum (ILS)",
    max: "Driver maximum (ILS)",
    rangeHint: "Drivers pick their own price between these when they go online on the route. Leave both empty to keep the default fixed.",
    range: "Driver range",
    fixed: "Fixed",
    effectiveFrom: "Effective from (optional)",
    effectiveHint: "Empty means immediately. Past requests never change.",
    reason: "Reason for change",
    save: "Save fares",
    saved: "Fares saved and recorded in the history.",
    unchanged: "There are no changes to save.",
    invalid: "Enter a valid amount with at most two decimals.",
    rangeInvalid: "Enter both limits, with minimum ≤ default price ≤ maximum.",
    reasonRequired: "A reason is required (at least 3 characters).",
    failed: "Could not save the fares. Check the values and try again.",
    loadFailed: "Could not load the fares.",
    retry: "Retry",
    history: "Change history",
    historyEmpty: "No changes yet.",
    colItem: "Item",
    colAmount: "Amount",
    colRange: "Driver range",
    colFrom: "Effective from",
    colBy: "By",
    colReason: "Reason",
    withdrawn: "Withdrawn"
  }
} as const;

function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function RouteFares({ api, token, locale, routeId }: { api: RouteFaresApi; token: string; locale: Locale; routeId: string }) {
  const text = routeFareCopy[locale];
  const [data, setData] = useState<RouteFaresResponse | null>(null);
  const [drafts, setDrafts] = useState<FareDrafts | null>(null);
  const [failed, setFailed] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latest.current;
    setFailed(false);
    try {
      const result = await api.routeFares(token, routeId);
      if (request !== latest.current) return;
      setData(result);
      setDrafts(draftsFromCurrent(result.current));
    } catch {
      if (request === latest.current) setFailed(true);
    }
  }, [api, token, routeId]);

  useEffect(() => {
    setData(null);
    setDrafts(null);
    setMessage(null);
    void load();
  }, [load]);

  async function save() {
    if (!data || !drafts || busy) return;
    const diff = diffFares(drafts, data.current);
    if (!diff.ok) return setMessage({ kind: "error", text: diff.invalid.length > 0 ? text.invalid : text.rangeInvalid });
    if (diff.changes.length === 0) return setMessage({ kind: "error", text: text.unchanged });
    if (reason.trim().length < 3) return setMessage({ kind: "error", text: text.reasonRequired });
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.setRouteFares(token, routeId, {
        changes: diff.changes,
        effective_from: toIso(effectiveFrom),
        reason: reason.trim()
      });
      setData(result);
      setDrafts(draftsFromCurrent(result.current));
      setReason("");
      setEffectiveFrom("");
      setMessage({ kind: "success", text: text.saved });
    } catch {
      setMessage({ kind: "error", text: text.failed });
    } finally {
      setBusy(false);
    }
  }

  if (failed && !data) {
    return (
      <Card>
        <p role="alert">{text.loadFailed}</p>
        <Button size="sm" variant="secondary" onClick={() => void load()}>{text.retry}</Button>
      </Card>
    );
  }
  if (!data || !drafts) return <Card><Skeleton /></Card>;

  return (
    <div className="stack" dir={locale === "ar" ? "rtl" : "ltr"} lang={locale}>
      <Card>
        <h3>{text.title}</h3>
        <p className="muted">{text.note}</p>
        {message && <Notice kind={message.kind}>{message.text}</Notice>}
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {FARE_ITEMS.map((item: RouteFareItem) => {
            const current = data.current[item];
            const inputId = `route-fare-${item}`;
            const range = formatRange(current, locale);
            const update = (field: keyof FareDraft, value: string) =>
              setDrafts({ ...drafts, [item]: { ...drafts[item], [field]: value } });
            const field = (key: keyof FareDraft, label: string) => (
              <label key={key} htmlFor={`${inputId}-${key}`}>
                {label}
                <input
                  id={`${inputId}-${key}`}
                  name={`${item}_${key}`}
                  inputMode="decimal"
                  autoComplete="off"
                  dir="ltr"
                  value={drafts[item][key]}
                  aria-describedby={`${inputId}-hint`}
                  onChange={(event) => update(key, event.target.value)}
                />
              </label>
            );
            return (
              <fieldset key={item} className="route-fares__item">
                <legend>
                  <strong>{text.item[item]}</strong>
                  <span className="muted">
                    {" "}
                    {text.current}: {current ? formatMoney(current.amount_minor, locale) : text.none}
                    {current ? ` · ${text.range}: ${range ?? text.fixed}` : ""}
                  </span>
                </legend>
                <div className="route-fares__fields">
                  {field("amount", text.amount)}
                  {field("min", text.min)}
                  {field("max", text.max)}
                </div>
                <span id={`${inputId}-hint`} className="muted">{text.amountHint} {text.rangeHint}</span>
              </fieldset>
            );
          })}
          <label>
            {text.effectiveFrom}
            <input type="datetime-local" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} />
            <span className="muted">{text.effectiveHint}</span>
          </label>
          <label>
            {text.reason}
            <input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
          </label>
          <Button type="submit" disabled={busy}>{text.save}</Button>
        </form>
      </Card>
      <Card>
        <h3>{text.history}</h3>
        {data.history.length === 0 ? (
          <p className="muted">{text.historyEmpty}</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{text.colItem}</th>
                <th scope="col">{text.colAmount}</th>
                <th scope="col">{text.colRange}</th>
                <th scope="col">{text.colFrom}</th>
                <th scope="col">{text.colBy}</th>
                <th scope="col">{text.colReason}</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((row) => (
                <tr key={row.id}>
                  <td>{text.item[row.item]}</td>
                  <td>{row.amount_minor === null ? text.withdrawn : formatMoney(row.amount_minor, locale)}</td>
                  <td>{row.amount_minor === null ? "" : formatRange(row, locale) ?? text.fixed}</td>
                  <td>{new Date(row.effective_from).toLocaleString(locale === "ar" ? "ar-u-nu-latn" : "en")}</td>
                  <td>{row.created_by?.name ?? ""}</td>
                  <td>{row.reason ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
