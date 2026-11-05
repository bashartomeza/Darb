// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, ApiError, DriverProfile, DriverVerification } from "../../api";
import { buttonNamed, buttonsNamed, click, mount, settle, unmount } from "../../testing/mount";
import { expiryCorrectionFrom, expiryFormFrom } from "./DriverDirectory";
import { DRIVERS_PAGE_SIZE, DriversPage } from "./DriversPage";

const user = {
  id: "user_2",
  name: "Hebron Driver",
  phone: "+970590000002",
  role: "driver",
  account_status: "active" as const,
  status_reason: null,
  status_updated_at: "2026-07-01T00:00:00.000Z",
  last_login_at: null,
  demo_account: false,
  created_at: "2026-07-01T00:00:00.000Z"
};
const driver: DriverProfile = { id: "profile_1", vehicle_type: "van", seats_total: 6, parcel_capacity: 12, verified: true, trust_score: 86, created_at: "2026-07-01T00:00:00.000Z", user };
const approved: DriverVerification = {
  id: "verification_1",
  revision: 3,
  status: "approved",
  expiry: { licence: { expires_on: "2027-01-31", days_left: 87 }, vehicle_registration: null, insurance: { expires_on: "2026-12-01", days_left: 26 }, contract: null },
  rejection_reason: null,
  submitted_at: "2026-08-18T10:00:00.000Z",
  reviewed_at: "2026-08-19T10:00:00.000Z",
  reviewer: { id: "admin_1", name: "Admin" },
  history: [],
  candidate: user,
  driver_profile: driver,
  evidence: { status: "not_collected", items: [], documents: [] }
};

function apiError(status: number, message: string) {
  const error = new Error(message) as ApiError;
  error.status = status;
  return error;
}

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    drivers: vi.fn().mockResolvedValue({ drivers: [driver], page: 1, limit: DRIVERS_PAGE_SIZE, total: 1 }),
    driverVerifications: vi.fn().mockResolvedValue({ verifications: [], page: 1, limit: 50, total: 0 }),
    driverVerification: vi.fn().mockResolvedValue({ verification: approved }),
    updateDriverExpiry: vi.fn().mockResolvedValue({ verification: { ...approved, expiry: { ...approved.expiry!, licence: { expires_on: "2028-01-31", days_left: 452 } } } }),
    ...overrides
  } as unknown as ApiClient & Record<string, ReturnType<typeof vi.fn>>;
}

async function setDate(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
}

afterEach(unmount);

describe("driver expiry correction", () => {
  it("sends only changed dates, clears an emptied one, and rejects a malformed one", () => {
    const recorded = expiryFormFrom(approved);
    expect(recorded).toEqual({ licence: "2027-01-31", vehicle_registration: "", insurance: "2026-12-01", contract: "" });
    expect(expiryCorrectionFrom(recorded, recorded)).toEqual({});
    expect(expiryCorrectionFrom({ ...recorded, licence: "2028-01-31", insurance: "", contract: "2027-06-30" }, recorded))
      .toEqual({ licence: "2028-01-31", insurance: null, contract: "2027-06-30" });
    expect(expiryCorrectionFrom({ ...recorded, licence: "31/01/2028" }, recorded)).toBeNull();
  });
});

describe("drivers page", () => {
  it("loads its own driver page without the overview, with server search and paging", async () => {
    const api = fakeApi({ drivers: vi.fn().mockResolvedValue({ drivers: [driver], page: 1, limit: DRIVERS_PAGE_SIZE, total: 120 }) });
    const host = await mount(<DriversPage api={api} token="t" search=" Hebron " busy={false} onUpdateStatus={async () => true} />);
    expect(api.drivers).toHaveBeenCalledWith("t", { page: 1, limit: DRIVERS_PAGE_SIZE, search: "Hebron" });
    expect(host.textContent).toContain("Hebron Driver");
    expect(host.textContent).toContain("120 drivers");
    expect(host.textContent).toContain("Page 1 of 3");

    await click(buttonNamed(host, "Next"));
    expect(api.drivers).toHaveBeenLastCalledWith("t", { page: 2, limit: DRIVERS_PAGE_SIZE, search: "Hebron" });
  });

  it("shows an error with retry when the driver list fails", async () => {
    let fail = true;
    const api = fakeApi({ drivers: vi.fn(() => (fail ? Promise.reject(new Error("offline")) : Promise.resolve({ drivers: [driver], page: 1, limit: 50, total: 1 }))) });
    const host = await mount(<DriversPage api={api} token="t" search="" busy={false} onUpdateStatus={async () => true} />);
    expect(host.textContent).toContain("This section could not be loaded");
    fail = false;
    const retry = buttonsNamed(host, "Retry").at(-1)!;
    await click(retry);
    expect(host.textContent).toContain("Hebron Driver");
  });

  it("corrects an approved driver's expiry dates with the current revision", async () => {
    const api = fakeApi();
    const host = await mount(<DriversPage api={api} token="t" search="" busy={false} onUpdateStatus={async () => true} />);
    await click(buttonsNamed(host, "Review details")[0]);
    await click(buttonNamed(host, "Correct document expiry dates"));

    const group = host.querySelector<HTMLElement>('[role="group"]')!;
    const save = buttonNamed(group, "Save dates");
    expect(save.disabled).toBe(true);

    const [licence] = [...group.querySelectorAll<HTMLInputElement>('input[type="date"]')];
    await setDate(licence, "2028-01-31");
    expect(buttonNamed(group, "Save dates").disabled).toBe(false);
    await click(buttonNamed(group, "Save dates"));

    expect(api.updateDriverExpiry).toHaveBeenCalledWith("t", "user_2", 3, { licence: "2028-01-31" });
    expect(host.textContent).toContain("Document expiry dates saved.");
    expect(host.textContent).toContain("2028-01-31");
  });

  it("explains a past date and a stale record", async () => {
    const api = fakeApi({ updateDriverExpiry: vi.fn().mockRejectedValue(apiError(400, "expiry_date_in_past")) });
    const host = await mount(<DriversPage api={api} token="t" search="" busy={false} onUpdateStatus={async () => true} />);
    await click(buttonsNamed(host, "Review details")[0]);
    await click(buttonNamed(host, "Correct document expiry dates"));
    const group = host.querySelector<HTMLElement>('[role="group"]')!;
    await setDate(group.querySelector<HTMLInputElement>('input[type="date"]')!, "2026-01-01");
    await click(buttonNamed(group, "Save dates"));
    expect(host.textContent).toContain("An expiry date in the past cannot be saved");

    vi.mocked(api.updateDriverExpiry).mockRejectedValueOnce(apiError(409, "driver_verification_state_conflict"));
    await click(buttonNamed(host.querySelector<HTMLElement>('[role="group"]')!, "Save dates"));
    expect(api.driverVerification).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("changed");
  });

  it("reloads the list after an account status change the server accepted", async () => {
    const api = fakeApi();
    const onUpdateStatus = vi.fn().mockResolvedValue(true);
    const host = await mount(<DriversPage api={api} token="t" search="" busy={false} onUpdateStatus={onUpdateStatus} />);
    await click(buttonNamed(host, "Suspend account"));
    const reason = host.querySelector<HTMLInputElement>("input[minlength='3']")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(reason, "Expired insurance");
    reason.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    await click(buttonNamed(host, "Confirm"));
    expect(onUpdateStatus).toHaveBeenCalledWith("user_2", "suspended", "Expired insurance", "active");
    expect(api.drivers).toHaveBeenCalledTimes(2);
  });
});
