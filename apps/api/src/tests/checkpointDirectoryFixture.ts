import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Synthetic names only: never copies supplied research listings into Git/CI. */
export function directoryFixture(approved = false) {
  const cityCounts = { "مدينة تجريبية أ": 2, "مدينة تجريبية ب": 1 };
  const data = { schema_version: 1, captured_date: "2026-10-23", source: "synthetic-only",
    source_csv_sha256: "a".repeat(64), dataset_role: "RESEARCH_DIRECTORY_ONLY",
    provider_api_ids_verified: false, coordinate_data_available: false, traffic_status_values_available: false,
    default_publish_state: approved ? "APPROVED" : "BLOCKED", count: 3, city_count: 2, city_counts: cityCounts,
    checkpoints: [0, 1, 2].map(index => ({ research_row_key: `synthetic-${index}`, city_ar: index < 2 ? "مدينة تجريبية أ" : "مدينة تجريبية ب",
      city_slug: index < 2 ? "test-a" : "test-b", checkpoint_name_ar: index === 1 ? "بوابة تجريبية" : "اسم تجريبي مكرر",
      public_source_url: "https://example.invalid/research", provider_checkpoint_id: null,
      latitude: null, longitude: null, coordinate_verified: false, provider_id_verified: false,
      traffic_status: "unknown", ready_for_map: false, approved_for_publication: approved })) };
  const folder = mkdtempSync(join(tmpdir(), "masari-directory-fixture-")), file = join(folder, "directory.json");
  function write() {
    const bytes = JSON.stringify(data); writeFileSync(file, bytes);
    return { schema_version: 1, version: "synthetic-v1", sha256: createHash("sha256").update(bytes).digest("hex"),
      count: 3, city_counts: cityCounts, publication: approved ? "APPROVED" : "BLOCKED_PENDING_PROVIDER_PERMISSION" };
  }
  return { data, file, manifest: write(), write, dispose: () => rmSync(folder, { recursive: true, force: true }) };
}
