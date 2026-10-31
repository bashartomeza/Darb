import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ApiClient, ApiError, AccountStatus, User, UserAccountStatus, UserDetail, UserListItem, UserPage, UserRoleFilter } from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import { AlertItem, BentoGrid, Button, Card, CardHeader, DataTable, EmptyState, Skeleton, StatusBadge, TechnicalValue, type Column } from "../../ui";

type Props = { api: ApiClient; token: string; admin: User | null; search: string; canAct?: boolean };
export type DemoFilter = "all" | "demo" | "real";
type MerchantDocKind = "commercial_register" | "national_id" | "shop_photo" | "other";
type UserStatusSnapshot = UserListItem | UserDetail;
export type UserStatusIntent = { user: UserStatusSnapshot; nextStatus: AccountStatus; expectedStatus: UserAccountStatus };

export function createUserStatusIntent(user: UserStatusSnapshot, nextStatus: AccountStatus): UserStatusIntent {
  return { user, nextStatus, expectedStatus: user.account_status };
}

export async function executeUserStatusMutation(options: {
  api: ApiClient;
  token: string;
  intent: UserStatusIntent;
  reason?: string;
  reloadUsers: () => Promise<void>;
  reloadDetail?: () => Promise<void>;
}): Promise<{ kind: "success" } | { kind: "conflict" | "error"; error: ApiError }> {
  const reloadAuthoritativeState = () => Promise.all([
    options.reloadUsers(),
    options.reloadDetail?.() ?? Promise.resolve()
  ]);
  try {
    await options.api.updateUserStatus(
      options.token,
      options.intent.user.id,
      options.intent.nextStatus,
      options.reason,
      options.intent.expectedStatus
    );
    await reloadAuthoritativeState();
    return { kind: "success" };
  } catch (caught) {
    const error = caught as ApiError;
    if (error.status === 409) {
      await reloadAuthoritativeState();
      return { kind: "conflict", error };
    }
    return { kind: "error", error };
  }
}

const tone = (s: string) => s === "active" ? "success" : s === "pending" ? "warning" : "danger";
const statusKey = (s: string) => `accountStatus_${s}` as any;
const roleKey = (s: string) => `role_${s}` as any;

function contextText(user: UserListItem, t: (key: any) => string) {
  if (user.role_context.kind === "driver") {
    const state = user.role_context.driver_verification_status === "none" ? t("verificationStatus_no") : t(`verificationStatus_${user.role_context.driver_verification_status}` as any);
    return <span className="cell-stack__sub">{t("driverReview")}: {state} · {user.role_context.driver_profile_exists ? t("yes") : t("no")}{user.role_context.application_submitted === false ? ` · ${t("applicationNotSubmitted")}` : ""}</span>;
  }
  if (user.role_context.kind === "merchant") return <span className="cell-stack__sub">{user.account_status === "pending" ? t(user.role_context.application_submitted === false ? "applicationNotSubmitted" : "merchantAwaitingApproval") : "—"}</span>;
  return <span className="cell-stack__sub">—</span>;
}

export function UsersDirectory({ api, token, admin, search, canAct = true }: Props) {
  const { t, dateTime, number } = useLocale();
  const [role, setRole] = useState<UserRoleFilter>("all");
  const [accountStatus, setAccountStatus] = useState<UserAccountStatus | "all">("all");
  const [demoAccount, setDemoAccount] = useState<DemoFilter>("all");
  const [page, setPage] = useState(1);
  const limit = 25;
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [data, setData] = useState<UserPage>({ users: [], page: 1, limit, total: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [detailPhase, setDetailPhase] = useState<"loading" | "ready" | "error">("ready");
  const [pending, setPending] = useState<UserStatusIntent | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [merchantDecision, setMerchantDecision] = useState<{ user: UserStatusSnapshot; decision: "approve" | "reject" } | null>(null);
  const [merchantReason, setMerchantReason] = useState("");
  const [merchantBusy, setMerchantBusy] = useState(false);
  const [merchantError, setMerchantError] = useState<string | null>(null);
  const [merchantDocs, setMerchantDocs] = useState<Array<{ id: string; kind: string; size_bytes: number }> | null>(null);
  const merchantDecisionUserId = merchantDecision?.user.id;
  useEffect(() => {
    setMerchantDocs(null);
    if (!merchantDecisionUserId || !token) return;
    let live = true;
    api.merchantDocuments(token, merchantDecisionUserId)
      .then((result) => { if (live) setMerchantDocs(result.documents); })
      .catch(() => { if (live) setMerchantDocs([]); });
    return () => { live = false; };
  }, [api, token, merchantDecisionUserId]);

  async function downloadMerchantDocument(documentId: string) {
    if (!merchantDecision || !token) return;
    setMerchantError(null);
    try {
      const blob = await api.downloadMerchantDocument(token, merchantDecision.user.id, documentId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `shop-document-${documentId}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch { setMerchantError(t("documentDownloadFailed")); }
  }
  const query = useMemo(() => search.trim().slice(0, 64), [search]);

  async function loadUsers() {
    if (!token) return;
    setPhase("loading");
    try { setData(await api.users(token, role, accountStatus, page, limit, query, demoAccount)); setPhase("ready"); } catch { setPhase("error"); }
  }
  async function loadDetail(id: string) {
    setSelectedId(id); setDetailPhase("loading");
    try { setDetail((await api.user(token, id)).user); setDetailPhase("ready"); } catch { setDetail(null); setDetailPhase("error"); }
  }
  useEffect(() => { setPage(1); }, [role, accountStatus, demoAccount, query]);
  useEffect(() => { void loadUsers(); }, [token, role, accountStatus, demoAccount, page, query]);

  async function submit() {
    if (!pending || !token) return;
    const clean = reason.trim();
    if (pending.nextStatus !== "active" && clean.length < 3) return;
    setBusy(true); setError(null);
    try {
      const outcome = await executeUserStatusMutation({
        api,
        token,
        intent: pending,
        reason: clean || undefined,
        reloadUsers: loadUsers,
        reloadDetail: selectedId === pending.user.id ? () => loadDetail(selectedId) : undefined
      });
      if (outcome.kind === "success") {
        setPending(null);
        setReason("");
        return;
      }
      const e = outcome.error;
      const code = (e.details as { error?: string } | undefined)?.error;
      setError(
        code === "approval_required"
          ? (pending.user.role === "driver" ? t("pendingDriverApprovalUnavailable") : t("pendingMerchantApprovalUnavailable"))
          : code === "cannot_suspend_current_admin"
            ? t("selfAccountControlUnavailable")
            : code === "last_active_admin_required"
              ? t("lastActiveAdminUnavailable")
              : e.status === 409
                ? t("accountStatusConflictReloaded")
                : t("resourceLoadErrorDescription")
      );
    }
    finally { setBusy(false); }
  }

  async function submitMerchantDecision() {
    if (!merchantDecision || !token) return;
    const clean = merchantReason.trim();
    if (merchantDecision.decision === "reject" && clean.length < 3) return;
    setMerchantBusy(true); setMerchantError(null);
    try {
      await api.decideMerchantApproval(token, merchantDecision.user.id, merchantDecision.decision, clean || undefined);
      setMerchantDecision(null); setMerchantReason("");
      await Promise.all([loadUsers(), selectedId === merchantDecision.user.id ? loadDetail(selectedId) : Promise.resolve()]);
    } catch (caught) {
      const failure = caught as ApiError;
      if (failure.status === 409) {
        setMerchantError(t("accountStatusConflictReloaded"));
        await Promise.all([loadUsers(), selectedId ? loadDetail(selectedId) : Promise.resolve()]);
      } else setMerchantError(t("resourceLoadErrorDescription"));
    } finally { setMerchantBusy(false); }
  }

  const merchantCard = merchantDecision ? <Card span={6}>
    <CardHeader title={merchantDecision.decision === "approve" ? t("approveMerchant") : t("rejectMerchant")} />
    <AlertItem tone={merchantDecision.decision === "approve" ? "info" : "warning"} title={merchantDecision.user.name} description={merchantDecision.decision === "approve" ? t("approveMerchantEffect") : t("rejectMerchantEffect")} />
    {merchantDocs && <div className="field"><strong>{t("merchantDocumentsTitle")}</strong>{merchantDocs.length === 0
      ? <p className="muted">{t("merchantDocumentsNone")}</p>
      : merchantDocs.map((item) => <p key={item.id}>{t(`merchantDocKind_${item.kind as MerchantDocKind}`)} <span className="muted">· {Math.ceil(item.size_bytes / 1024)} KB</span> <Button size="sm" variant="ghost" icon="id_card" onClick={() => void downloadMerchantDocument(item.id)}>{t("downloadDocument")}</Button></p>)}</div>}
    {merchantDecision.decision === "reject" && <label className="field">{t("statusReason")}<input value={merchantReason} maxLength={500} onChange={(e) => setMerchantReason(e.target.value)} /></label>}
    {merchantError && <p role="alert" className="overview-resource-note overview-resource-note--error">{merchantError}</p>}
    <div className="card__actions">
      <Button variant="primary" disabled={merchantBusy || (merchantDecision.decision === "reject" && merchantReason.trim().length < 3)} onClick={() => void submitMerchantDecision()}>{merchantBusy ? t("saving") : t("confirm")}</Button>
      <Button variant="ghost" disabled={merchantBusy} onClick={() => { setMerchantDecision(null); setMerchantReason(""); setMerchantError(null); }}>{t("cancel")}</Button>
    </div>
  </Card> : null;

  const pages = Math.max(1, Math.ceil(data.total / data.limit));
  return <UsersDirectoryView
    onMerchantDecision={(user, decision) => { setMerchantDecision({ user, decision }); setMerchantReason(""); setMerchantError(null); }}
    merchantDecisionCard={merchantCard}
    phase={phase} data={data} page={page} pages={pages} query={query} role={role} accountStatus={accountStatus} demoAccount={demoAccount}
    adminId={admin?.id ?? null} canAct={canAct} selectedId={selectedId} detail={detail} detailPhase={detailPhase} pending={pending}
    reason={reason} busy={busy} error={error} onRoleChange={setRole} onStatusChange={setAccountStatus} onDemoChange={setDemoAccount}
    onPageChange={setPage} onLoadDetail={(id) => void loadDetail(id)} onCloseDetail={() => { setSelectedId(null); setDetail(null); }}
    onBeginStatus={setPending} onReasonChange={setReason} onSubmitStatus={() => void submit()} onCancelStatus={() => { setPending(null); setReason(""); setError(null); }}
  />;
}

export type UsersDirectoryViewProps = {
  onMerchantDecision?: (user: UserStatusSnapshot, decision: "approve" | "reject") => void;
  merchantDecisionCard?: ReactNode;
  phase: "loading" | "ready" | "error";
  data: UserPage;
  page: number;
  pages: number;
  query: string;
  role: UserRoleFilter;
  accountStatus: UserAccountStatus | "all";
  demoAccount: DemoFilter;
  adminId: string | null;
  canAct: boolean;
  selectedId: string | null;
  detail: UserDetail | null;
  detailPhase: "loading" | "ready" | "error";
  pending: UserStatusIntent | null;
  reason: string;
  busy: boolean;
  error: string | null;
  onRoleChange: (value: UserRoleFilter) => void;
  onStatusChange: (value: UserAccountStatus | "all") => void;
  onDemoChange: (value: DemoFilter) => void;
  onPageChange: (value: number) => void;
  onLoadDetail: (id: string) => void;
  onCloseDetail: () => void;
  onBeginStatus: (value: UserStatusIntent) => void;
  onReasonChange: (value: string) => void;
  onSubmitStatus: () => void;
  onCancelStatus: () => void;
};

export function UsersDirectoryView(props: UsersDirectoryViewProps) {
  const { t, dateTime, number } = useLocale();
  const { phase, data, page, pages, query, role, accountStatus, demoAccount, adminId, canAct, selectedId, detail, detailPhase, pending, reason, busy, error } = props;
  const accountControls = (user: UserStatusSnapshot) => {
    if (user.id === adminId) return <span className="muted">{t("selfAccountControlUnavailable")}</span>;
    if (user.account_status === "pending" && user.role_context.kind !== "passenger" && user.role_context.kind !== "admin" && user.role_context.application_submitted === false) {
      return <span className="muted">{t("applicationNotSubmitted")}</span>;
    }
    if (user.account_status === "pending" && user.role === "merchant" && props.onMerchantDecision) {
      return canAct ? <div className="card__actions"><Button size="sm" variant="primary" icon="check_circle" onClick={() => props.onMerchantDecision!(user, "approve")}>{t("approveMerchant")}</Button><Button size="sm" variant="ghost" icon="block" onClick={() => props.onMerchantDecision!(user, "reject")}>{t("rejectMerchant")}</Button></div> : <span className="muted">{t("loading")}</span>;
    }
    if (user.account_status === "pending") return <span className="muted">{user.role === "driver" ? t("pendingDriverApprovalUnavailable") : user.role === "merchant" ? t("pendingMerchantApprovalUnavailable") : t("pendingAccountControlUnavailable")}</span>;
    if (!canAct) return <span className="muted">{t("loading")}</span>;
    if (user.account_status === "active") return <div className="card__actions"><Button size="sm" variant="ghost" icon="block" onClick={() => props.onBeginStatus(createUserStatusIntent(user, "suspended"))}>{t("suspendAccount")}</Button><Button size="sm" variant="ghost" icon="block" onClick={() => props.onBeginStatus(createUserStatusIntent(user, "disabled"))}>{t("disableAccount")}</Button></div>;
    return <Button size="sm" variant="ghost" icon="check_circle" onClick={() => props.onBeginStatus(createUserStatusIntent(user, "active"))}>{t("reactivateAccount")}</Button>;
  };
  const columns: Column<UserListItem>[] = [
    { key: "user", header: t("columnPassenger"), cell: (u) => <div><p className="cell-stack__title">{u.name}</p><p className="cell-stack__sub"><TechnicalValue>{u.phone}</TechnicalValue></p></div> },
    { key: "role", header: t("columnRole"), cell: (u) => t(roleKey(u.role)) },
    { key: "status", header: t("columnAccountStatus"), cell: (u) => <StatusBadge tone={tone(u.account_status)}>{t(statusKey(u.account_status))}</StatusBadge> },
    { key: "context", header: t("verificationStatus"), cell: (u) => contextText(u, t) },
    { key: "detail", header: t("reviewAction"), align: "end", cell: (u) => <Button size="sm" variant="secondary" icon="search" onClick={() => props.onLoadDetail(u.id)}>{t("reviewDetails")}</Button> },
    { key: "actions", header: t("accountControl"), align: "end", cell: accountControls }
  ];
  return <BentoGrid>
    <Card span={12} padded={false}><CardHeader title={t("userDirectory")} badge={<StatusBadge tone="info">{number(data.total)}</StatusBadge>} action={<div className="card__actions">
      <label className="field field--inline">{t("columnRole")}<select value={role} onChange={(e) => props.onRoleChange(e.target.value as UserRoleFilter)}><option value="all">{t("all")}</option><option value="passenger">{t("role_passenger")}</option><option value="driver">{t("role_driver")}</option><option value="merchant">{t("role_merchant")}</option><option value="admin">{t("role_admin")}</option></select></label>
      <label className="field field--inline">{t("columnAccountStatus")}<select value={accountStatus} onChange={(e) => props.onStatusChange(e.target.value as UserAccountStatus | "all")}><option value="all">{t("all")}</option><option value="active">{t("accountStatus_active")}</option><option value="pending">{t("accountStatus_pending")}</option><option value="suspended">{t("accountStatus_suspended")}</option><option value="disabled">{t("accountStatus_disabled")}</option></select></label>
      <label className="field field--inline">{t("demo")}<select value={demoAccount} onChange={(e) => props.onDemoChange(e.target.value as DemoFilter)}><option value="all">{t("all")}</option><option value="demo">{t("yes")}</option><option value="real">{t("no")}</option></select></label>
    </div>} />
      {phase === "loading" && <div className="overview-resource-state" role="status"><Skeleton lines={4} /></div>}
      {phase === "error" && <EmptyState compact icon="report" title={t("resourceLoadError")} description={t("resourceLoadErrorDescription")} />}
      {phase === "ready" && <><DataTable columns={columns} rows={data.users} rowKey={(u) => u.id} empty={<EmptyState compact icon="account_circle" title={query ? t("searchNoResults") : t("noData")} />} />{pages > 1 && <div className="card__actions"><Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => props.onPageChange(page - 1)}>{t("previousPage")}</Button><span className="muted">{t("pageOf", { page: number(page), pages: number(pages) })}</span><Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => props.onPageChange(page + 1)}>{t("nextPage")}</Button></div>}</>}
    </Card>
    {selectedId && detailPhase === "loading" && <Card span={6}><Skeleton lines={5} /></Card>}
    {selectedId && detailPhase === "error" && <Card span={6}><EmptyState compact icon="report" title={t("verificationDetailLoadFailed")} description={t("resourceLoadErrorDescription")} /></Card>}
    {detail && <Card span={6}><CardHeader title={t("userDetail")} action={<div className="card__actions">{accountControls(detail)}<Button size="sm" variant="ghost" onClick={props.onCloseDetail}>{t("closeReview")}</Button></div>} /><div className="stack stack--tight">
      <p><strong>{t("profileName")}</strong> {detail.name}</p><p><strong>{t("phoneNumber")}</strong> <TechnicalValue>{detail.phone}</TechnicalValue></p><p><strong>{t("columnRole")}</strong> {t(roleKey(detail.role))}</p><p><strong>{t("columnAccountStatus")}</strong> <StatusBadge tone={tone(detail.account_status)}>{t(statusKey(detail.account_status))}</StatusBadge></p><p><strong>{t("createdAt")}</strong> {dateTime(detail.created_at)}</p><p><strong>{t("activeSessions")}</strong> {number(detail.active_session_count)}</p><p><strong>{t("lastActivity")}</strong> {detail.last_session_at ? dateTime(detail.last_session_at) : t("noData")}</p>
      {detail.role === "driver" && <>{detail.driver_verification?.status === "pending" && <AlertItem tone="info" title={t("pendingDriverApprovalUnavailable")} description={t("accountControlSeparateDescription")} />}<p><strong>{t("verificationStatus")}</strong> {detail.driver_verification ? t(`verificationStatus_${detail.driver_verification.status}` as any) : t("verificationStatus_no")}</p>{detail.driver_profile && <p><strong>{t("columnVerified")}</strong> {detail.driver_profile.verified ? t("yes") : t("no")} · {detail.driver_profile.vehicle_type}</p>}</>}
      {detail.role === "passenger" && <p><strong>{t("requestCount")}</strong> {number(detail.passenger_request_count)}</p>}{detail.role === "merchant" && <p><strong>{t("orderCount")}</strong> {number(detail.merchant_order_count)}</p>}
    </div></Card>}
    {props.merchantDecisionCard}
    {pending && <Card span={6}><CardHeader title={pending.nextStatus === "active" ? t("reactivateAccount") : t(statusKey(pending.nextStatus))} /><AlertItem tone="info" title={t("accountControl")} description={t("accountControlSeparateDescription")} /><p>{t("accountStatusConfirm", { name: pending.user.name, status: t(statusKey(pending.nextStatus)) })}</p>{pending.nextStatus !== "active" && <label className="field">{t("statusReason")}<input value={reason} maxLength={500} onChange={(e) => props.onReasonChange(e.target.value)} /></label>}{error && <p role="alert" className="overview-resource-note overview-resource-note--error">{error}</p>}<div className="card__actions"><Button variant="primary" disabled={busy || (pending.nextStatus !== "active" && reason.trim().length < 3)} onClick={props.onSubmitStatus}>{busy ? t("saving") : t("confirm")}</Button><Button variant="ghost" disabled={busy} onClick={props.onCancelStatus}>{t("cancel")}</Button></div></Card>}
  </BentoGrid>;
}
