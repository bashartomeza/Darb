import { afterEach, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { CheckpointDirectoryService, readResearchDirectory } from "../services/checkpointDirectory.js";
import { directoryFixture } from "./checkpointDirectoryFixture.js";

const fixtures: ReturnType<typeof directoryFixture>[] = [];
function fixture(approved = false) { const result = directoryFixture(approved); fixtures.push(result); return result; }
afterEach(() => { fixtures.splice(0).forEach(value => value.dispose()); });
describe("backend-owned research directory", () => {
  it("retains identity, provenance and separate duplicate names across cities", () => {
    const f = fixture(), result = readResearchDirectory(f.file, f.manifest);
    expect(result.checkpoints).toHaveLength(3); expect(result.city_count).toBe(2);
    expect(result.checkpoints.filter(row => row.checkpoint_name_ar === "اسم تجريبي مكرر")
      .map(row => [row.research_row_key, row.city_ar])).toEqual([
        ["synthetic-0", "مدينة تجريبية أ"], ["synthetic-2", "مدينة تجريبية ب"]]);
    expect(result.checkpoints.every(row => row.provider_checkpoint_id === null && row.latitude === null && row.longitude === null)).toBe(true);
    expect(result.source_csv_sha256).toBe("a".repeat(64));
  });
  it("cannot publish research data before both independent approval gates", () => {
    const f = fixture(); const service = new CheckpointDirectoryService(f.file, f.manifest);
    expect(service.available()).toBe(false); expect(() => service.list()).toThrow("checkpoint_directory_unavailable");
    f.data.default_publish_state = "APPROVED"; f.data.checkpoints.forEach(row => row.approved_for_publication = true);
    expect(new CheckpointDirectoryService(f.file, f.write()).available()).toBe(false);
  });
  it("an individually unapproved row cannot publish under approved metadata", () => {
    const f = fixture(true); f.data.checkpoints[0].approved_for_publication = false;
    expect(new CheckpointDirectoryService(f.file, f.write()).available()).toBe(false);
  });
  it("serves approved synthetic directory names without live traffic or map coordinates", () => {
    const f = fixture(true), result = new CheckpointDirectoryService(f.file, f.manifest).list();
    expect(result.count).toBe(3); expect(result.provenance.provider_dataset_completeness).toBe("UNVERIFIED");
    expect(result.checkpoints.every(row => row.traffic_status === "unavailable" && row.latitude === null &&
      row.longitude === null && row.provider_checkpoint_id === null && !row.ready_for_map)).toBe(true);
    expect(result.checkpoints[0]).not.toHaveProperty("id");
  });
  it("rejects bytes that differ from the version manifest", () => {
    const f = fixture(); writeFileSync(f.file, JSON.stringify(f.data) + " ");
    expect(() => readResearchDirectory(f.file, f.manifest)).toThrow("checkpoint_directory_unavailable");
  });
  it.each(["count", "cities", "identity", "coordinates", "provider-id", "status", "map", "city-alias"])("rejects invalid %s without leaking data", mode => {
    const f = fixture();
    if (mode === "count") f.data.count++;
    if (mode === "cities") f.data.city_count++;
    if (mode === "identity") f.data.checkpoints[1].research_row_key = f.data.checkpoints[0].research_row_key;
    if (mode === "coordinates") Object.assign(f.data.checkpoints[0], { latitude: 31.7, longitude: 35.2 });
    if (mode === "provider-id") Object.assign(f.data.checkpoints[0], { provider_checkpoint_id: "invented" });
    if (mode === "status") f.data.checkpoints[0].traffic_status = "open";
    if (mode === "map") f.data.checkpoints[0].ready_for_map = true;
    if (mode === "city-alias") f.data.checkpoints[1].city_slug = "different-slug-for-same-city";
    expect(() => readResearchDirectory(f.file, f.write())).toThrow("checkpoint_directory_unavailable");
  });
  it.each(["{", "x".repeat(1_000_001)])("rejects malformed or oversized local data", raw => {
    const f = fixture(); writeFileSync(f.file, raw);
    expect(() => readResearchDirectory(f.file, f.manifest)).toThrow("checkpoint_directory_unavailable");
  });
});
