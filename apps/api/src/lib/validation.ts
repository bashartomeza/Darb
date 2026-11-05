import { z } from "zod";

function normalizeExistingNumericInput(value: unknown) {
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return value;
}

export const latitudeSchema = z.preprocess(
  normalizeExistingNumericInput,
  z.number().finite().min(-90).max(90)
);

export const longitudeSchema = z.preprocess(
  normalizeExistingNumericInput,
  z.number().finite().min(-180).max(180)
);

/**
 * Place names in the older coordinate-based bodies. The columns are VARCHAR(191), so a longer
 * value must be a 400, not a database error.
 */
export const LEGACY_LABEL_MAX_LENGTH = 191;
export const legacyLabelSchema = z.string().min(1).max(LEGACY_LABEL_MAX_LENGTH);

/** True when the text holds no C0 control character or DEL (tabs and newlines included). */
export function hasNoControlCharacters(value: string) {
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u001f\u007f]/.test(value);
}

export const coordinateSchema = z.object({
  lat: latitudeSchema,
  lng: longitudeSchema
});
