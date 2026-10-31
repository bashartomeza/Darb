import { FormEvent, useEffect, useState } from "react";
import type { ApiClient, ApiError, InvitationRecord, InvitationRole } from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import { BentoGrid, Button, Card, CardHeader, DataTable, EmptyState, Notice, StatusBadge, TechnicalValue, type Column, type Tone } from "../../ui";
import { normalizeContactEmail, normalizeInvitationPhone } from "./validation";

const ROLES: InvitationRole[] = ["passenger", "driver", "merchant"];
const statusTone: Record<InvitationRecord["status"], Tone> = { unused: "info", used: "success", expired: "danger", revoked: "neutral" };

/** Pure so it is testable: an API failure becomes either "feature off" or a translatable message. */
export function classifyInvitationError(error: unknown): "disabled" | "invalid_phone" | "email_in_use" | "not_revocable" | "rate_limited" | "failed" {
  const status = (error as ApiError | undefined)?.status;
  const code = error instanceof Error ? error.message : "";
  if (status === 404 || code === "not_found") return "disabled";
  if (code === "invalid_phone") return "invalid_phone";
  if (code === "invitation_email_in_use") return "email_in_use";
  if (code === "invitation_not_revocable") return "not_revocable";
  if (status === 429 || code === "invitation_rate_limit_exceeded") return "rate_limited";
  return "failed";
}

export function InvitationsPage({
  api,
  token,
  initialDisabled = false,
  initialCode = null
}: {
  api: ApiClient;
  token: string;
  initialDisabled?: boolean;
  initialCode?: string | null;
}) {
  const { t, role, locale } = useLocale();
  const [disabled, setDisabled] = useState(initialDisabled);
  const [items, setItems] = useState<InvitationRecord[]>([]);
  const [loading, setLoading] = useState(!initialDisabled);
  const [roleValue, setRoleValue] = useState<InvitationRole>("passenger");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<{ phone?: boolean; email?: boolean }>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  // Held in component state only, for a single display. Never logged, stored or put in a URL.
  const [code, setCode] = useState<string | null>(initialCode);
  const [copied, setCopied] = useState(false);

  async function load() {
    try {
      const response = await api.adminInvitations(token, { page: 1, limit: 50 });
      setItems(response.invitations);
    } catch (error) {
      if (classifyInvitationError(error) === "disabled") setDisabled(true);
      else setNotice({ kind: "error", message: t("invitationsLoadFailed") });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialDisabled) return;
    void load();
    return () => setCode(null);
  }, [api, token]);

  function fail(error: unknown) {
    const kind = classifyInvitationError(error);
    if (kind === "disabled") {
      setDisabled(true);
      return;
    }
    setNotice({
      kind: "error",
      message: kind === "invalid_phone" ? t("invitationsPhoneInvalid") : kind === "email_in_use" ? t("invitationsEmailInUse") : kind === "not_revocable" ? t("invitationsNotRevocable") : kind === "rate_limited" ? t("invitationsRateLimited") : t("invitationsActionFailed")
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const normalizedPhone = normalizeInvitationPhone(phone);
    const normalizedEmail = normalizeContactEmail(email);
    setErrors({ phone: !normalizedPhone, email: !normalizedEmail });
    setNotice(null);
    if (!normalizedPhone || !normalizedEmail) return;
    setBusy(true);
    try {
      const response = await api.createAdminInvitation(token, { role: roleValue, phone: normalizedPhone, contact_email: normalizedEmail });
      setCode(response.code);
      setCopied(false);
      setPhone("");
      setEmail("");
      await load();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setNotice({ kind: "error", message: t("invitationsCopyFailed") });
    }
  }

  async function revoke(invitation: InvitationRecord) {
    const reason = window.prompt(t("invitationsRevokeReason"))?.trim();
    if (!reason || reason.length < 3) return;
    setBusy(true);
    setNotice(null);
    try {
      await api.revokeAdminInvitation(token, invitation.id, reason);
      setNotice({ kind: "success", message: t("invitationsRevoked") });
      await load();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }

  if (disabled) {
    return (
      <BentoGrid>
        <Card span={12}>
          <EmptyState icon="warning" title={t("invitationsDisabledTitle")} description={t("invitationsDisabledBody")} />
        </Card>
      </BentoGrid>
    );
  }

  const columns: Column<InvitationRecord>[] = [
    { key: "role", header: t("invitationsColRole"), cell: (row) => role(row.role) },
    { key: "phone", header: t("invitationsColPhone"), cell: (row) => <TechnicalValue>{row.phone ?? "—"}</TechnicalValue> },
    { key: "email", header: t("invitationsColEmail"), cell: (row) => <TechnicalValue>{row.contact_email ?? "—"}</TechnicalValue> },
    { key: "status", header: t("invitationsColStatus"), cell: (row) => <StatusBadge tone={statusTone[row.status]}>{t(`invitationStatus_${row.status}`)}</StatusBadge> },
    { key: "expires", header: t("invitationsColExpires"), cell: (row) => new Date(row.expires_at).toLocaleString(locale) },
    {
      key: "actions",
      header: "",
      align: "end",
      cell: (row) => row.status === "unused" || row.status === "used"
        ? <Button size="sm" variant="destructive" onClick={() => void revoke(row)} disabled={busy}>{t("invitationsRevoke")}</Button>
        : null
    }
  ];

  return (
    <BentoGrid>
      <Card span={12}>
        <CardHeader title={t("invitationsCreateTitle")} />
        <p className="muted">{t("invitationsCreateHint")}</p>
        {notice && <Notice kind={notice.kind}>{notice.message}</Notice>}
        {code && (
          <div role="status" className="notice notice--success">
            <div className="stack stack--tight">
              <strong>{t("invitationsCodeTitle")}</strong>
              <TechnicalValue>{code}</TechnicalValue>
              <span>{t("invitationsCodeWarning")}</span>
              <div className="button-row">
                <Button size="sm" variant="action" onClick={() => void copy()}>{copied ? t("invitationsCopied") : t("invitationsCopy")}</Button>
                <Button size="sm" variant="ghost" onClick={() => setCode(null)}>{t("invitationsCodeDismiss")}</Button>
              </div>
            </div>
          </div>
        )}
        <form className="stack" onSubmit={(event) => void submit(event)} noValidate>
          <div className="field-grid">
            <label className="field">{t("invitationsFieldRole")}
              <select value={roleValue} disabled={busy} onChange={(event) => setRoleValue(event.target.value as InvitationRole)}>
                {ROLES.map((value) => <option key={value} value={value}>{role(value)}</option>)}
              </select>
            </label>
            <label className="field">{t("invitationsFieldPhone")}
              <input type="tel" dir="ltr" autoComplete="off" placeholder="+970 59 123 4567" value={phone} disabled={busy} aria-invalid={errors.phone || undefined} onChange={(event) => setPhone(event.target.value)} />
              {errors.phone && <small role="alert">{t("invitationsPhoneInvalid")}</small>}
            </label>
            <label className="field">{t("invitationsFieldEmail")}
              <input type="email" dir="ltr" autoComplete="off" value={email} disabled={busy} aria-invalid={errors.email || undefined} onChange={(event) => setEmail(event.target.value)} />
              {errors.email && <small role="alert">{t("invitationsEmailInvalid")}</small>}
            </label>
          </div>
          <div className="button-row"><Button variant="action" type="submit" disabled={busy}>{t("invitationsCreate")}</Button></div>
        </form>
      </Card>

      <Card span={12}>
        <CardHeader title={t("invitationsListTitle")} action={<Button size="sm" variant="outline" onClick={() => void load()} disabled={busy}>{t("refreshData")}</Button>} />
        {loading ? <p className="muted">{t("invitationsLoading")}</p> : (
          <DataTable columns={columns} rows={items} rowKey={(row) => row.id} empty={<EmptyState icon="history" title={t("invitationsEmpty")} />} />
        )}
      </Card>
    </BentoGrid>
  );
}
