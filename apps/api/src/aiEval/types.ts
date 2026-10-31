export const REQUEST_TYPES = ["ride", "parcel", "unknown"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

/** Stop id, or one of the sentinels "ambiguous" (place matches several stops) / "unsupported" (outside the network), or null (not stated). */
export type PlaceValue = string | null;

export const SCORED_FIELDS = ["type", "pickup", "dropoff", "time", "seats", "size"] as const;
export type ScoredField = (typeof SCORED_FIELDS)[number];

/** The normalised shape every parser is reduced to before scoring. */
export type NormalizedParse = {
  type: RequestType;
  pickup: PlaceValue;
  dropoff: PlaceValue;
  /** null | "now" | "HH:MM" | "morning|afternoon|evening|noon|tonight" | any of those prefixed by "tomorrow " / "day-after-tomorrow ". */
  time: string | null;
  seats: number | null;
  size: "small" | "medium" | "large" | null;
};

export type EvalCase = {
  id: string;
  category: string;
  text: string;
  expected: NormalizedParse;
};

export type EvalStop = { id: string; name_ar: string; name_en: string };

export type EvalDataset = {
  version: number;
  now: string;
  timezone: string;
  stops: EvalStop[];
  cases: EvalCase[];
};

/** Context handed to parseRequest(text, context). Mirrors what the real parser is expected to receive. */
export type ParseContext = {
  now: string;
  timezone: string;
  locale: "ar" | "en";
  stops: EvalStop[];
  /** Only set for opt-in live runs ("groq" | "gemini"). */
  provider?: string;
};

/** Adapter: anything that turns text into a NormalizedParse. */
export type EvalParser = (text: string, context: ParseContext) => Promise<NormalizedParse> | NormalizedParse;
