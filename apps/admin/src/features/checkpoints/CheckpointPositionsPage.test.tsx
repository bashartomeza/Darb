// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiError, CheckpointPosition } from "../../api";
import { buttonNamed, click, dialog, inputNamed, mount, settle, type, unmount } from "../../testing/mount";
import {
  CHECKPOINT_POSITIONS_PAGE_SIZE,
  CheckpointPositionsPage,
  emptyPositionForm,
  insideWestBank,
  positionDraftFrom,
  positionUpdateFrom,
  validatePositionForm,
  type CheckpointPositionsApi
} from "./CheckpointPositionsPage";

const huwwara: CheckpointPosition = {
  id: "pos_1",
  city_ar: "نابلس",
  name_ar: "حوارة",
  latitude: 32.153,
  longitude: 35.256,
  confidence: "medium",
  source: "corrected polygon centroid",
  dataset_name: null,
  note: null,
  created_at: "2026-11-04T08:00:00.000Z",
  updated_at: "2026-11-04T08:00:00.000Z"
};

function apiError(status: number, message: string) {
  const error = new Error(message) as ApiError;
  error.status = status;
  return error;
}

function fakeApi(overrides: Partial<Record<keyof CheckpointPositionsApi, unknown>> = {}) {
  return {
    checkpointPositions: vi.fn().mockResolvedValue({ positions: [huwwara], page: 1, limit: CHECKPOINT_POSITIONS_PAGE_SIZE, total: 1 }),
    createCheckpointPosition: vi.fn().mockResolvedValue({ position: huwwara }),
    updateCheckpointPosition: vi.fn().mockResolvedValue({ position: huwwara }),
    deleteCheckpointPosition: vi.fn().mockResolvedValue({ deleted: true }),
    unplacedCheckpoints: vi.fn().mockResolvedValue({ available: true, unplaced: [{ id: "aweenrayeh:p2", city_ar: "رام الله", name_ar: "عطارة", reason: "no_name_match" }] }),
    ...overrides
  } as unknown as CheckpointPositionsApi & Record<keyof CheckpointPositionsApi, ReturnType<typeof vi.fn>>;
}

async function submit(form: HTMLFormElement) {
  await click(form.querySelector<HTMLButtonElement>('button[type="submit"]')!);
  await settle();
}

afterEach(unmount);

describe("checkpoint position rules", () => {
  it("accepts West Bank positions only", () => {
    expect(insideWestBank(32.153, 35.256)).toBe(true);
    expect(insideWestBank(31.5, 34.45)).toBe(false); // Gaza
    expect(insideWestBank(35.2, 32.1)).toBe(false); // swapped
  });

  it("validates a form the way the API does", () => {
    const form = { ...emptyPositionForm("رام الله", "عطارة"), latitude: "31.99", longitude: "35.19", source: "screenshot" };
    expect(validatePositionForm(form, "create")).toBeNull();
    expect(validatePositionForm({ ...form, name_ar: "x" }, "create")).toBe("names");
    expect(validatePositionForm({ ...form, source: "" }, "create")).toBe("source");
    expect(validatePositionForm({ ...form, source: "" }, "edit")).toBeNull();
    expect(validatePositionForm({ ...form, latitude: "abc" }, "create")).toBe("coordinates");
    expect(validatePositionForm({ ...form, latitude: "33.5" }, "create")).toBe("outside_area");
    expect(positionDraftFrom({ ...form, note: "  " })).toEqual({ city_ar: "رام الله", name_ar: "عطارة", latitude: 31.99, longitude: 35.19, confidence: "unverified", source: "screenshot", note: null });
  });

  it("sends only the fields that changed", () => {
    const form = { ...emptyPositionForm(huwwara.city_ar, huwwara.name_ar), latitude: "32.153", longitude: "35.3", confidence: "high" as const, note: "" };
    expect(positionUpdateFrom(form, huwwara)).toEqual({ longitude: 35.3, confidence: "high" });
  });
});

describe("checkpoint positions page", () => {
  it("lists positions and the partner checkpoints that have none", async () => {
    const api = fakeApi();
    const host = await mount(<CheckpointPositionsPage api={api} token="t" search="" />);
    expect(api.checkpointPositions).toHaveBeenCalledWith("t", { search: "", page: 1, limit: CHECKPOINT_POSITIONS_PAGE_SIZE });
    const text = host.textContent ?? "";
    expect(text).toContain("حوارة");
    expect(text).toContain("32.153000, 35.256000");
    expect(text).toContain("Medium");
    expect(text).toContain("عطارة");
    expect(text).toContain("No name match");
  });

  it("adds a position for an unplaced checkpoint with the name filled in", async () => {
    const api = fakeApi();
    const host = await mount(<CheckpointPositionsPage api={api} token="t" search="" />);
    await click(buttonNamed(host, "Place it"));
    const form = dialog()!.querySelector("form")!;
    expect(inputNamed(form, "city_ar").value).toBe("رام الله");
    expect(inputNamed(form, "name_ar").value).toBe("عطارة");

    await type(inputNamed(form, "latitude"), "31.99");
    await type(inputNamed(form, "longitude"), "35.19");
    await type(inputNamed(form, "source"), "user screenshot");
    await submit(form);

    expect(api.createCheckpointPosition).toHaveBeenCalledWith("t", {
      city_ar: "رام الله", name_ar: "عطارة", latitude: 31.99, longitude: 35.19, confidence: "unverified", source: "user screenshot", note: null
    });
    expect(dialog()).toBeNull();
    expect(host.textContent).toContain("Position added.");
    expect(api.unplacedCheckpoints).toHaveBeenCalledTimes(2);
  });

  it("refuses positions outside the West Bank before calling the API, and shows duplicate errors", async () => {
    const api = fakeApi({ createCheckpointPosition: vi.fn().mockRejectedValue(apiError(409, "checkpoint_position_exists")) });
    const host = await mount(<CheckpointPositionsPage api={api} token="t" search="" />);
    await click(buttonNamed(host, "Add position"));
    const form = dialog()!.querySelector("form")!;
    await type(inputNamed(form, "city_ar"), "نابلس");
    await type(inputNamed(form, "name_ar"), "حوارة");
    await type(inputNamed(form, "latitude"), "35.25");
    await type(inputNamed(form, "longitude"), "32.15");
    await type(inputNamed(form, "source"), "survey");
    await submit(form);
    expect(api.createCheckpointPosition).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain("outside the West Bank");

    await type(inputNamed(form, "latitude"), "32.15");
    await type(inputNamed(form, "longitude"), "35.25");
    await submit(form);
    expect(api.createCheckpointPosition).toHaveBeenCalledOnce();
    expect(dialog()?.textContent).toContain("already has a position");
  });

  it("edits coordinates, confidence and note", async () => {
    const api = fakeApi();
    const host = await mount(<CheckpointPositionsPage api={api} token="t" search="" />);
    await click(buttonNamed(host, "Edit"));
    const form = dialog()!.querySelector("form")!;
    expect(inputNamed(form, "name_ar").disabled).toBe(true);
    await type(inputNamed(form, "latitude"), "32.16");
    await type(inputNamed(form, "note"), "checked on site");
    await submit(form);
    expect(api.updateCheckpointPosition).toHaveBeenCalledWith("t", "pos_1", { latitude: 32.16, note: "checked on site" });
    expect(host.textContent).toContain("Position saved.");
  });

  it("asks before deleting", async () => {
    const api = fakeApi();
    const host = await mount(<CheckpointPositionsPage api={api} token="t" search="" />);
    await click(buttonNamed(host, "Delete"));
    expect(api.deleteCheckpointPosition).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain("Delete this checkpoint position?");
    await click(buttonNamed(dialog()!, "Delete"));
    expect(api.deleteCheckpointPosition).toHaveBeenCalledWith("t", "pos_1");
    expect(host.textContent).toContain("Position deleted.");
  });

  it("searches on the server and has empty, error and unavailable states", async () => {
    const api = fakeApi({
      checkpointPositions: vi.fn().mockResolvedValue({ positions: [], page: 1, limit: 50, total: 0 }),
      unplacedCheckpoints: vi.fn().mockResolvedValue({ available: false, unplaced: [] })
    });
    let host = await mount(<CheckpointPositionsPage api={api} token="t" search=" حو " />);
    expect(api.checkpointPositions).toHaveBeenCalledWith("t", { search: "حو", page: 1, limit: CHECKPOINT_POSITIONS_PAGE_SIZE });
    expect(host.textContent).toContain("Nothing matches your search.");
    expect(host.textContent).toContain("The partner checkpoint list is not available right now");
    unmount();

    let fail = true;
    const flaky = fakeApi({ checkpointPositions: vi.fn(() => (fail ? Promise.reject(new Error("offline")) : Promise.resolve({ positions: [huwwara], page: 1, limit: 50, total: 1 }))) });
    host = await mount(<CheckpointPositionsPage api={flaky} token="t" search="" />);
    expect(host.textContent).toContain("Checkpoint positions could not be loaded.");
    fail = false;
    await click(buttonNamed(host, "Retry"));
    expect(host.textContent).toContain("حوارة");
  });
});
