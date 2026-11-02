import { createHash } from "node:crypto";
import { BATCHING_LIMITS } from "../lib/batchingConfig.js";
import { normalizePhoneToE164 } from "../lib/phone.js";

/**
 * Pure CSV parsing and row validation for the merchant bulk upload. Nothing in
 * this file touches the database; the route feeds valid orders to the existing
 * single-order creation function.
 */

export type RowError = {
  /** 1-based spreadsheet row (the header is row 1, the first data row is row 2). 0 means the whole file. */
  row: number;
  field: string | null;
  code: string;
  message_en: string;
  message_ar: string;
};

export type BulkParcel = {
  destination_label: string;
  destination_lat: number;
  destination_lng: number;
  size: "S" | "M" | "L";
  priority: "low" | "normal" | "high";
};

export type BulkOrderInput = {
  pickup_label: string;
  pickup_lat: number;
  pickup_lng: number;
  parcels: BulkParcel[];
};

export type RouteBulkParcel = {
  dropoff_details: string;
  size: "S" | "M" | "L";
  priority: "low" | "normal" | "high";
  receiver_name: string | null;
  /** Normalised to E.164 while parsing. */
  receiver_phone: string | null;
};

/** One order of the route-based CSV: every row sharing (route_key, pickup_details). */
export type RouteBulkOrderInput = {
  route_key: string;
  pickup_details: string;
  parcels: RouteBulkParcel[];
};

export type ParsedBulkOrder = { rows: number[]; input: BulkOrderInput | RouteBulkOrderInput };

export function isRouteBulkOrder(input: BulkOrderInput | RouteBulkOrderInput): input is RouteBulkOrderInput {
  return "route_key" in input;
}

export const BULK_CSV_COLUMNS = [
  "pickup_label",
  "pickup_lat",
  "pickup_lng",
  "destination_label",
  "destination_lat",
  "destination_lng",
  "size",
  "priority",
  "order_ref"
] as const;
const REQUIRED_COLUMNS = BULK_CSV_COLUMNS.slice(0, 7);
const MAX_LABEL = 200;

const FIELD_AR: Record<string, string> = {
  pickup_label: "اسم نقطة الاستلام",
  pickup_lat: "خط عرض الاستلام",
  pickup_lng: "خط طول الاستلام",
  destination_label: "اسم الوجهة",
  destination_lat: "خط عرض الوجهة",
  destination_lng: "خط طول الوجهة",
  size: "الحجم",
  priority: "الأولوية",
  order_ref: "مرجع الطلب"
};

function rowError(row: number, field: string | null, code: string, en: string, ar: string): RowError {
  return { row, field, code, message_en: en, message_ar: ar };
}

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
function normalizeDigits(value: string) {
  return value
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/٫/g, ".")
    .replace(/،/g, ",");
}

/** RFC 4180 parser with quoted fields, BOM removal and comma, semicolon or tab delimiters. */
export function parseCsvText(text: string): { rows: string[][]; error?: RowError } {
  const source = text.replace(/^﻿/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((candidate) => firstLine.split(candidate).length - 1);
  const delimiter = [",", ";", "\t"][counts.indexOf(Math.max(...counts))] ?? ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let touched = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"' && cell === "") {
      quoted = true;
      touched = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
      touched = true;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      if (touched || cell !== "") {
        row.push(cell);
        rows.push(row);
      }
      row = [];
      cell = "";
      touched = false;
    } else {
      cell += char;
      touched = true;
    }
  }
  if (quoted) {
    return {
      rows: [],
      error: rowError(0, null, "csv_unterminated_quote", "A quoted value is never closed.", "يوجد نص بين علامتي اقتباس لم يُغلق.")
    };
  }
  if (touched || cell !== "") {
    row.push(cell);
    rows.push(row);
  }
  return { rows };
}

const SIZE_WORDS: Record<string, "S" | "M" | "L"> = {
  s: "S", small: "S", "صغير": "S",
  m: "M", medium: "M", "متوسط": "M",
  l: "L", large: "L", "كبير": "L"
};
const PRIORITY_WORDS: Record<string, "low" | "normal" | "high"> = {
  low: "low", "منخفض": "low",
  normal: "normal", "عادي": "normal",
  high: "high", "مرتفع": "high", "عالي": "high"
};

function parseCoordinate(raw: string, field: string, row: number, limit: number, errors: RowError[]) {
  const value = normalizeDigits(raw.trim());
  if (value === "") {
    errors.push(rowError(row, field, "row_missing_field", `"${field}" is required.`, `الحقل "${FIELD_AR[field]}" مطلوب.`));
    return null;
  }
  const number = /^[-+]?\d+(\.\d+)?$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isFinite(number)) {
    errors.push(rowError(row, field, "row_invalid_number", `"${field}" must be a number.`, `الحقل "${FIELD_AR[field]}" يجب أن يكون رقماً.`));
    return null;
  }
  if (Math.abs(number) > limit) {
    errors.push(
      rowError(row, field, "row_out_of_range", `"${field}" must be between -${limit} and ${limit}.`, `الحقل "${FIELD_AR[field]}" يجب أن يكون بين -${limit} و ${limit}.`)
    );
    return null;
  }
  return number;
}

function parseLabel(raw: string, field: string, row: number, errors: RowError[]) {
  // eslint-disable-next-line no-control-regex
  const value = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (value === "") {
    errors.push(rowError(row, field, "row_missing_field", `"${field}" is required.`, `الحقل "${FIELD_AR[field]}" مطلوب.`));
    return null;
  }
  if (value.length > MAX_LABEL) {
    errors.push(
      rowError(row, field, "row_too_long", `"${field}" is longer than ${MAX_LABEL} characters.`, `الحقل "${FIELD_AR[field]}" أطول من ${MAX_LABEL} حرفاً.`)
    );
    return null;
  }
  return value;
}

/**
 * Validate CSV text. Valid rows are merged into orders (rows sharing a non-empty
 * order_ref and pickup become one multi-parcel order, every other row is its own
 * order). Invalid rows are reported with EN and AR messages and excluded.
 */
export function parseBulkOrdersCsv(text: string): { orders: ParsedBulkOrder[]; errors: RowError[]; totalRows: number } {
  const errors: RowError[] = [];
  if (text.length > BATCHING_LIMITS.maxBulkCsvChars) {
    return {
      orders: [],
      totalRows: 0,
      errors: [rowError(0, null, "csv_too_large", "The file is too large.", "الملف كبير جداً.")]
    };
  }
  const parsed = parseCsvText(text);
  if (parsed.error) return { orders: [], errors: [parsed.error], totalRows: 0 };
  if (parsed.rows.length === 0) {
    return { orders: [], totalRows: 0, errors: [rowError(0, null, "csv_empty", "The file has no rows.", "الملف لا يحتوي على صفوف.")] };
  }
  const header = parsed.rows[0]!.map((name) => name.trim().toLowerCase());
  // The route-based file names a route instead of coordinates.
  if (header.includes("route_key")) return parseRouteRows(header, parsed.rows.slice(1));
  const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    return {
      orders: [],
      totalRows: 0,
      errors: missing.map((column) =>
        rowError(1, column, "csv_missing_column", `Missing column "${column}".`, `العمود "${FIELD_AR[column]}" (${column}) غير موجود.`)
      )
    };
  }
  const dataRows = parsed.rows.slice(1);
  if (dataRows.length === 0) {
    return { orders: [], totalRows: 0, errors: [rowError(0, null, "csv_empty", "The file has no data rows.", "الملف لا يحتوي على صفوف بيانات.")] };
  }
  if (dataRows.length > BATCHING_LIMITS.maxBulkUploadOrders) {
    return {
      orders: [],
      totalRows: dataRows.length,
      errors: [
        rowError(
          0,
          null,
          "csv_too_many_rows",
          `At most ${BATCHING_LIMITS.maxBulkUploadOrders} rows per upload; this file has ${dataRows.length}.`,
          `الحد الأقصى ${BATCHING_LIMITS.maxBulkUploadOrders} صفاً لكل رفع، وهذا الملف يحتوي ${dataRows.length}.`
        )
      ]
    };
  }
  const column = (cells: string[], name: string) => {
    const at = header.indexOf(name);
    return at === -1 ? "" : (cells[at] ?? "");
  };

  const orders: Array<{ rows: number[]; input: BulkOrderInput }> = [];
  const byRef = new Map<string, { rows: number[]; input: BulkOrderInput }>();
  dataRows.forEach((cells, offset) => {
    const row = offset + 2;
    const before = errors.length;
    const pickupLabel = parseLabel(column(cells, "pickup_label"), "pickup_label", row, errors);
    const pickupLat = parseCoordinate(column(cells, "pickup_lat"), "pickup_lat", row, 90, errors);
    const pickupLng = parseCoordinate(column(cells, "pickup_lng"), "pickup_lng", row, 180, errors);
    const destinationLabel = parseLabel(column(cells, "destination_label"), "destination_label", row, errors);
    const destinationLat = parseCoordinate(column(cells, "destination_lat"), "destination_lat", row, 90, errors);
    const destinationLng = parseCoordinate(column(cells, "destination_lng"), "destination_lng", row, 180, errors);
    const sizeRaw = normalizeDigits(column(cells, "size")).trim().toLowerCase();
    const size = SIZE_WORDS[sizeRaw];
    if (!size) {
      errors.push(
        sizeRaw === ""
          ? rowError(row, "size", "row_missing_field", `"size" is required (S, M or L).`, `الحقل "الحجم" مطلوب (S أو M أو L).`)
          : rowError(row, "size", "row_invalid_size", `"size" must be S, M or L.`, `الحقل "الحجم" يجب أن يكون S أو M أو L.`)
      );
    }
    const priorityRaw = column(cells, "priority").trim().toLowerCase();
    const priority = priorityRaw === "" ? "normal" : PRIORITY_WORDS[priorityRaw];
    if (!priority) {
      errors.push(
        rowError(row, "priority", "row_invalid_priority", `"priority" must be low, normal or high.`, `الحقل "الأولوية" يجب أن يكون low أو normal أو high.`)
      );
    }
    if (errors.length > before) return;
    const parcel: BulkParcel = {
      destination_label: destinationLabel!,
      destination_lat: destinationLat!,
      destination_lng: destinationLng!,
      size: size!,
      priority: priority!
    };
    const pickup = { pickup_label: pickupLabel!, pickup_lat: pickupLat!, pickup_lng: pickupLng! };
    const ref = column(cells, "order_ref").trim();
    const existing = ref === "" ? undefined : byRef.get(ref);
    if (existing) {
      if (
        existing.input.pickup_label !== pickup.pickup_label ||
        existing.input.pickup_lat !== pickup.pickup_lat ||
        existing.input.pickup_lng !== pickup.pickup_lng
      ) {
        errors.push(
          rowError(row, "order_ref", "row_order_ref_pickup_mismatch", `Rows with order_ref "${ref}" must share one pickup.`, `الصفوف ذات مرجع الطلب "${ref}" يجب أن تتشارك نقطة استلام واحدة.`)
        );
        return;
      }
      if (existing.input.parcels.length >= BATCHING_LIMITS.maxParcelsPerOrder) {
        errors.push(
          rowError(row, "order_ref", "row_too_many_parcels", `An order holds at most ${BATCHING_LIMITS.maxParcelsPerOrder} parcels.`, `الطلب الواحد يحمل ${BATCHING_LIMITS.maxParcelsPerOrder} طرداً كحد أقصى.`)
        );
        return;
      }
      existing.input.parcels.push(parcel);
      existing.rows.push(row);
      return;
    }
    const order = { rows: [row], input: { ...pickup, parcels: [parcel] } };
    orders.push(order);
    if (ref !== "") byRef.set(ref, order);
  });
  return { orders, errors, totalRows: dataRows.length };
}

export const ROUTE_BULK_CSV_COLUMNS = [
  "route_key",
  "pickup_details",
  "dropoff_details",
  "size",
  "priority",
  "receiver_name",
  "receiver_phone"
] as const;
const ROUTE_REQUIRED_COLUMNS = ["route_key", "pickup_details", "dropoff_details", "size"] as const;
const ROUTE_FIELD_AR: Record<string, string> = {
  route_key: "مفتاح المسار",
  pickup_details: "تفاصيل الاستلام",
  dropoff_details: "تفاصيل التسليم",
  size: "الحجم",
  priority: "الأولوية",
  receiver_name: "اسم المستلم",
  receiver_phone: "هاتف المستلم"
};
const DETAILS_MIN = 3;
const DETAILS_MAX = 300;

function parseText(raw: string, field: string, row: number, min: number, max: number, required: boolean, errors: RowError[]) {
  // eslint-disable-next-line no-control-regex
  const value = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (value === "") {
    if (required) {
      errors.push(rowError(row, field, "row_missing_field", `"${field}" is required.`, `الحقل "${ROUTE_FIELD_AR[field]}" مطلوب.`));
    }
    return null;
  }
  if (value.length < min || value.length > max) {
    errors.push(
      rowError(row, field, "row_invalid_length", `"${field}" must be ${min} to ${max} characters.`, `الحقل "${ROUTE_FIELD_AR[field]}" يجب أن يكون بين ${min} و ${max} حرفاً.`)
    );
    return null;
  }
  return value;
}

/**
 * The route-based file: `route_key, pickup_details, dropoff_details, size,
 * priority[, receiver_name, receiver_phone]`. Rows sharing a route and a pickup
 * become one order. Whether each route exists is checked by the caller.
 */
function parseRouteRows(header: string[], dataRows: string[][]): { orders: ParsedBulkOrder[]; errors: RowError[]; totalRows: number } {
  const errors: RowError[] = [];
  const missing = ROUTE_REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    return {
      orders: [],
      totalRows: 0,
      errors: missing.map((column) =>
        rowError(1, column, "csv_missing_column", `Missing column "${column}".`, `العمود "${ROUTE_FIELD_AR[column]}" (${column}) غير موجود.`)
      )
    };
  }
  if (dataRows.length === 0) {
    return { orders: [], totalRows: 0, errors: [rowError(0, null, "csv_empty", "The file has no data rows.", "الملف لا يحتوي على صفوف بيانات.")] };
  }
  if (dataRows.length > BATCHING_LIMITS.maxBulkUploadOrders) {
    return {
      orders: [],
      totalRows: dataRows.length,
      errors: [
        rowError(
          0,
          null,
          "csv_too_many_rows",
          `At most ${BATCHING_LIMITS.maxBulkUploadOrders} rows per upload; this file has ${dataRows.length}.`,
          `الحد الأقصى ${BATCHING_LIMITS.maxBulkUploadOrders} صفاً لكل رفع، وهذا الملف يحتوي ${dataRows.length}.`
        )
      ]
    };
  }
  const column = (cells: string[], name: string) => {
    const at = header.indexOf(name);
    return at === -1 ? "" : (cells[at] ?? "");
  };

  const orders: Array<{ rows: number[]; input: RouteBulkOrderInput }> = [];
  const byGroup = new Map<string, { rows: number[]; input: RouteBulkOrderInput }>();
  dataRows.forEach((cells, offset) => {
    const row = offset + 2;
    const before = errors.length;
    const routeKey = column(cells, "route_key").trim().toLowerCase();
    if (routeKey === "") {
      errors.push(rowError(row, "route_key", "row_missing_field", `"route_key" is required.`, `الحقل "مفتاح المسار" مطلوب.`));
    } else if (!/^[a-z0-9-]{1,80}$/.test(routeKey)) {
      errors.push(rowError(row, "route_key", "row_invalid_route_key", `"route_key" is not a route key.`, `الحقل "مفتاح المسار" غير صالح.`));
    }
    const pickupDetails = parseText(column(cells, "pickup_details"), "pickup_details", row, DETAILS_MIN, DETAILS_MAX, true, errors);
    const dropoffDetails = parseText(column(cells, "dropoff_details"), "dropoff_details", row, DETAILS_MIN, DETAILS_MAX, true, errors);
    const sizeRaw = normalizeDigits(column(cells, "size")).trim().toLowerCase();
    const size = SIZE_WORDS[sizeRaw];
    if (!size) {
      errors.push(
        sizeRaw === ""
          ? rowError(row, "size", "row_missing_field", `"size" is required (S, M or L).`, `الحقل "الحجم" مطلوب (S أو M أو L).`)
          : rowError(row, "size", "row_invalid_size", `"size" must be S, M or L.`, `الحقل "الحجم" يجب أن يكون S أو M أو L.`)
      );
    }
    const priorityRaw = column(cells, "priority").trim().toLowerCase();
    const priority = priorityRaw === "" ? "normal" : PRIORITY_WORDS[priorityRaw];
    if (!priority) {
      errors.push(
        rowError(row, "priority", "row_invalid_priority", `"priority" must be low, normal or high.`, `الحقل "الأولوية" يجب أن يكون low أو normal أو high.`)
      );
    }
    const receiverName = parseText(column(cells, "receiver_name"), "receiver_name", row, 2, 80, false, errors);
    const phoneRaw = normalizeDigits(column(cells, "receiver_phone")).trim();
    let receiverPhone: string | null = null;
    if (phoneRaw !== "") {
      try {
        receiverPhone = normalizePhoneToE164(phoneRaw, { region: "PS" });
      } catch {
        errors.push(rowError(row, "receiver_phone", "row_invalid_phone", `"receiver_phone" is not a valid phone number.`, `الحقل "هاتف المستلم" ليس رقم هاتف صالحاً.`));
      }
    }
    if (errors.length > before) return;
    const parcel: RouteBulkParcel = {
      dropoff_details: dropoffDetails!,
      size: size!,
      priority: priority!,
      receiver_name: receiverName,
      receiver_phone: receiverPhone
    };
    const group = `${routeKey}\u0000${pickupDetails}`;
    const existing = byGroup.get(group);
    if (existing) {
      if (existing.input.parcels.length >= BATCHING_LIMITS.maxParcelsPerOrder) {
        errors.push(
          rowError(row, "pickup_details", "row_too_many_parcels", `An order holds at most ${BATCHING_LIMITS.maxParcelsPerOrder} parcels.`, `الطلب الواحد يحمل ${BATCHING_LIMITS.maxParcelsPerOrder} طرداً كحد أقصى.`)
        );
        return;
      }
      existing.input.parcels.push(parcel);
      existing.rows.push(row);
      return;
    }
    const order = { rows: [row], input: { route_key: routeKey, pickup_details: pickupDetails!, parcels: [parcel] } };
    orders.push(order);
    byGroup.set(group, order);
  });
  return { orders, errors, totalRows: dataRows.length };
}

/**
 * Per-order idempotency key derived from the upload key and the order content,
 * so a retry of the same upload replays every created order, an edited row
 * creates fresh, and two identical rows stay two distinct orders.
 */
export function bulkRowKeys(uploadKey: string, orders: ParsedBulkOrder[]) {
  const upload = createHash("sha256").update(uploadKey).digest("hex").slice(0, 24);
  const seen = new Map<string, number>();
  return orders.map((order) => {
    const input = order.input;
    const content = createHash("sha256")
      .update(
        JSON.stringify(
          isRouteBulkOrder(input)
            ? {
                r: input.route_key,
                p: input.pickup_details,
                c: input.parcels.map((parcel) => [parcel.dropoff_details, parcel.size, parcel.priority, parcel.receiver_name, parcel.receiver_phone])
              }
            : {
                p: [input.pickup_label, input.pickup_lat.toFixed(6), input.pickup_lng.toFixed(6)],
                c: input.parcels.map((parcel) => [
                  parcel.destination_label,
                  parcel.destination_lat.toFixed(6),
                  parcel.destination_lng.toFixed(6),
                  parcel.size,
                  parcel.priority
                ])
              }
        )
      )
      .digest("hex")
      .slice(0, 24);
    const occurrence = seen.get(content) ?? 0;
    seen.set(content, occurrence + 1);
    return `bulk:${upload}:${content}:${occurrence}`;
  });
}
