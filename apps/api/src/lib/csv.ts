/**
 * Minimal RFC 4180 writer for operational exports.
 *
 * Cells that a spreadsheet would execute as a formula (leading `= + - @`, tab
 * or carriage return) are prefixed with an apostrophe, so user-entered labels
 * cannot turn an export into a formula-injection vector.
 */
export type CsvCell = string | number | boolean | Date | null | undefined;

function formatCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [header.map(formatCell).join(","), ...rows.map((row) => row.map(formatCell).join(","))];
  // A BOM makes Excel read the Arabic labels as UTF-8.
  return `﻿${lines.join("\r\n")}\r\n`;
}
