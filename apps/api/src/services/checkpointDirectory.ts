import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync, fstatSync } from "node:fs";
import { z } from "zod";
import { HttpError } from "../middleware/error.js";

export type DirectoryManifest = {
  schema_version: number; version: string; sha256: string; count: number;
  city_counts: Record<string, number>; publication: string;
};
const manifest = JSON.parse(readFileSync(new URL("../../data/checkpoint-directory.v1.manifest.json", import.meta.url), "utf8")) as DirectoryManifest;
// Local server resource bound, not a claim about any provider response size.
const MAX_DIRECTORY_BYTES = 1_000_000;
const text = z.string().min(1).refine(value => value.trim().length > 0);
const rowSchema = z.object({
  research_row_key: text, city_ar: text, city_slug: text, checkpoint_name_ar: text,
  public_source_url: z.string().url(), provider_checkpoint_id: z.null(),
  latitude: z.null(), longitude: z.null(), coordinate_verified: z.literal(false),
  provider_id_verified: z.literal(false), traffic_status: z.literal("unknown"),
  ready_for_map: z.literal(false), approved_for_publication: z.boolean()
});
const fileSchema = z.object({
  schema_version: z.literal(1), captured_date: text, source: text,
  source_csv_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  dataset_role: z.literal("RESEARCH_DIRECTORY_ONLY"),
  provider_api_ids_verified: z.literal(false), coordinate_data_available: z.literal(false),
  traffic_status_values_available: z.literal(false),
  default_publish_state: z.enum(["BLOCKED", "APPROVED"]),
  count: z.number().int().positive(), city_count: z.number().int().positive(),
  city_counts: z.record(z.string(), z.number().int().positive()),
  checkpoints: z.array(rowSchema)
});
export type ResearchDirectory = z.infer<typeof fileSchema>;

function sameCounts(a: Record<string, number>, b: Record<string, number>) {
  return Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([key, count]) => b[key] === count);
}

/** Offline import verification. Never serves records or upgrades approval. */
export function readResearchDirectory(file: string, expected: DirectoryManifest = manifest): ResearchDirectory {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    if (!fstatSync(fd).isFile()) throw new Error("not_regular_file");
    const buffer = Buffer.alloc(MAX_DIRECTORY_BYTES + 1);
    let used = 0;
    while (used < buffer.length) {
      const read = readSync(fd, buffer, used, buffer.length - used, null);
      if (read === 0) break;
      used += read;
    }
    if (used > MAX_DIRECTORY_BYTES) throw new Error("resource_limit");
    const bytes = buffer.subarray(0, used);
    if (createHash("sha256").update(bytes).digest("hex") !== expected.sha256) throw new Error("hash_mismatch");
    const result = fileSchema.parse(JSON.parse(bytes.toString("utf8")));
    const counts: Record<string, number> = {};
    const identities = new Set<string>();
    const cities = new Map<string, string>();
    const citySlugs = new Map<string, string>();
    for (const row of result.checkpoints) {
      if (identities.has(row.research_row_key)) throw new Error("duplicate_identity");
      identities.add(row.research_row_key);
      if (cities.has(row.city_slug) && cities.get(row.city_slug) !== row.city_ar) throw new Error("inconsistent_city");
      cities.set(row.city_slug, row.city_ar);
      if (citySlugs.has(row.city_ar) && citySlugs.get(row.city_ar) !== row.city_slug) throw new Error("inconsistent_city");
      citySlugs.set(row.city_ar, row.city_slug);
      counts[row.city_ar] = (counts[row.city_ar] ?? 0) + 1;
    }
    if (result.count !== expected.count || result.checkpoints.length !== expected.count ||
      result.city_count !== Object.keys(counts).length || !sameCounts(counts, result.city_counts) ||
      !sameCounts(counts, expected.city_counts)) throw new Error("inventory_mismatch");
    return result;
  } catch {
    // No source record, raw validation error, private filename or file contents in logs/API.
    throw new HttpError(503, "checkpoint_directory_unavailable");
  } finally { if (fd !== undefined) closeSync(fd); }
}

export class CheckpointDirectoryService {
  private cached?: ResearchDirectory;
  constructor(private readonly file: string, private readonly expected = manifest) {}
  private read() { return this.cached ??= readResearchDirectory(this.file, this.expected); }
  available(): boolean {
    try {
      const data = this.read();
      return this.expected.publication === "APPROVED" && data.default_publish_state === "APPROVED" &&
        data.checkpoints.every(row => row.approved_for_publication);
    } catch { return false; }
  }
  list() {
    if (!this.available()) throw new HttpError(503, "checkpoint_directory_unavailable");
    const data = this.read();
    return {
      schema_version: 1, version: this.expected.version, dataset_role: data.dataset_role,
      provenance: { source: data.source, captured_date: data.captured_date, source_csv_sha256: data.source_csv_sha256,
        provider_dataset_completeness: "UNVERIFIED", research_verification: "NAMES_AND_CITIES_ONLY" },
      count: data.count, city_count: data.city_count,
      checkpoints: data.checkpoints.map(row => ({
        research_row_key: row.research_row_key, checkpoint_name_ar: row.checkpoint_name_ar,
        city_ar: row.city_ar, city_slug: row.city_slug, public_source_url: row.public_source_url,
        provider_checkpoint_id: null, latitude: null, longitude: null, coordinate_verified: false,
        provider_id_verified: false, ready_for_map: false, traffic_status: "unavailable"
      }))
    };
  }
}
