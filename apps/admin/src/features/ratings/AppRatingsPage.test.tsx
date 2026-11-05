// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppRatingPage } from "../../api";
import { buttonNamed, choose, click, mount, selectLabelled, settle, unmount } from "../../testing/mount";
import { APP_RATINGS_PAGE_SIZE, AppRatingsPage, ratingRangeError, starText, type AppRatingsApi } from "./AppRatingsPage";

const page: AppRatingPage = {
  ratings: [
    { user: { id: "u1", name: "Rana", role: "passenger" }, stars: 5, feedback: "Great", created_at: "2026-11-01T08:00:00.000Z", updated_at: "2026-11-03T08:00:00.000Z" },
    { user: { id: "u2", name: "Omar", role: "driver" }, stars: 2, feedback: null, created_at: "2026-11-01T08:00:00.000Z", updated_at: "2026-11-02T08:00:00.000Z" }
  ],
  page: 1,
  limit: APP_RATINGS_PAGE_SIZE,
  total: 2,
  summary: { count: 4, average: 3.75, distribution: { "1": 0, "2": 1, "3": 0, "4": 1, "5": 2 } }
};

function fakeApi(appRatings: unknown = vi.fn().mockResolvedValue(page)) {
  return { appRatings } as unknown as AppRatingsApi & { appRatings: ReturnType<typeof vi.fn> };
}

async function setDate(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

afterEach(unmount);

describe("app ratings page", () => {
  it("formats stars and checks the date range", () => {
    expect(starText(4)).toBe("★★★★☆");
    expect(starText(9)).toBe("★★★★★");
    expect(ratingRangeError("2026-11-05", "2026-11-01")).toBe(true);
    expect(ratingRangeError("2026-11-01", "")).toBe(false);
  });

  it("shows the average, the distribution and the ratings from the API", async () => {
    const api = fakeApi();
    const host = await mount(<AppRatingsPage api={api} token="t" />);
    expect(api.appRatings).toHaveBeenCalledWith("t", { stars: undefined, from: undefined, to: undefined, page: 1, limit: APP_RATINGS_PAGE_SIZE });
    const text = host.textContent ?? "";
    expect(host.querySelector('[data-metric="app-rating-average"]')?.textContent).toBe("3.75");
    expect(text).toContain("4 ratings");
    expect(text).toContain("Rana");
    expect(text).toContain("Great");
    expect(text).toContain("No note");
    expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(5);
  });

  it("filters by stars and dates, and does not ask the API for a reversed range", async () => {
    const api = fakeApi();
    const host = await mount(<AppRatingsPage api={api} token="t" />);
    await choose(selectLabelled(host, "Stars"), "5");
    expect(api.appRatings).toHaveBeenLastCalledWith("t", expect.objectContaining({ stars: 5, page: 1 }));

    const [from, to] = [...host.querySelectorAll<HTMLInputElement>('input[type="date"]')];
    await setDate(from, "2026-11-01");
    await setDate(to, "2026-11-03");
    expect(api.appRatings).toHaveBeenLastCalledWith("t", { stars: 5, from: "2026-11-01", to: "2026-11-03", page: 1, limit: APP_RATINGS_PAGE_SIZE });

    const calls = api.appRatings.mock.calls.length;
    await setDate(from, "2026-11-10");
    expect(host.textContent).toContain("The start date is after the end date.");
    expect(api.appRatings).toHaveBeenCalledTimes(calls);
  });

  it("has empty, error with retry, and paged states", async () => {
    const empty = fakeApi(vi.fn().mockResolvedValue({ ...page, ratings: [], total: 0, summary: { count: 0, average: null, distribution: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 } } }));
    let host = await mount(<AppRatingsPage api={empty} token="t" />);
    expect(host.textContent).toContain("No ratings yet.");
    unmount();

    let fail = true;
    const flaky = fakeApi(vi.fn(() => (fail ? Promise.reject(new Error("offline")) : Promise.resolve(page))));
    host = await mount(<AppRatingsPage api={flaky} token="t" />);
    expect(host.textContent).toContain("Ratings could not be loaded.");
    fail = false;
    await click(buttonNamed(host, "Retry"));
    expect(host.textContent).toContain("Rana");
    unmount();

    const paged = fakeApi(vi.fn().mockResolvedValue({ ...page, total: 80 }));
    host = await mount(<AppRatingsPage api={paged} token="t" />);
    expect(host.textContent).toContain("Page 1 of 4");
    await click(buttonNamed(host, "Next"));
    expect(paged.appRatings).toHaveBeenLastCalledWith("t", expect.objectContaining({ page: 2 }));
  });

  it("is translated into Arabic", async () => {
    const host = await mount(<AppRatingsPage api={fakeApi()} token="t" />, "ar");
    expect(host.textContent).toContain("الملخص");
    expect(host.textContent).toContain("بلا ملاحظة");
  });
});
