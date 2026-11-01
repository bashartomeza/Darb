import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  ApiClient,
  ConsentDocumentType,
  ConsentLocale,
  ConsentRelease,
  ConsentReleaseDraft
} from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import { Button, Card, CardHeader, Notice, StatusBadge, TechnicalValue } from "../../ui";

const identities: Array<{ type: ConsentDocumentType; locale: ConsentLocale }> = [
  { type: "terms", locale: "ar" },
  { type: "terms", locale: "en" },
  { type: "privacy", locale: "ar" },
  { type: "privacy", locale: "en" },
  { type: "adult_self_attestation", locale: "ar" },
  { type: "adult_self_attestation", locale: "en" }
];

const copy = {
  ar: {
    title: "إدارة الموافقات القانونية",
    description: "أنشئ حزمة من ست وثائق، ثم راجعها واعتمدها وفعّلها دون إضافة نص قانوني غير معتمد.",
    ready: "جاهز للتسجيل",
    notReady: "غير جاهز للتسجيل",
    current: "الإصدار الفعّال الحالي",
    noCurrent: "لم يتم توفير محتوى قانوني معتمد وفعّال بعد.",
    releases: "إصدارات الموافقات",
    noReleases: "لا توجد إصدارات. أنشئ مسودة فارغة وأدخل النصوص المعتمدة مستقبلاً.",
    create: "إنشاء مسودة",
    edit: "تعديل المسودة",
    version: "معرّف الإصدار",
    effective: "موعد التفعيل المقصود",
    save: "حفظ المسودة",
    cancel: "إلغاء",
    approve: "تسجيل الاعتماد القانوني",
    activate: "تفعيل الإصدار",
    retire: "إيقاف الإصدار",
    refresh: "تحديث",
    approvalConfirm: "أؤكد أن هذه النصوص الستة حصلت على اعتماد قانوني حقيقي خارج النظام. هل تريد تسجيل الاعتماد؟",
    activationConfirm: "سيصبح هذا الإصدار هو المصدر القانوني الحالي وسيتم إيقاف الإصدار السابق ذرياً. متابعة؟",
    retirementConfirm: "سيؤدي هذا إلى تعطيل التسجيل العام لعدم وجود إصدار فعّال. متابعة؟",
    retirementReason: "اكتب سبب الإيقاف (ثلاثة أحرف على الأقل).",
    stale: "تغير الإصدار منذ فتحه. تم تحديث البيانات؛ راجعها قبل المحاولة مجدداً.",
    saved: "تم حفظ المسودة.",
    approved: "تم تسجيل الاعتماد القانوني.",
    activated: "تم تفعيل الإصدار.",
    retired: "تم إيقاف الإصدار وأصبح التسجيل غير جاهز.",
    approver: "المعتمد",
    approvalTime: "وقت الاعتماد",
    revision: "المراجعة",
    digest: "بصمة SHA-256",
    draft: "مسودة",
    approvedScheduled: "معتمد — بانتظار التفعيل",
    effectiveState: "فعّال",
    retiredState: "متوقف",
    terms: "الشروط",
    privacy: "إشعار الخصوصية",
    adult: "إقرار بلوغ 18 عاماً",
    arabic: "العربية",
    english: "الإنجليزية",
    content: "النص القانوني بنص عادي",
    emptyContent: "لم يُدخل نص معتمد بعد.",
    loadError: "تعذر تحميل إصدارات الموافقات.",
    actionError: "تعذر تنفيذ الإجراء. راجع حالة الإصدار وحاول مجدداً."
  },
  en: {
    title: "Consent management",
    description: "Create one six-document bundle, then review, approve and activate it without introducing unapproved legal wording.",
    ready: "READY for onboarding",
    notReady: "NOT READY for onboarding",
    current: "Current effective release",
    noCurrent: "Approved and effective legal content has not been supplied yet.",
    releases: "Consent releases",
    noReleases: "No releases exist. Create an empty draft and enter future approved content.",
    create: "Create draft",
    edit: "Edit draft",
    version: "Release version",
    effective: "Intended activation time",
    save: "Save draft",
    cancel: "Cancel",
    approve: "Record legal approval",
    activate: "Activate release",
    retire: "Retire release",
    refresh: "Refresh",
    approvalConfirm: "I confirm all six documents already received real-world legal approval. Record that approval in Darb?",
    activationConfirm: "This release will become current and the previous release will be retired atomically. Continue?",
    retirementConfirm: "This will disable public onboarding because no effective release will remain. Continue?",
    retirementReason: "Enter a retirement reason (at least three characters).",
    stale: "This release changed after you opened it. The latest data has been loaded; review it before retrying.",
    saved: "Draft saved.",
    approved: "Legal approval recorded.",
    activated: "Release activated.",
    retired: "Release retired; onboarding is now not ready.",
    approver: "Legal approver",
    approvalTime: "Approval time",
    revision: "Revision",
    digest: "SHA-256 digest",
    draft: "Draft",
    approvedScheduled: "Approved — awaiting activation",
    effectiveState: "Effective",
    retiredState: "Retired",
    terms: "Terms",
    privacy: "Privacy notice",
    adult: "Adult 18+ attestation",
    arabic: "Arabic",
    english: "English",
    content: "Plain-text legal content",
    emptyContent: "No approved content has been entered.",
    loadError: "Consent releases could not be loaded.",
    actionError: "The action could not be completed. Review the release state and try again."
  }
} as const;

function blankDraft(): ConsentReleaseDraft {
  return {
    version: "",
    intended_effective_at: "",
    documents: identities.map((identity) => ({ ...identity, content: "" }))
  };
}

function editableDraft(release: ConsentRelease): ConsentReleaseDraft {
  return {
    version: release.version,
    intended_effective_at: release.intended_effective_at.slice(0, 16),
    documents: identities.map((identity) => ({
      ...identity,
      content: release.documents.find((document) => document.type === identity.type && document.locale === identity.locale)?.content ?? ""
    }))
  };
}

function iso(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error("invalid_effective_time");
  return parsed.toISOString();
}

export function ConsentManagement({
  api,
  token,
  initialReleases = [],
  initialCurrent = null,
  initialReady = false,
  initialDraft
}: {
  api: ApiClient;
  token: string;
  initialReleases?: ConsentRelease[];
  initialCurrent?: ConsentRelease | null;
  initialReady?: boolean;
  initialDraft?: ConsentReleaseDraft;
}) {
  const { locale } = useLocale();
  const text = copy[locale];
  const [releases, setReleases] = useState<ConsentRelease[]>(initialReleases);
  const [current, setCurrent] = useState<ConsentRelease | null>(initialCurrent);
  const [ready, setReady] = useState(initialReady);
  const [editing, setEditing] = useState<ConsentRelease | "new" | null>(initialDraft ? "new" : null);
  const [draft, setDraft] = useState<ConsentReleaseDraft>(initialDraft ?? blankDraft);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const selectedRevision = editing && editing !== "new" ? editing.revision : null;
  const sorted = useMemo(() => [...releases].sort((a, b) => b.created_at.localeCompare(a.created_at)), [releases]);

  async function load() {
    const [list, currentResponse] = await Promise.all([api.consentReleases(token), api.currentConsentRelease(token)]);
    setReleases(list.releases);
    setCurrent(currentResponse.release);
    setReady(currentResponse.ready);
  }

  useEffect(() => {
    let live = true;
    void load().catch(() => live && setNotice({ kind: "error", message: text.loadError }));
    return () => { live = false; };
  }, [api, token]);

  function beginCreate() {
    setEditing("new");
    setDraft(blankDraft());
    setNotice(null);
  }

  function beginEdit(release: ConsentRelease) {
    setEditing(release);
    setDraft(editableDraft(release));
    setNotice(null);
  }

  function updateContent(index: number, content: string) {
    setDraft((value) => ({ ...value, documents: value.documents.map((document, offset) => offset === index ? { ...document, content } : document) }));
  }

  async function perform(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      await load();
      setEditing(null);
      setNotice({ kind: "success", message: success });
    } catch (error) {
      const stale = error instanceof Error && ["consent_release_state_conflict", "transaction_retry_required"].includes(error.message);
      if (stale) await load().catch(() => undefined);
      setNotice({ kind: "error", message: stale ? text.stale : text.actionError });
    } finally {
      setBusy(false);
    }
  }

  function submitDraft(event: FormEvent) {
    event.preventDefault();
    const payload = { ...draft, intended_effective_at: iso(draft.intended_effective_at) };
    if (editing === "new") {
      void perform(() => api.createConsentRelease(token, payload), text.saved);
    } else if (editing && selectedRevision !== null) {
      const { version: _version, ...body } = payload;
      void perform(() => api.updateConsentRelease(token, editing.version, selectedRevision, body), text.saved);
    }
  }

  function approve(release: ConsentRelease) {
    if (!window.confirm(text.approvalConfirm)) return;
    void perform(() => api.approveConsentRelease(token, release.version, release.revision), text.approved);
  }

  function activate(release: ConsentRelease) {
    if (!window.confirm(text.activationConfirm)) return;
    void perform(() => api.activateConsentRelease(token, release.version, release.revision, current?.id ?? null), text.activated);
  }

  function retire(release: ConsentRelease) {
    if (!window.confirm(text.retirementConfirm)) return;
    const reason = window.prompt(text.retirementReason)?.trim();
    if (!reason || reason.length < 3) return;
    void perform(() => api.retireConsentRelease(token, release.version, release.revision, reason), text.retired);
  }

  const stateLabel = (release: ConsentRelease) => release.status === "draft" ? text.draft
    : release.status === "approved" ? text.approvedScheduled
      : release.status === "effective" ? text.effectiveState : text.retiredState;

  return (
    <Card span={12} className="consent-management">
      <CardHeader
        title={text.title}
        badge={<StatusBadge tone={ready ? "success" : "danger"}>{ready ? text.ready : text.notReady}</StatusBadge>}
        action={<div className="button-row"><Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}>{text.refresh}</Button><Button size="sm" onClick={beginCreate} disabled={busy}>{text.create}</Button></div>}
      />
      <p className="muted">{text.description}</p>
      {notice && <Notice kind={notice.kind}>{notice.message}</Notice>}

      <div className="consent-current">
        <strong>{text.current}</strong>
        {current ? <span>{current.version} · {stateLabel(current)}</span> : <span className="muted">{text.noCurrent}</span>}
      </div>

      {editing && (
        <form className="stack" onSubmit={submitDraft}>
          <div className="field-grid">
            <label className="field">{text.version}<input required value={draft.version} disabled={editing !== "new" || busy} pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,49}" onChange={(event) => setDraft((value) => ({ ...value, version: event.target.value }))} /></label>
            <label className="field">{text.effective}<input required type="datetime-local" value={draft.intended_effective_at} disabled={busy} onChange={(event) => setDraft((value) => ({ ...value, intended_effective_at: event.target.value }))} /></label>
          </div>
          <div className="consent-document-grid">
            {draft.documents.map((document, index) => (
              <label className="field consent-document" key={`${document.type}:${document.locale}`}>
                <span>{document.type === "terms" ? text.terms : document.type === "privacy" ? text.privacy : text.adult} — {document.locale === "ar" ? text.arabic : text.english}</span>
                <textarea required dir={document.locale === "ar" ? "rtl" : "ltr"} lang={document.locale} value={document.content} disabled={busy} aria-label={`${text.content}: ${document.type}/${document.locale}`} onChange={(event) => updateContent(index, event.target.value)} />
              </label>
            ))}
          </div>
          <div className="button-row"><Button variant="action" type="submit" disabled={busy}>{text.save}</Button><Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>{text.cancel}</Button></div>
        </form>
      )}

      <div className="stack">
        <h3>{text.releases}</h3>
        {sorted.length === 0 && <p className="muted">{text.noReleases}</p>}
        {sorted.map((release) => (
          <article className="consent-release" key={release.id}>
            <div className="split">
              <div><strong>{release.version}</strong><div className="muted">{text.revision}: {release.revision}</div></div>
              <StatusBadge tone={release.status === "effective" ? "success" : release.status === "approved" ? "info" : release.status === "retired" ? "neutral" : "warning"}>{stateLabel(release)}</StatusBadge>
            </div>
            <div className="consent-release__meta">
              <span>{text.effective}: <TechnicalValue>{new Date(release.intended_effective_at).toLocaleString(locale)}</TechnicalValue></span>
              <span>{text.approver}: <TechnicalValue>{release.legal_approved_by ?? "—"}</TechnicalValue></span>
              <span>{text.approvalTime}: <TechnicalValue>{release.legal_approved_at ? new Date(release.legal_approved_at).toLocaleString(locale) : "—"}</TechnicalValue></span>
            </div>
            <details>
              <summary>{text.releases} · 6</summary>
              <div className="consent-document-grid">
                {release.documents.map((document) => (
                  <div className="consent-document" key={document.id} dir={document.locale === "ar" ? "rtl" : "ltr"}>
                    <strong>{document.type}/{document.locale}</strong>
                    <pre>{document.content || text.emptyContent}</pre>
                    <small>{text.digest}: <TechnicalValue>{document.content_digest}</TechnicalValue></small>
                  </div>
                ))}
              </div>
            </details>
            <div className="button-row">
              {release.status === "draft" && <><Button size="sm" variant="outline" onClick={() => beginEdit(release)} disabled={busy}>{text.edit}</Button><Button size="sm" variant="action" onClick={() => approve(release)} disabled={busy}>{text.approve}</Button></>}
              {release.status === "approved" && <Button size="sm" variant="action" onClick={() => activate(release)} disabled={busy}>{text.activate}</Button>}
              {release.status === "effective" && <Button size="sm" variant="destructive" onClick={() => retire(release)} disabled={busy}>{text.retire}</Button>}
            </div>
          </article>
        ))}
      </div>
    </Card>
  );
}
