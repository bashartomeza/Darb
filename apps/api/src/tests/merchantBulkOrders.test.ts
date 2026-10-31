import { describe, expect, it } from "vitest";
import { BATCHING_LIMITS } from "../lib/batchingConfig.js";
import { bulkRowKeys, parseBulkOrdersCsv, parseCsvText } from "../services/merchantBulkOrders.js";

const HEADER =
  "pickup_label,pickup_lat,pickup_lng,destination_label,destination_lat,destination_lng,size,priority,order_ref";
const row = (extra = "Bethlehem Center,31.7054,35.2024,S,normal,") => `Hebron Depot,31.5326,35.0998,${extra}`;

describe("parseCsvText", () => {
  it("handles quotes, embedded commas, escaped quotes, CRLF and BOM", () => {
    const { rows } = parseCsvText('﻿a,b\r\n"x, y","say ""hi"""\r\n');
    expect(rows).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
  });
  it("detects tab and semicolon delimiters (spreadsheet paste)", () => {
    expect(parseCsvText("a\tb\n1\t2").rows[1]).toEqual(["1", "2"]);
    expect(parseCsvText("a;b\n1;2").rows[1]).toEqual(["1", "2"]);
  });
  it("reports an unterminated quote", () => {
    expect(parseCsvText('a,b\n"x,1').error?.code).toBe("csv_unterminated_quote");
  });
});

describe("parseBulkOrdersCsv", () => {
  it("builds one order per row", () => {
    const result = parseBulkOrdersCsv([HEADER, row(), row("Beit Jala,31.7155,35.1873,M,high,")].join("\n"));
    expect(result.errors).toEqual([]);
    expect(result.orders).toHaveLength(2);
    expect(result.orders[1]!.input.parcels[0]).toMatchObject({ size: "M", priority: "high" });
  });

  it("merges rows sharing an order_ref into one multi-parcel order", () => {
    const result = parseBulkOrdersCsv([HEADER, row("A,31.7,35.2,S,normal,REF1"), row("B,31.71,35.19,L,,REF1")].join("\n"));
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]!.input.parcels).toHaveLength(2);
    expect(result.orders[0]!.rows).toEqual([2, 3]);
    expect(result.orders[0]!.input.parcels[1]!.priority).toBe("normal");
  });

  it("reports row-level errors in English and Arabic with row numbers", () => {
    const csv = [HEADER, row("X,95,35.2,Q,urgent,"), row(",31.7,abc,S,normal,"), row()].join("\n");
    const result = parseBulkOrdersCsv(csv);
    expect(result.orders).toHaveLength(1);
    const codes = result.errors.map((error) => `${error.row}:${error.field}:${error.code}`);
    expect(codes).toContain("2:destination_lat:row_out_of_range");
    expect(codes).toContain("2:size:row_invalid_size");
    expect(codes).toContain("2:priority:row_invalid_priority");
    expect(codes).toContain("3:destination_label:row_missing_field");
    expect(codes).toContain("3:destination_lng:row_invalid_number");
    for (const error of result.errors) {
      expect(error.message_en.length).toBeGreaterThan(0);
      expect(error.message_ar).toMatch(/[؀-ۿ]/);
    }
  });

  it("accepts Arabic-Indic digits and Arabic size words", () => {
    const result = parseBulkOrdersCsv([HEADER, row("حي الشرق,٣١٫٧٠٥٤,٣٥٫٢٠٢٤,كبير,عادي,")].join("\n"));
    expect(result.errors).toEqual([]);
    expect(result.orders[0]!.input.parcels[0]).toMatchObject({ destination_lat: 31.7054, size: "L", priority: "normal" });
  });

  it("rejects missing columns, empty files and too many rows", () => {
    expect(parseBulkOrdersCsv("pickup_label\nx").errors.map((error) => error.code)).toContain("csv_missing_column");
    expect(parseBulkOrdersCsv("").errors[0]!.code).toBe("csv_empty");
    expect(parseBulkOrdersCsv(HEADER).errors[0]!.code).toBe("csv_empty");
    const many = [HEADER, ...Array.from({ length: BATCHING_LIMITS.maxBulkUploadOrders + 1 }, () => row())].join("\n");
    const result = parseBulkOrdersCsv(many);
    expect(result.errors[0]).toMatchObject({ code: "csv_too_many_rows", row: 0 });
    expect(result.errors[0]!.message_ar).toContain("50");
  });

  it("accepts exactly 50 rows", () => {
    const fifty = [HEADER, ...Array.from({ length: 50 }, () => row())].join("\n");
    const result = parseBulkOrdersCsv(fifty);
    expect(result.errors).toEqual([]);
    expect(result.orders).toHaveLength(50);
  });

  it("rejects an oversized payload and a pickup mismatch within one order_ref", () => {
    expect(parseBulkOrdersCsv("x".repeat(BATCHING_LIMITS.maxBulkCsvChars + 1)).errors[0]!.code).toBe("csv_too_large");
    const mismatch = parseBulkOrdersCsv(
      [HEADER, row("A,31.7,35.2,S,normal,R"), "Other Depot,31.5,35.0,B,31.7,35.2,S,normal,R"].join("\n")
    );
    expect(mismatch.errors[0]!.code).toBe("row_order_ref_pickup_mismatch");
  });
});

describe("bulkRowKeys", () => {
  const parsed = parseBulkOrdersCsv([HEADER, row(), row(), row("Beit Jala,31.7155,35.1873,M,high,")].join("\n"));
  it("is stable for a retry and unique per order, including identical rows", () => {
    const first = bulkRowKeys("upload-key-0001", parsed.orders);
    expect(bulkRowKeys("upload-key-0001", parsed.orders)).toEqual(first);
    expect(new Set(first).size).toBe(3);
    for (const key of first) expect(key).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
  });
  it("changes with the upload key and keeps unedited rows stable when another row changes", () => {
    const base = bulkRowKeys("upload-key-0001", parsed.orders);
    expect(bulkRowKeys("upload-key-0002", parsed.orders)[0]).not.toBe(base[0]);
    const edited = parseBulkOrdersCsv(
      [HEADER, row("Changed,31.7,35.2,S,normal,"), row(), row("Beit Jala,31.7155,35.1873,M,high,")].join("\n")
    );
    const after = bulkRowKeys("upload-key-0001", edited.orders);
    expect(after[0]).not.toBe(base[0]);
    expect(after[2]).toBe(base[2]);
  });
});
