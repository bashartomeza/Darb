import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient, type UserDetail, type UserListItem, type UserPage } from "../../api";
import { LocaleProvider } from "../../i18n/LocaleContext";
import { translations, type Locale } from "../../i18n/translations";
import { createUserStatusIntent, executeUserStatusMutation, UsersDirectoryView, type UsersDirectoryViewProps } from "./UsersDirectory";

const passenger: UserListItem = { id: "passenger_1", name: "QA Active Passenger", phone: "+15550000101", role: "passenger", account_status: "active", status_reason: null, status_updated_at: "2026-08-23T10:00:00.000Z", last_login_at: null, demo_account: false, created_at: "2026-08-23T10:00:00.000Z", role_context: { kind: "passenger" } };
const approvedDriver: UserListItem = { ...passenger, id: "driver_approved", name: "QA Approved Driver", role: "driver", role_context: { kind: "driver", driver_profile_exists: true, driver_profile_verified: true, driver_verification_status: "approved" } };
const pendingDriver: UserListItem = { ...passenger, id: "driver_pending", name: "QA Pending Driver", role: "driver", account_status: "pending", role_context: { kind: "driver", driver_profile_exists: false, driver_profile_verified: false, driver_verification_status: "pending" } };
const pendingMerchant: UserListItem = { ...passenger, id: "merchant_pending", name: "QA Pending Merchant", role: "merchant", account_status: "pending", role_context: { kind: "merchant", merchant_approval_connected: false } };
const page: UserPage = { users: [passenger, approvedDriver, pendingDriver, pendingMerchant], page: 1, limit: 2, total: 4 };
const detail: UserDetail = { ...passenger, role: "passenger", driver_profile: null, driver_verification: null, active_session_count: 0, last_session_at: null, passenger_request_count: 0, merchant_order_count: 0 };

function render(locale: Locale, children: ReactNode) {
  const storage = { getItem: () => locale, setItem: () => undefined };
  const documentRef = { documentElement: { lang: "", dir: "" } };
  return renderToStaticMarkup(<LocaleProvider storage={storage} documentRef={documentRef}>{children}</LocaleProvider>);
}

function props(overrides: Partial<UsersDirectoryViewProps> = {}): UsersDirectoryViewProps {
  return {
    phase: "ready", data: page, page: 1, pages: 2, query: "", role: "all", accountStatus: "all", demoAccount: "all",
    adminId: "admin_current", canAct: true, selectedId: null, detail: null, detailPhase: "ready", pending: null, reason: "", busy: false, error: null,
    onRoleChange: vi.fn(), onStatusChange: vi.fn(), onDemoChange: vi.fn(), onPageChange: vi.fn(), onLoadDetail: vi.fn(), onCloseDetail: vi.fn(), onBeginStatus: vi.fn(), onReasonChange: vi.fn(), onSubmitStatus: vi.fn(), onCancelStatus: vi.fn(),
    ...overrides
  };
}

describe("User Management view", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("captures directory and detail snapshot statuses in account-change intents", () => {
    expect(createUserStatusIntent(passenger, "suspended")).toEqual({
      user: passenger,
      nextStatus: "suspended",
      expectedStatus: "active"
    });

    const suspendedDetail: UserDetail = { ...detail, account_status: "suspended" };
    expect(createUserStatusIntent(suspendedDetail, "active")).toEqual({
      user: suspendedDetail,
      nextStatus: "active",
      expectedStatus: "suspended"
    });
  });

  it("distinguishes loading, complete, empty, search-empty, and error states", () => {
    expect(render("en", <UsersDirectoryView {...props({ phase: "loading" })} />)).toContain('role="status"');
    const complete = render("en", <UsersDirectoryView {...props()} />);
    expect(complete).toContain("QA Active Passenger"); expect(complete).toContain("QA Approved Driver");
    expect(render("en", <UsersDirectoryView {...props({ data: { ...page, users: [], total: 0 } })} />)).toContain("No data");
    expect(render("en", <UsersDirectoryView {...props({ data: { ...page, users: [], total: 0 }, query: "missing" })} />)).toContain("Nothing matches your search");
    expect(render("en", <UsersDirectoryView {...props({ phase: "error" })} />)).toContain("This section could not be loaded");
  });

  it("renders search results, role/status/demo filters, and bounded pagination controls", () => {
    const markup = render("en", <UsersDirectoryView {...props({ query: "QA", role: "driver", accountStatus: "pending", demoAccount: "real", page: 2 })} />);
    expect(markup).toContain('value="driver" selected'); expect(markup).toContain('value="pending" selected'); expect(markup).toContain('value="real" selected');
    expect(markup).toContain("Previous"); expect(markup).toContain("Next"); expect(markup).toContain("Page 2 of 2");
  });

  it("offers approve and reject for a pending merchant once the workflow is connected", () => {
    const onMerchantDecision = vi.fn();
    const markup = render("en", <UsersDirectoryView {...props({ onMerchantDecision })} />);
    expect(markup).toContain("Approve merchant");
    expect(markup).toContain("Reject merchant");
    expect(markup).toContain("Awaiting Admin approval");
    expect(markup).not.toContain("Merchant approval workflow is not connected");
  });

  it("does not offer a decision for an open-signup applicant who has not submitted documents", () => {
    const unsubmitted: UserListItem = { ...pendingMerchant, id: "merchant_draft", name: "QA Draft Shop", role_context: { kind: "merchant", merchant_approval_connected: true, application_submitted: false } };
    const draftDetail = { ...detail, ...unsubmitted, driver_profile: null, driver_verification: null, active_session_count: 0, last_session_at: null, passenger_request_count: 0, merchant_order_count: 0 } as UserDetail;
    const markup = render("en", <UsersDirectoryView {...props({ data: { ...page, users: [unsubmitted] }, detail: draftDetail, selectedId: draftDetail.id, onMerchantDecision: vi.fn() })} />);
    expect(markup).toContain("Not submitted yet");
    expect(markup).not.toContain("Approve merchant");
    expect(markup).not.toContain("Reject merchant");
  });

  it("hides merchant decisions while the console cannot act", () => {
    const markup = render("en", <UsersDirectoryView {...props({ onMerchantDecision: vi.fn(), canAct: false })} />);
    expect(markup).not.toContain("Approve merchant");
  });

  it("shows approved-driver context and honest pending driver/merchant boundaries", () => {
    const markup = render("en", <UsersDirectoryView {...props()} />);
    expect(markup).toContain("Approved");
    expect(markup).toContain("Driver approval is handled in Driver Verification");
    expect(markup).toContain("Merchant approval workflow is not connected");
    expect(markup).not.toContain("Approve driver");
  });

  it("renders passenger and driver detail panels without edit fields", () => {
    const passengerMarkup = render("en", <UsersDirectoryView {...props({ selectedId: detail.id, detail })} />);
    expect(passengerMarkup).toContain("User details"); expect(passengerMarkup).toContain("Passenger requests"); expect(passengerMarkup).toContain("Suspend account");
    const driverDetail: UserDetail = { ...detail, ...approvedDriver, role: "driver", driver_profile: { id: "profile_1", vehicle_type: "sedan", seats_total: 4, parcel_capacity: 3, verified: true, trust_score: 80, created_at: "2026-08-23T10:00:00.000Z" }, driver_verification: { id: "verification_1", revision: 2, status: "approved", history: [], rejection_reason: null, submitted_at: "2026-08-23T10:00:00.000Z", reviewed_at: "2026-08-23T10:00:00.000Z", reviewer: { id: "admin_1", name: "QA Admin" }, candidate: approvedDriver, driver_profile: null, evidence: { status: "not_collected", items: [], documents: [] } } };
    const driverMarkup = render("en", <UsersDirectoryView {...props({ selectedId: driverDetail.id, detail: driverDetail })} />);
    expect(driverMarkup).toContain("sedan"); expect(driverMarkup).toContain("Approved"); expect(driverMarkup).not.toContain("password");
  });

  it("offers detail-panel reactivation from the detail snapshot", () => {
    const suspendedDetail: UserDetail = { ...detail, account_status: "suspended" };
    const markup = render("en", <UsersDirectoryView {...props({ data: { ...page, users: [], total: 0 }, selectedId: suspendedDetail.id, detail: suspendedDetail })} />);
    expect(markup).toContain("Reactivate");
  });

  it("renders suspend, disable, and reactivate confirmations", () => {
    expect(render("en", <UsersDirectoryView {...props({ pending: createUserStatusIntent(passenger, "suspended") })} />)).toContain("QA Active Passenger&#x27;s account will change to “Suspended”");
    expect(render("en", <UsersDirectoryView {...props({ pending: createUserStatusIntent(passenger, "disabled") })} />)).toContain("Disabled");
    const suspended = { ...passenger, account_status: "suspended" as const };
    expect(render("en", <UsersDirectoryView {...props({ data: { ...page, users: [suspended], total: 1 } })} />)).toContain("Reactivate");
  });

  it("removes unsafe controls for the current Admin", () => {
    const currentAdmin = { ...passenger, id: "admin_current", role: "admin", name: "Current Admin", role_context: { kind: "admin" as const } };
    const markup = render("en", <UsersDirectoryView {...props({ data: { ...page, users: [currentAdmin], total: 1 } })} />);
    expect(markup).toContain("You cannot suspend or disable your own account"); expect(markup).not.toContain("Suspend account");
  });

  it("preserves Arabic/English copy and renders phone values LTR", () => {
    const en = render("en", <UsersDirectoryView {...props()} />); const ar = render("ar", <UsersDirectoryView {...props()} />);
    expect(en).toContain("User directory"); expect(ar).toContain("دليل المستخدمين");
    expect(en).toContain('dir="ltr"'); expect(ar).toContain('dir="ltr"'); expect(ar).toContain("حالة الحساب");
  });

  it("shows stale conflict feedback while the authoritative reload is requested by the controller", () => {
    const markup = render("en", <UsersDirectoryView {...props({ pending: createUserStatusIntent(passenger, "suspended"), error: "User state changed. The latest directory data was reloaded." })} />);
    expect(markup).toContain('role="alert"'); expect(markup).toContain("latest directory data was reloaded");
  });

  it("localizes stale account conflicts as an external change followed by refresh", () => {
    expect(translations.en.accountStatusConflictReloaded).toBe("Account status changed elsewhere. The current state has been refreshed.");
    expect(translations.ar.accountStatusConflictReloaded).toBe("تم تغيير حالة الحساب من جلسة أخرى. تم تحديث البيانات الحالية.");
  });

  it("sends the stale snapshot, avoids success, and reloads authoritative list and detail after 409", async () => {
    const authoritative = { ...passenger, account_status: "suspended" as const };
    const authoritativeDetail: UserDetail = { ...detail, account_status: "suspended" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "account_status_conflict" }), { status: 409, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ users: [authoritative], page: 1, limit: 25, total: 1 }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: authoritativeDetail }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient("http://api.test");
    const reloadedPages: UserPage[] = [];
    const reloadedDetails: UserDetail[] = [];

    const outcome = await executeUserStatusMutation({
      api,
      token: "admin-token",
      intent: createUserStatusIntent(passenger, "disabled"),
      reason: "Stale tab action",
      reloadUsers: async () => { reloadedPages.push(await api.users("admin-token", "all", "all", 1, 25)); },
      reloadDetail: async () => { reloadedDetails.push((await api.user("admin-token", passenger.id)).user); }
    });

    expect(outcome.kind).toBe("conflict");
    expect(fetchMock).toHaveBeenNthCalledWith(1, "http://api.test/api/v1/admin/users/passenger_1/status", expect.objectContaining({ body: JSON.stringify({ status: "disabled", reason: "Stale tab action", expected_status: "active" }) }));
    expect(reloadedPages[0]?.users[0]?.account_status).toBe("suspended");
    expect(reloadedDetails[0]?.account_status).toBe("suspended");
  });
});
