// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommunityReport } from "../../api";
import { buttonNamed, buttonsNamed, choose, click, dialog, mount, selectLabelled, unmount } from "../../testing/mount";
import { COMMUNITY_REPORTS_PAGE_SIZE, CommunityReportsPage, reportActions, type CommunityReportsApi } from "./CommunityReportsPage";

function report(overrides: Partial<CommunityReport> = {}): CommunityReport {
  return {
    id: "rep_1",
    category: "checkpoint_outdated",
    description: "Huwwara is open now",
    location_name: "Huwwara",
    latitude: 32.153,
    longitude: 35.256,
    created_at: "2026-11-04T08:00:00.000Z",
    upvotes: 3,
    downvotes: 1,
    awaiting_admin_review: true,
    has_trip: false,
    author_id: "passenger_1",
    trip_id: null,
    hidden_at: null,
    admin_reviewed_at: null,
    flag_count: 2,
    ...overrides
  };
}

function fakeApi(overrides: Partial<Record<keyof CommunityReportsApi, unknown>> = {}) {
  return {
    communityReports: vi.fn().mockResolvedValue({ reports: [report()], page: 1, limit: COMMUNITY_REPORTS_PAGE_SIZE, total: 1 }),
    moderateCommunityReport: vi.fn().mockResolvedValue({ report: report() }),
    ...overrides
  } as unknown as CommunityReportsApi & Record<keyof CommunityReportsApi, ReturnType<typeof vi.fn>>;
}

afterEach(unmount);

describe("community reports moderation", () => {
  it("offers review only while a report waits for it, and hide or show by visibility", () => {
    expect(reportActions({ awaiting_admin_review: true, hidden_at: null })).toEqual(["reviewed", "hide"]);
    expect(reportActions({ awaiting_admin_review: false, hidden_at: null })).toEqual(["hide"]);
    expect(reportActions({ awaiting_admin_review: false, hidden_at: "2026-11-04T08:00:00.000Z" })).toEqual(["restore"]);
  });

  it("opens on the review queue and shows the report with its signals", async () => {
    const api = fakeApi();
    const host = await mount(<CommunityReportsPage api={api} token="t" />);
    expect(api.communityReports).toHaveBeenCalledWith("t", { pending: true, category: undefined, hidden: undefined, page: 1, limit: COMMUNITY_REPORTS_PAGE_SIZE });
    const text = host.textContent ?? "";
    expect(text).toContain("Checkpoint status out of date");
    expect(text).toContain("Huwwara is open now");
    expect(text).toContain("3 agree · 1 disagree");
    expect(text).toContain("2 flags");
    expect(text).toContain("Needs review");
  });

  it("filters all reports by type and visibility", async () => {
    const api = fakeApi();
    const host = await mount(<CommunityReportsPage api={api} token="t" />);
    await choose(selectLabelled(host, "List"), "all");
    await choose(selectLabelled(host, "Type"), "road_closure");
    await choose(selectLabelled(host, "Visibility"), "hidden");
    expect(api.communityReports).toHaveBeenLastCalledWith("t", { pending: false, category: "road_closure", hidden: true, page: 1, limit: COMMUNITY_REPORTS_PAGE_SIZE });
  });

  it("asks before hiding, then hides and reloads", async () => {
    const api = fakeApi();
    const host = await mount(<CommunityReportsPage api={api} token="t" />);

    await click(buttonNamed(host, "Hide"));
    expect(api.moderateCommunityReport).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain("Hide this report?");

    await click(buttonNamed(dialog()!, "Hide"));
    expect(api.moderateCommunityReport).toHaveBeenCalledWith("t", "rep_1", "hide");
    expect(api.communityReports).toHaveBeenCalledTimes(2);
    expect(dialog()).toBeNull();
    expect(host.textContent).toContain("Report hidden.");
  });

  it("cancelling the confirmation changes nothing", async () => {
    const api = fakeApi();
    const host = await mount(<CommunityReportsPage api={api} token="t" />);
    await click(buttonNamed(host, "Mark reviewed"));
    await click(buttonNamed(dialog()!, "Cancel"));
    expect(api.moderateCommunityReport).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it("shows hidden reports with a way to show them again, and keeps the dialog open on failure", async () => {
    const api = fakeApi({
      communityReports: vi.fn().mockResolvedValue({ reports: [report({ awaiting_admin_review: false, hidden_at: "2026-11-04T09:00:00.000Z", admin_reviewed_at: "2026-11-04T09:00:00.000Z" })], page: 1, limit: 25, total: 1 }),
      moderateCommunityReport: vi.fn().mockRejectedValue(new Error("internal_server_error"))
    });
    const host = await mount(<CommunityReportsPage api={api} token="t" />);
    expect(host.textContent).toContain("Hidden");
    expect(buttonsNamed(host, "Hide")).toHaveLength(0);

    await click(buttonNamed(host, "Show again"));
    await click(buttonNamed(dialog()!, "Show again"));
    expect(api.moderateCommunityReport).toHaveBeenCalledWith("t", "rep_1", "restore");
    expect(dialog()?.textContent).toContain("The action could not be saved");
  });

  it("has loading, error with retry, empty and paged states", async () => {
    let fail = true;
    const api = fakeApi({
      communityReports: vi.fn(() => fail
        ? Promise.reject(new Error("offline"))
        : Promise.resolve({ reports: [], page: 1, limit: 25, total: 0 }))
    });
    const host = await mount(<CommunityReportsPage api={api} token="t" />);
    expect(host.textContent).toContain("Reports could not be loaded.");
    fail = false;
    await click(buttonNamed(host, "Retry"));
    expect(host.textContent).toContain("No reports need review.");

    const paged = fakeApi({ communityReports: vi.fn().mockResolvedValue({ reports: [report()], page: 1, limit: 25, total: 60 }) });
    unmount();
    const second = await mount(<CommunityReportsPage api={paged} token="t" />);
    expect(second.textContent).toContain("Page 1 of 3");
    await click(buttonNamed(second, "Next"));
    expect(paged.communityReports).toHaveBeenLastCalledWith("t", expect.objectContaining({ page: 2 }));
  });

  it("is fully translated into Arabic", async () => {
    const host = await mount(<CommunityReportsPage api={fakeApi()} token="t" />, "ar");
    expect(host.textContent).toContain("حالة حاجز قديمة");
    expect(host.textContent).toContain("بانتظار المراجعة");
    expect(host.textContent).toContain("إخفاء");
  });
});
