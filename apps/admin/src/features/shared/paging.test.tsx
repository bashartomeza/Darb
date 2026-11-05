// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, IncidentRecord, InvitationRecord, UncertainAiRecord } from "../../api";
import { buttonNamed, buttonsNamed, click, mount, unmount } from "../../testing/mount";
import { INCIDENTS_PAGE_SIZE, IncidentsPanel } from "../incidents/IncidentsPanel";
import { UNCERTAIN_AI_PAGE_SIZE, UncertainAiRequests } from "../incidents/UncertainAiRequests";
import { INVITATIONS_PAGE_SIZE, InvitationsPage } from "../invitations/InvitationsPage";
import { Pager, pageCount } from "./Pager";

afterEach(unmount);

const incident: IncidentRecord = {
  id: "inc_1",
  trip_id: null,
  category: "safety",
  description: "Unsafe driving",
  status: "open",
  admin_note: null,
  revision: 1,
  reviewed_at: null,
  resolved_at: null,
  created_at: "2026-11-04T08:00:00.000Z"
};
const aiRequest: UncertainAiRecord = {
  id: "ai_1",
  locale: "ar",
  text: "بدي اروح عالخليل",
  intent_type: "ride",
  confidence: 0.4,
  source: "rules",
  reason: "low_confidence",
  pickup_key: null,
  dropoff_key: null,
  status: "open",
  resolution_note: null,
  resolved_at: null,
  revision: 1,
  created_at: "2026-11-04T08:00:00.000Z",
  expires_at: "2026-12-04T08:00:00.000Z"
};
const invitation: InvitationRecord = {
  id: "inv_1",
  role: "driver",
  phone: "+97059***567",
  contact_email: "d***@example.com",
  status: "unused",
  expires_at: "2026-11-10T08:00:00.000Z",
  created_at: "2026-11-04T08:00:00.000Z"
};

describe("pager", () => {
  it("counts pages from the total and hides itself when one page is enough", async () => {
    expect(pageCount(0, 50)).toBe(1);
    expect(pageCount(50, 50)).toBe(1);
    expect(pageCount(51, 50)).toBe(2);

    const onPage = vi.fn();
    let host = await mount(<Pager page={1} total={50} limit={50} onPage={onPage} />);
    expect(host.textContent).toBe("");
    unmount();

    host = await mount(<Pager page={2} total={101} limit={50} onPage={onPage} />, "ar");
    expect(host.textContent).toContain("الصفحة ٢ من ٣");
    await click(buttonNamed(host, "التالي"));
    expect(onPage).toHaveBeenCalledWith(3);
  });
});

describe("lists that used to stop at the first page", () => {
  it("incidents page through the returned total and restart when the filter changes", async () => {
    const api = {
      incidents: vi.fn().mockResolvedValue({ incidents: [incident], page: 1, limit: INCIDENTS_PAGE_SIZE, total: 130, open_total: 130 }),
      updateIncident: vi.fn()
    };
    const host = await mount(<IncidentsPanel api={api} token="t" />);
    expect(api.incidents).toHaveBeenCalledWith("t", { status: "open", page: 1, limit: INCIDENTS_PAGE_SIZE });
    expect(host.textContent).toContain("Page 1 of 3");

    await click(buttonNamed(host, "Next"));
    expect(api.incidents).toHaveBeenLastCalledWith("t", { status: "open", page: 2, limit: INCIDENTS_PAGE_SIZE });

    await click(buttonsNamed(host, "All")[0]);
    expect(api.incidents).toHaveBeenLastCalledWith("t", { status: undefined, page: 1, limit: INCIDENTS_PAGE_SIZE });
  });

  it("uncertain AI requests page through the returned total", async () => {
    const api = {
      uncertainAiRequests: vi.fn().mockResolvedValue({ requests: [aiRequest], page: 1, limit: UNCERTAIN_AI_PAGE_SIZE, total: 75, open_total: 75 }),
      resolveUncertainAiRequest: vi.fn()
    };
    const host = await mount(<UncertainAiRequests api={api} token="t" />);
    expect(host.textContent).toContain("Page 1 of 2");
    await click(buttonNamed(host, "Next"));
    expect(api.uncertainAiRequests).toHaveBeenLastCalledWith("t", { status: "open", page: 2, limit: UNCERTAIN_AI_PAGE_SIZE });
  });

  it("invitations page through the returned total", async () => {
    const api = {
      adminInvitations: vi.fn().mockResolvedValue({ invitations: [invitation], page: 1, limit: INVITATIONS_PAGE_SIZE, total: 51 }),
      createAdminInvitation: vi.fn(),
      revokeAdminInvitation: vi.fn()
    } as unknown as ApiClient & { adminInvitations: ReturnType<typeof vi.fn> };
    const host = await mount(<InvitationsPage api={api} token="t" />);
    expect(api.adminInvitations).toHaveBeenCalledWith("t", { page: 1, limit: INVITATIONS_PAGE_SIZE });
    expect(host.textContent).toContain("Page 1 of 2");
    await click(buttonNamed(host, "Next"));
    expect(api.adminInvitations).toHaveBeenLastCalledWith("t", { page: 2, limit: INVITATIONS_PAGE_SIZE });
  });
});
