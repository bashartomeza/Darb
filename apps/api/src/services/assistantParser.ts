/**
 * Deterministic, route/stop-aware request parser for the passenger assistant.
 *
 * `parseRequest(text, context)` is a PURE function: no network, no database, no
 * clock other than `context.now`. It is the fallback used when the AI provider
 * is unavailable, and the accuracy harness calls it directly. Places are never
 * hard-coded: every pickup/dropoff comes from `context.places` (real stops of
 * published routes). The only built-in knowledge is dialect vocabulary
 * (markers, numbers, day/period words) and spelling synonyms that are used to
 * match the names found in the supplied stop data.
 */

export type AssistantLocale = "ar" | "en";

export type AssistantPlace = {
  key: string;
  name_ar: string;
  name_en: string;
  lat?: number;
  lng?: number;
  /** Optional curated aliases (e.g. from admin data). */
  aliases?: string[];
};

export type AssistantRoute = {
  route_key: string;
  stops: Array<{
    stop_key: string;
    sequence: number;
    passenger_pickup: boolean;
    passenger_dropoff: boolean;
  }>;
};

export type ParseContext = {
  now: Date;
  places: AssistantPlace[];
  routes?: AssistantRoute[];
  locale?: AssistantLocale;
  /** IANA zone used to resolve clock times. */
  timeZone?: string;
  /** Earlier user turns of the same conversation, oldest first. */
  priorTurns?: string[];
};

export type ParsedPlace = {
  key: string;
  label_ar: string;
  label_en: string;
  lat?: number;
  lng?: number;
};

export type IntentType = "ride" | "parcel" | "unknown";
export type ParcelSize = "small" | "medium" | "large";
export type MissingField = "pickup" | "dropoff" | "time" | "seats" | "route";

export type ParsedIntent = {
  type: IntentType;
  pickup: ParsedPlace | null;
  dropoff: ParsedPlace | null;
  /** ISO-8601 with the passenger's UTC offset, or null. */
  time: string | null;
  /** Passenger seats (ride only). */
  seats: number | null;
  /** Parcel size (parcel only). */
  size: ParcelSize | null;
  /** 0..1. */
  confidence: number;
  missing: MissingField[];
  /** The text named a known place that no active stop serves. */
  unsupported_place: boolean;
  source: "rules" | "provider";
};

export const CONFIDENCE_PREFILL = 0.7;
export const MAX_RIDE_SEATS = 4;
export const ROUTE_MISMATCH_PENALTY = 0.4;
const DEFAULT_TIME_ZONE = "Asia/Hebron";

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

const EASTERN_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const KEEP_AL = new Set(["الان", "الا", "الي", "الى", "الله"]);

function stripArticle(token: string): string {
  if (KEEP_AL.has(token)) return token;
  if (/^(al|el)$/.test(token)) return "";
  // للخليل -> لخليل ; بالخليل -> بخليل ; والخليل -> وخليل
  if (token.length > 4 && token.startsWith("لل")) return `ل${token.slice(2)}`;
  if (token.length > 4 && /^[بكفو]ال/.test(token)) return `${token[0]}${token.slice(3)}`;
  if (token.length > 3 && token.startsWith("ال")) return token.slice(2);
  return token;
}

/** Arabic/Latin-insensitive canonical form used for every comparison. */
export function normalizeText(input: string): string {
  let s = input.normalize("NFKC").toLowerCase();
  s = s.replace(/[٠-٩]/g, (d) => String(EASTERN_DIGITS.indexOf(d)));
  s = s.replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)));
  s = s.replace(/[ً-ٰٟـ]/g, "");
  s = s
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
  s = s.replace(/[^\p{L}\p{N}:\s]/gu, " ");
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map(stripArticle)
    .filter(Boolean)
    .join(" ");
}

const kw = (...words: string[]) => words.map(normalizeText);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const alt = (words: string[]) => words.map(esc).join("|");

// ---------------------------------------------------------------------------
// Vocabulary (dialect + English). Place-name synonyms only widen matching of
// names that exist in the supplied stop data.
// ---------------------------------------------------------------------------

const SYNONYM_GROUPS: string[][] = [
  ["بيت لحم", "bethlehem", "beit lahem", "beit lahm", "bayt lahm", "beitlahem", "bethlehm"],
  ["الخليل", "hebron", "khalil", "al khalil", "alkhalil"],
  ["بوليتكنك", "بولي", "بوليتكنيك", "polytechnic", "ppu", "poly", "بوابه الجامعه", "جامعه البوليتكنك"],
  ["باب الزاويه", "bab al zawiya", "bab zawiya", "bab alzawya", "bab zawya", "bab el zawiya", "باب زاويه"],
  ["رام الله", "ramallah", "ram allah"],
  ["نابلس", "nablus", "nabulus"],
  ["القدس", "jerusalem", "quds", "al quds"],
  ["جنين", "jenin"],
  ["طولكرم", "tulkarm", "tulkarem"],
  ["قلقيليه", "qalqilya", "qalqilia"],
  ["اريحا", "jericho", "ariha"],
  ["غزه", "gaza"],
  ["بيرزيت", "birzeit", "bir zeit"],
  ["الظاهريه", "dhahiriya", "zahiriya"],
  ["يطا", "yatta"],
  ["حلحول", "halhul"],
  ["بيت جالا", "beit jala", "beit jalla"],
  ["بيت ساحور", "beit sahour", "beit sahur"]
].map((group) => group.map(normalizeText));

const NAME_STOPWORDS = new Set(
  kw(
    "center", "centre", "main", "gate", "station", "stop", "street", "road", "square", "circle", "junction",
    "university", "college", "terminal", "checkpoint", "city", "town", "the", "of", "and",
    "وسط", "بوابه", "موقف", "محطه", "مركز", "شارع", "دوار", "تقاطع", "جامعه", "كليه", "مجمع", "حاجز", "مدينه", "رئيسيه"
  )
);

const FROM_MARKERS = new Set(kw("من", "from", "pickup", "leaving", "starting", "انطلاق", "استلام", "اخذني", "خدني", "اركب"));
const TO_MARKERS = new Set(
  kw(
    "الي", "على", "عا", "ع", "to", "towards", "toward", "لحد", "لغايه", "اروح", "روح", "رايح", "رايحه", "وصلني",
    "وصلوني", "وديني", "going", "go", "head", "heading", "destination", "وجهتي", "into", "لوين"
  )
);

const RIDE_KW = new Set(
  kw(
    "بدي", "بدنا", "اريد", "ودي", "محتاج", "محتاجه", "اروح", "روح", "رايح", "رايحه", "وصلني", "وصلوني", "وديني",
    "خدني", "مشوار", "رحله", "رحلات", "سياره", "سرفيس", "تاكسي", "توصيله", "ركوب", "مقعد", "مقاعد", "اركب", "سفر",
    "ride", "trip", "taxi", "cab", "lift", "seat", "seats", "book", "need", "want", "go", "going", "drive", "travel",
    "commute", "pickup", "find", "get", "take", "passenger", "passengers", "ابحث", "دورلي", "لقيلي", "ركاب", "راكب"
  )
);
const PARCEL_STRICT = new Set(
  kw(
    "طرد", "طرود", "شحنه", "ظرف", "مغلف", "غرض", "اغراض", "بضاعه", "كرتونه", "علبه", "باكيت", "بوكس",
    "parcel", "package", "packet", "box", "envelope", "shipment", "courier", "deliver", "delivery", "parcels", "packages"
  )
);
const PARCEL_WEAK = new Set(kw("ارسال", "ابعت", "ابعث", "ارسل", "توصيل", "send", "ship", "sending"));
const STATUS_KW = new Set(
  kw("مؤكده", "مؤكد", "تاكيد", "حاله", "status", "confirmed", "confirmation", "الغاء", "الغي", "cancel", "ملغيه")
);

const NOW_WORDS = kw("هلق", "الان", "هسا", "حالا", "فورا", "دلوقتي", "now", "asap", "immediately");
const TOMORROW_WORDS = kw("بكره", "بكرا", "غدا", "غد", "tomorrow", "tmrw", "tomorow");
const AFTER_TOMORROW = kw("بعد بكره", "بعد بكرا", "بعد غد", "بعد غدا", "day after tomorrow");
const TODAY_WORDS = kw("اليوم", "النهارده", "هاليوم", "today", "tonight", "الليله", "هالليله");

const WEEKDAYS: Array<{ words: string[]; index: number }> = [
  { words: kw("الاحد", "sunday", "sun"), index: 0 },
  { words: kw("الاثنين", "الاتنين", "monday", "mon"), index: 1 },
  { words: kw("الثلاثاء", "التلات", "التلاتاء", "tuesday", "tue"), index: 2 },
  { words: kw("الاربعاء", "الاربعا", "wednesday", "wed"), index: 3 },
  { words: kw("الخميس", "thursday", "thu"), index: 4 },
  { words: kw("الجمعه", "friday", "fri"), index: 5 },
  { words: kw("السبت", "saturday", "sat"), index: 6 }
];

const AM_WORDS = kw("صباحا", "صباح", "صبح", "الصبح", "فجرا", "فجر", "am", "morning");
const NOON_WORDS = kw("ظهرا", "ظهر", "الظهر", "noon");
const PM_WORDS = kw(
  "مساء", "مسا", "المسا", "عصرا", "عصر", "العصر", "مغرب", "المغرب", "عشاء", "ليل", "بالليل", "الليل", "pm",
  "evening", "afternoon", "night"
);

const NUMBER_WORDS: Record<string, number> = Object.fromEntries(
  Object.entries({
    واحد: 1, وحده: 1, one: 1,
    اثنين: 2, اتنين: 2, ثنتين: 2, ثنين: 2, two: 2,
    ثلاثه: 3, تلاته: 3, ثلاث: 3, تلات: 3, three: 3,
    اربعه: 4, اربع: 4, four: 4,
    خمسه: 5, خمس: 5, five: 5,
    سته: 6, ست: 6, six: 6,
    سبعه: 7, سبع: 7, seven: 7,
    ثمانيه: 8, تمانيه: 8, ثمان: 8, تمان: 8, eight: 8,
    تسعه: 9, تسع: 9, nine: 9,
    عشره: 10, عشر: 10, ten: 10,
    احدعش: 11, حداشر: 11, eleven: 11,
    اثناعش: 12, طناشر: 12, twelve: 12
  }).map(([word, value]) => [normalizeText(word), value])
);
const NUM_WORD_ALT = alt(Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length));
const NUM = `(\\d{1,2}|${NUM_WORD_ALT})`;

function numberValue(token: string): number | null {
  if (/^\d+$/.test(token)) return Number(token);
  return NUMBER_WORDS[token] ?? null;
}

const SEAT_NOUNS = alt(
  kw("اشخاص", "شخص", "ركاب", "راكب", "نفر", "انفار", "مقاعد", "مقعد", "كراسي", "كرسي", "اماكن", "مكان", "seats", "seat", "people", "persons", "person", "passengers", "passenger", "pax", "ppl", "adults", "adult")
);

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

type Wall = { y: number; mo: number; d: number; h: number; mi: number };

function wallClock(date: Date, timeZone: string): Wall & { weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23", weekday: "short"
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { y: Number(get("year")), mo: Number(get("month")), d: Number(get("day")), h: Number(get("hour")), mi: Number(get("minute")), weekday };
}

function offsetMinutes(at: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name);
  if (!m || !m[1]) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

function formatOffset(minutes: number) {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** Local wall time (after adding `dayOffset` days) to an instant. */
function wallToInstant(base: Wall, dayOffset: number, h: number, mi: number, timeZone: string): Date {
  const asUtc = Date.UTC(base.y, base.mo - 1, base.d + dayOffset, h, mi, 0);
  const guess = asUtc - offsetMinutes(new Date(asUtc), timeZone) * 60_000;
  return new Date(asUtc - offsetMinutes(new Date(guess), timeZone) * 60_000);
}

function isoLocal(instant: Date, timeZone: string): string {
  const off = offsetMinutes(instant, timeZone);
  const w = wallClock(instant, timeZone);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${w.y}-${p(w.mo)}-${p(w.d)}T${p(w.h)}:${p(w.mi)}:00${formatOffset(off)}`;
}

type TimeResult = { iso: string; guessed: boolean; consumed: Array<[number, number]> };

function hasWord(norm: string, words: string[]) {
  return words.some((w) => new RegExp(`(?:^|\\s)${esc(w)}(?=\\s|$)`).test(norm));
}

function parseTime(norm: string, now: Date, timeZone: string): TimeResult | null {
  const consumed: Array<[number, number]> = [];
  const base = wallClock(now, timeZone);

  // Relative: "بعد ساعة", "in 2 hours", "after half an hour"
  const rel =
    /(?:^|\s)(?:بعد|in|after|within)\s+(?:(\d{1,2})\s+)?(نص|نصف|ربع|half an|half|an|a|one|two|ساعه|ساعتين|ساعات|hour|hours|hr|hrs|دقيقه|دقايق|دقائق|دقيقتين|minutes|minute|mins|min)(?:\s+(ساعه|hour|hours|دقيقه|دقايق|minutes|min))?(?=\s|$)/.exec(norm);
  if (rel) {
    const count = rel[1] ? Number(rel[1]) : null;
    const word = rel[2];
    const unitWord = rel[3] ?? word;
    let minutes: number | null = null;
    const isHour = /^(ساعه|ساعات|ساعتين|hour|hours|hr|hrs)$/.test(unitWord);
    const isMinute = /^(دقيقه|دقايق|دقائق|دقيقتين|minutes|minute|mins|min)$/.test(unitWord);
    if (/^(نص|نصف|half an|half)$/.test(word) && isHour) minutes = 30;
    else if (word === "ربع" && isHour) minutes = 15;
    else if (word === "ساعتين") minutes = 120;
    else if (word === "دقيقتين") minutes = 2;
    else if (isHour) minutes = (count ?? (word === "two" ? 2 : 1)) * 60;
    else if (isMinute) minutes = count ?? 1;
    if (minutes && minutes > 0 && minutes <= 24 * 60) {
      const target = new Date(Math.ceil((now.getTime() + minutes * 60_000) / 60_000) * 60_000);
      return { iso: isoLocal(target, timeZone), guessed: false, consumed: [[rel.index, rel.index + rel[0].length]] };
    }
  }

  // Day
  let dayOffset: number | null = null;
  let weekdayHit = false;
  if (hasWord(norm, AFTER_TOMORROW) || AFTER_TOMORROW.some((p) => norm.includes(p))) dayOffset = 2;
  else if (hasWord(norm, TOMORROW_WORDS)) dayOffset = 1;
  for (const day of WEEKDAYS) {
    if (hasWord(norm, day.words)) {
      weekdayHit = true;
      if (dayOffset === null) dayOffset = (day.index - base.weekday + 7) % 7;
    }
  }
  if (dayOffset === null && !weekdayHit && hasWord(norm, TODAY_WORDS)) dayOffset = 0;
  const explicitDay = dayOffset !== null;

  // Clock
  let hour: number | null = null;
  let minute = 0;
  let periodFromNumber: "am" | "pm" | "noon" | null = null;
  let matchEnd = -1;

  const colon = /(?:^|\s)(\d{1,2}):(\d{2})(?=\s|$|[a-z])/.exec(norm);
  const anchored = new RegExp(`(?:^|\\s)(?:على\\s+)?(?:ساعه|ع|عند|at|around|about|by)\\s+${NUM}(?::(\\d{2}))?(?=\\s|$)`).exec(norm);
  const meridiem = new RegExp(`(?:^|\\s)${NUM}(?::(\\d{2}))?\\s*(am|pm|a m|p m)(?=\\s|$)`).exec(norm);
  const periodAfter = new RegExp(`(?:^|\\s)(\\d{1,2})(?::(\\d{2}))?\\s+(${alt([...AM_WORDS, ...NOON_WORDS, ...PM_WORDS].filter((w) => w !== "am" && w !== "pm"))})(?=\\s|$)`).exec(norm);

  let hit: RegExpExecArray | null = null;
  if (colon) {
    hit = colon;
    hour = Number(colon[1]);
    minute = Number(colon[2]);
  } else if (meridiem) {
    hit = meridiem;
    hour = numberValue(meridiem[1]);
    minute = meridiem[2] ? Number(meridiem[2]) : 0;
    periodFromNumber = meridiem[3].startsWith("a") ? "am" : "pm";
  } else if (anchored) {
    hit = anchored;
    hour = numberValue(anchored[1]);
    minute = anchored[2] ? Number(anchored[2]) : 0;
  } else if (periodAfter) {
    hit = periodAfter;
    hour = Number(periodAfter[1]);
    minute = periodAfter[2] ? Number(periodAfter[2]) : 0;
  }
  if (hit) {
    matchEnd = hit.index + hit[0].length;
    consumed.push([hit.index, matchEnd]);
    if (hour !== null) {
      const tail = norm.slice(matchEnd);
      const frac = /^\s*(الا\s+)?(نص|نصف|ربع|ثلث)(?=\s|$)|^\s*و(نص|نصف|ربع|ثلث)(?=\s|$)/.exec(tail);
      if (frac) {
        const kind = frac[2] ?? frac[3];
        const amount = kind === "ربع" ? 15 : kind === "ثلث" ? 20 : 30;
        if (frac[1]) {
          hour -= 1;
          minute = 60 - amount;
        } else minute = amount;
        consumed.push([matchEnd, matchEnd + frac[0].length]);
        matchEnd += frac[0].length;
      }
    }
  }

  // Immediate
  const nowWords = NOW_WORDS.some((w) => hasWord(norm, [w])) ||
    /(?:^|\s)\S+\s+هلا(?=\s|$)/.test(norm);
  if (hour === null && nowWords && !explicitDay) {
    const target = new Date(Math.ceil((now.getTime() + 10 * 60_000) / 60_000) * 60_000);
    return { iso: isoLocal(target, timeZone), guessed: false, consumed };
  }

  if (hour === null || hour < 0 || hour > 24 || minute < 0 || minute > 59) {
    return null;
  }

  // Period resolution
  let period: "am" | "pm" | "noon" | null = periodFromNumber;
  if (!period) {
    const near = norm.slice(Math.max(0, hit ? hit.index - 20 : 0), (matchEnd > 0 ? matchEnd : norm.length) + 20);
    if (hasWord(near, NOON_WORDS)) period = "noon";
    else if (hasWord(near, PM_WORDS)) period = "pm";
    else if (hasWord(near, AM_WORDS)) period = "am";
    else if (hasWord(norm, NOON_WORDS)) period = "noon";
    else if (hasWord(norm, PM_WORDS)) period = "pm";
    else if (hasWord(norm, AM_WORDS)) period = "am";
  }

  let h24 = hour;
  let guessed = false;
  if (hour > 12 || hour === 0 || colon && hour >= 13) {
    h24 = hour === 24 ? 0 : hour;
  } else if (period === "am") {
    h24 = hour === 12 ? 0 : hour;
  } else if (period === "noon") {
    h24 = hour >= 1 && hour <= 6 ? hour + 12 : hour;
  } else if (period === "pm") {
    h24 = hour < 12 ? hour + 12 : 12;
  } else {
    guessed = true;
    // 1-6 -> afternoon, 7-11 -> morning, 12 -> noon
    h24 = hour >= 1 && hour <= 6 ? hour + 12 : hour;
  }

  let target = wallToInstant(base, dayOffset ?? 0, h24, minute, timeZone);
  if (target.getTime() <= now.getTime()) {
    if (!explicitDay) {
      // Prefer the other 12h reading if it is still in the future today.
      const other = guessed && h24 < 12 ? h24 + 12 : guessed && h24 >= 12 && h24 - 12 >= 1 ? h24 - 12 : null;
      const alternative = other === null ? null : wallToInstant(base, 0, other, minute, timeZone);
      target = alternative && alternative.getTime() > now.getTime()
        ? alternative
        : wallToInstant(base, 1, h24, minute, timeZone);
    } else if (weekdayHit) {
      target = wallToInstant(base, (dayOffset ?? 0) + 7, h24, minute, timeZone);
    }
  }
  return { iso: isoLocal(target, timeZone), guessed, consumed };
}

// ---------------------------------------------------------------------------
// Place matching
// ---------------------------------------------------------------------------

type Variant = { text: string; strength: number; fuzzy: boolean };
type PlaceIndex = { place: AssistantPlace; variants: Variant[] };
type Mention = { key: string; start: number; end: number; strength: number; prefix: string };

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

function containsSequence(haystack: string, needle: string, allowPrefix = false) {
  return new RegExp(`(?:^|\\s)${allowPrefix ? "[لبو]?" : ""}${esc(needle)}(?=\\s|$)`).test(haystack);
}

function buildIndex(places: AssistantPlace[]): PlaceIndex[] {
  const tokenOwners = new Map<string, Set<string>>();
  const prepared = places.map((place) => {
    const names = [normalizeText(place.name_ar), normalizeText(place.name_en), ...(place.aliases ?? []).map(normalizeText)]
      .filter(Boolean);
    const tokens = new Set<string>();
    for (const name of names) {
      for (const token of name.split(" ")) {
        if (token.length >= 3 && !NAME_STOPWORDS.has(token) && !/^\d+$/.test(token)) tokens.add(token);
      }
    }
    for (const token of tokens) {
      if (!tokenOwners.has(token)) tokenOwners.set(token, new Set());
      tokenOwners.get(token)!.add(place.key);
    }
    return { place, names, tokens };
  });

  return prepared.map(({ place, names, tokens }) => {
    const variants = new Map<string, Variant>();
    const add = (text: string, strength: number, fuzzy = false) => {
      if (!text) return;
      const existing = variants.get(text);
      if (!existing || existing.strength < strength) variants.set(text, { text, strength, fuzzy });
    };
    for (const name of names) add(name, 1);
    for (const token of tokens) {
      if (tokenOwners.get(token)!.size === 1) add(token, 0.9, token.length >= 5);
    }
    // Spelling synonyms: a group applies when one member appears in this place's names.
    for (const group of SYNONYM_GROUPS) {
      if (group.some((member) => names.some((name) => containsSequence(name, member) || tokens.has(member)))) {
        for (const member of group) add(member, 0.95);
      }
    }
    return { place, variants: [...variants.values()] };
  });
}

function findMentions(norm: string, index: PlaceIndex[]): Mention[] {
  const raw: Mention[] = [];
  const tokens = norm.split(" ");
  const offsets: number[] = [];
  let cursor = 0;
  for (const token of tokens) {
    offsets.push(cursor);
    cursor += token.length + 1;
  }

  for (const { place, variants } of index) {
    for (const variant of variants) {
      const re = new RegExp(`(?:^|\\s)([لبو]?)${esc(variant.text)}(?=\\s|$)`, "g");
      for (let m = re.exec(norm); m; m = re.exec(norm)) {
        const leading = m[0].startsWith(" ") ? 1 : 0;
        const start = m.index + leading;
        raw.push({ key: place.key, start, end: m.index + m[0].length, strength: variant.strength, prefix: m[1] });
      }
      if (variant.fuzzy && !variant.text.includes(" ")) {
        tokens.forEach((token, i) => {
          const prefix = /^[لبو]/.test(token) && token.length - 1 >= 5 ? token[0] : "";
          const body = prefix ? token.slice(1) : token;
          if (body !== variant.text && editDistanceAtMostOne(body, variant.text)) {
            raw.push({ key: place.key, start: offsets[i], end: offsets[i] + token.length, strength: 0.8, prefix });
          }
        });
      }
    }
  }

  // Resolve overlaps: longer span first, then stronger.
  raw.sort((a, b) => (b.end - b.start) - (a.end - a.start) || b.strength - a.strength || a.start - b.start);
  const accepted: Mention[] = [];
  for (const mention of raw) {
    const clash = accepted.find((o) => mention.start < o.end && o.start < mention.end);
    if (clash) {
      // Same span claimed by two different places with equal strength is ambiguous: drop both.
      if (clash.start === mention.start && clash.end === mention.end && clash.key !== mention.key && clash.strength === mention.strength) {
        accepted.splice(accepted.indexOf(clash), 1);
        raw.forEach((r) => { if (r.start === mention.start && r.end === mention.end) r.strength = -1; });
      }
      continue;
    }
    if (mention.strength > 0) accepted.push(mention);
  }
  return accepted.sort((a, b) => a.start - b.start);
}

type Basis = "marked" | "slot" | "order" | "lone";
type Role = "from" | "to" | null;

function markerBefore(norm: string, mention: Mention, previousEnd: number): Role {
  if (mention.prefix === "ل") return "to";
  const before = norm.slice(Math.max(previousEnd, 0), mention.start).trim();
  if (!before) return null;
  const tokens = before.split(" ").slice(-3).reverse();
  for (const token of tokens) {
    if (FROM_MARKERS.has(token)) return "from";
    if (TO_MARKERS.has(token)) return "to";
    // Attached prefix forms: "لبيت" handled above; "منبيت" is not valid Arabic.
  }
  return null;
}

// ---------------------------------------------------------------------------
// Single-turn extraction
// ---------------------------------------------------------------------------

type Slot = { key: string; basis: Basis };
type Extracted = {
  rideEvidence: boolean;
  parcelEvidence: "strict" | "weak" | null;
  statusQuery: boolean;
  from: Slot | null;
  to: Slot | null;
  unmarked: string[];
  time: TimeResult | null;
  seats: number | null;
  seatsExplicit: boolean;
  size: ParcelSize | null;
  unsupportedPlace: boolean;
};

function tokenSet(norm: string) {
  return new Set(norm.split(" "));
}

function extract(text: string, index: PlaceIndex[], ctx: ParseContext): Extracted {
  const timeZone = ctx.timeZone ?? DEFAULT_TIME_ZONE;
  const norm = normalizeText(text);
  const tokens = tokenSet(norm);
  const has = (set: Set<string>) => [...tokens].some((t) => set.has(t));
  const twoWord = /(?:^|\s)(take me|pick me|get me|need a|want a|looking for)(?=\s|$)/.test(norm);

  const mentions = findMentions(norm, index);
  let from: Slot | null = null;
  let to: Slot | null = null;
  const unmarked: string[] = [];
  let prevEnd = 0;
  for (const mention of mentions) {
    const role = markerBefore(norm, mention, prevEnd);
    prevEnd = mention.end;
    if (role === "from") from = { key: mention.key, basis: "marked" };
    else if (role === "to") to = { key: mention.key, basis: "marked" };
    else unmarked.push(mention.key);
  }

  // Unsupported place: a known place name appears but no stop serves it.
  const mentionedSynonymGroups = SYNONYM_GROUPS.filter((group) => group.some((member) => containsSequence(norm, member, true)));
  const resolvedText = mentions.map((m) => norm.slice(m.start, m.end)).join(" ");
  const unsupportedPlace = mentionedSynonymGroups.some(
    (group) => !group.some((member) => containsSequence(resolvedText, member, true)) &&
      !index.some((entry) => entry.variants.some((v) => group.includes(v.text)))
  );

  const time = parseTime(norm, ctx.now, timeZone);

  // Seats: strip the time spans first so "الساعة 3" is not read as three seats.
  let seatText = norm;
  if (time) {
    for (const [s, e] of [...time.consumed].sort((a, b) => b[0] - a[0])) {
      seatText = `${seatText.slice(0, s)} ${seatText.slice(e)}`;
    }
  }
  for (const day of WEEKDAYS) for (const word of day.words) seatText = seatText.replace(new RegExp(`(?:^|\\s)${esc(word)}(?=\\s|$)`, "g"), " ");
  let seats: number | null = null;
  let seatsExplicit = false;
  const seatPatterns: Array<[RegExp, (m: RegExpExecArray) => number | null]> = [
    [new RegExp(`(?:^|\\s)${NUM}\\s*(?:${SEAT_NOUNS})(?=\\s|$)`), (m) => numberValue(m[1])],
    [/(?:^|\s)(?:ل)?(شخصين|نفرين|راكبين|شخصان)(?=\s|$)/, () => 2],
    [new RegExp(`(?:^|\\s)(?:for|ل|x)\\s*${NUM}(?=\\s|$)`), (m) => numberValue(m[1])],
    [/(?:^|\s)(?:ل?وحدي|alone|just me|myself|by myself|only me)(?=\s|$)/, () => 1],
    [/(?:^|\s)(?:انا وصاحبي|انا وصديقي|انا وزوجتي|انا وزوجي|انا وخيي|انا واخوي|me and a friend|me and my friend|me and my wife|me and my husband)(?=\s|$)/, () => 2]
  ];
  for (const [re, pick] of seatPatterns) {
    const m = re.exec(seatText);
    const value = m ? pick(m) : null;
    if (value !== null && value >= 1 && value <= 20) {
      seats = value;
      seatsExplicit = true;
      break;
    }
  }

  let size: ParcelSize | null = null;
  if (hasWord(norm, kw("صغير", "صغيره", "small", "envelope", "ظرف", "مغلف", "documents", "اوراق", "mini"))) size = "small";
  else if (hasWord(norm, kw("متوسط", "متوسطه", "medium", "عادي", "عاديه", "normal"))) size = "medium";
  else if (hasWord(norm, kw("كبير", "كبيره", "ضخم", "ضخمه", "large", "big", "heavy", "ثقيل", "ثقيله", "huge"))) size = "large";

  return {
    rideEvidence: has(RIDE_KW) || twoWord,
    parcelEvidence: has(PARCEL_STRICT) ? "strict" : has(PARCEL_WEAK) ? "weak" : null,
    statusQuery: has(STATUS_KW) ||
      /(?:^|\s)(?:when is my|where is my|is my (?:trip|ride)|do i have|did my|متي رحلت|وين رحلت|متي موعد|هل رحلت|حجزي|رحلتي)(?=\s|$)/.test(norm),
    from,
    to,
    unmarked,
    time,
    seats,
    seatsExplicit,
    size,
    unsupportedPlace
  };
}

// ---------------------------------------------------------------------------
// Merge, route awareness, scoring
// ---------------------------------------------------------------------------

function routeServes(routes: AssistantRoute[], pickup: string, dropoff: string): boolean {
  return routes.some((route) => {
    const from = route.stops.find((s) => s.stop_key === pickup && s.passenger_pickup);
    const to = route.stops.find((s) => s.stop_key === dropoff && s.passenger_dropoff);
    return Boolean(from && to && from.sequence < to.sequence);
  });
}

/** Stops that can legally be paired with `known` on at least one route. */
export function reachablePlaces(
  context: Pick<ParseContext, "places" | "routes">,
  known: string,
  as: "pickup" | "dropoff"
): AssistantPlace[] {
  const routes = context.routes ?? [];
  const keys = new Set<string>();
  for (const route of routes) {
    const self = route.stops.find((s) => s.stop_key === known);
    if (!self) continue;
    for (const stop of route.stops) {
      if (as === "dropoff" && self.passenger_pickup && stop.passenger_dropoff && stop.sequence > self.sequence) keys.add(stop.stop_key);
      if (as === "pickup" && self.passenger_dropoff && stop.passenger_pickup && stop.sequence < self.sequence) keys.add(stop.stop_key);
    }
  }
  return context.places.filter((p) => keys.has(p.key));
}

function toParsedPlace(place: AssistantPlace | undefined): ParsedPlace | null {
  if (!place) return null;
  return { key: place.key, label_ar: place.name_ar, label_en: place.name_en, lat: place.lat, lng: place.lng };
}

const PLACE_WEIGHT: Record<Basis, number> = { marked: 0.3, slot: 0.3, order: 0.22, lone: 0.15 };

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function parseRequest(text: string, context: ParseContext): ParsedIntent {
  const index = buildIndex(context.places);
  const turns = [...(context.priorTurns ?? []).slice(-3), text];
  const parts = turns.map((turn) => extract(turn, index, context));
  const last = parts[parts.length - 1];

  // Later turns override earlier ones, field by field.
  let from: Slot | null = null;
  let to: Slot | null = null;
  let time: TimeResult | null = null;
  let seats: number | null = null;
  let seatsExplicit = false;
  let size: ParcelSize | null = null;
  for (const part of parts) {
    if (part.from) from = part.from;
    if (part.to) to = part.to;
    // Resolve this turn's unmarked mentions against slots filled so far.
    const free = [...part.unmarked];
    if (free.length >= 2 && !part.from && !part.to) {
      from = { key: free[0], basis: "order" };
      to = { key: free[1], basis: "order" };
    } else if (free.length >= 1) {
      const key = free[free.length - 1];
      if (!part.from && !part.to) {
        if (from && !to) to = { key, basis: "slot" };
        else if (to && !from) from = { key, basis: "slot" };
        else if (!from && !to) to = { key, basis: "lone" };
        else if (from && to) to = { key, basis: "slot" };
      } else if (part.from && !part.to && !to) to = { key, basis: "slot" };
      else if (part.to && !part.from && !from) from = { key, basis: "slot" };
    }
    if (part.time) time = part.time;
    if (part.seats !== null) { seats = part.seats; seatsExplicit = part.seatsExplicit; }
    if (part.size) size = part.size;
  }

  const anyRide = parts.some((p) => p.rideEvidence);
  const parcelStrict = parts.some((p) => p.parcelEvidence === "strict");
  const parcelWeak = parts.some((p) => p.parcelEvidence === "weak");
  const lastIsStatus = last.statusQuery && !last.from && !last.to && last.unmarked.length === 0;

  let type: IntentType = "unknown";
  if (!lastIsStatus) {
    if (parcelStrict && !seatsExplicit) type = "parcel";
    else if (parcelWeak && !anyRide) type = "parcel";
    else if (anyRide || from || to || time) type = "ride";
  }

  const place = (slot: Slot | null) => toParsedPlace(context.places.find((p) => p.key === slot?.key));
  let pickup = place(from);
  let dropoff = place(to);
  const unsupported = parts.some((p) => p.unsupportedPlace) && (!pickup || !dropoff);
  if (pickup && dropoff && pickup.key === dropoff.key) dropoff = null;

  const missing: MissingField[] = [];
  const routes = context.routes ?? [];
  let routeBroken = false;
  if (pickup && dropoff && routes.length > 0 && !routeServes(routes, pickup.key, dropoff.key)) {
    routeBroken = true;
    missing.push("route");
  }

  if (type === "unknown") {
    return {
      type, pickup: null, dropoff: null, time: null, seats: null, size: null,
      confidence: lastIsStatus ? 0.2 : 0, missing: [], unsupported_place: unsupported, source: "rules"
    };
  }

  let confidence = 0;
  if (type === "ride") {
    confidence += anyRide || (from && to) ? 0.25 : 0.1;
    if (pickup && from) confidence += PLACE_WEIGHT[from.basis];
    if (dropoff && to) confidence += PLACE_WEIGHT[to.basis];
    if (time) confidence += time.guessed ? 0.1 : 0.15;
    if (!pickup) missing.push("pickup");
    if (!dropoff) missing.push("dropoff");
    if (!time) missing.push("time");
    if (seats !== null && seats > MAX_RIDE_SEATS) {
      missing.push("seats");
      confidence -= 0.1;
    }
  } else {
    confidence += parcelStrict ? 0.3 : 0.2;
    if (pickup && from) confidence += from.basis === "lone" ? 0.12 : 0.25;
    if (dropoff && to) confidence += to.basis === "lone" ? 0.12 : 0.25;
    if (time) confidence += 0.1;
    if (size) confidence += 0.1;
    if (!pickup) missing.push("pickup");
    if (!dropoff) missing.push("dropoff");
  }
  if (routeBroken) confidence -= ROUTE_MISMATCH_PENALTY;
  if (unsupported) confidence -= 0.2;

  return {
    type,
    pickup,
    dropoff,
    time: time?.iso ?? null,
    seats: type === "ride" ? (seats ?? 1) : null,
    size: type === "parcel" ? size : null,
    confidence: round2(Math.min(1, Math.max(0, confidence))),
    missing,
    unsupported_place: unsupported,
    source: "rules"
  };
}

// ---------------------------------------------------------------------------
// Clarifying questions (EN + AR)
// ---------------------------------------------------------------------------

export type Clarification = { message: string; suggestions: string[]; reason: string };

function placeName(place: AssistantPlace | ParsedPlace, locale: AssistantLocale) {
  if ("name_ar" in place) return locale === "ar" ? place.name_ar : place.name_en;
  return locale === "ar" ? place.label_ar : place.label_en;
}

export function buildClarification(
  intent: ParsedIntent,
  context: Pick<ParseContext, "places" | "routes">,
  locale: AssistantLocale
): Clarification {
  const ar = locale === "ar";
  const names = (list: AssistantPlace[]) => list.slice(0, 4).map((p) => placeName(p, locale));
  const all = names(context.places);

  if (context.places.length === 0) {
    return {
      reason: "no_places",
      message: ar ? "لا توجد مسارات متاحة حالياً. حاول لاحقاً." : "No routes are available right now. Please try again later.",
      suggestions: []
    };
  }
  if (intent.unsupported_place && (!intent.pickup || !intent.dropoff)) {
    return {
      reason: "unsupported_place",
      message: ar
        ? `هذا المكان غير مدعوم حالياً. الأماكن المتاحة: ${all.join("، ")}.`
        : `That place isn't supported yet. Available places: ${all.join(", ")}.`,
      suggestions: all
    };
  }
  if (intent.missing.includes("route") && intent.pickup && intent.dropoff) {
    const options = names(reachablePlaces(context, intent.pickup.key, "dropoff"));
    return {
      reason: "route_mismatch",
      message: ar
        ? `لا يوجد مسار من ${placeName(intent.pickup, locale)} إلى ${placeName(intent.dropoff, locale)}. أين تريد الذهاب؟`
        : `There is no route from ${placeName(intent.pickup, locale)} to ${placeName(intent.dropoff, locale)}. Where would you like to go?`,
      suggestions: options.length ? options : all
    };
  }
  if (intent.type === "unknown") {
    return {
      reason: "not_understood",
      message: ar
        ? "لم أفهم طلبك تماماً. أخبرني من أين وإلى أين وفي أي وقت، مثلاً: «من الخليل إلى بيت لحم بكرا الساعة 8 صباحاً»."
        : "I didn't quite get that. Tell me where from, where to and when, for example: \"From Hebron to Bethlehem tomorrow at 8 am\".",
      suggestions: []
    };
  }
  if (intent.missing.includes("seats")) {
    return {
      reason: "seats_over_limit",
      message: ar ? `يمكن حجز حتى ${MAX_RIDE_SEATS} ركاب في الطلب الواحد. كم عدد الركاب؟` : `You can book up to ${MAX_RIDE_SEATS} passengers per request. How many passengers?`,
      suggestions: ["1", "2", "3", "4"]
    };
  }
  if (!intent.pickup) {
    const options = intent.dropoff ? names(reachablePlaces(context, intent.dropoff.key, "pickup")) : [];
    return {
      reason: "missing_pickup",
      message: ar ? "من أين تريد أن نقلّك؟" : "Where should we pick you up?",
      suggestions: options.length ? options : all
    };
  }
  if (!intent.dropoff) {
    const options = names(reachablePlaces(context, intent.pickup.key, "dropoff"));
    return {
      reason: "missing_dropoff",
      message: ar ? "إلى أين تريد الذهاب؟" : "Where would you like to go?",
      suggestions: options.length ? options : all
    };
  }
  if (intent.missing.includes("time")) {
    return {
      reason: "missing_time",
      message: ar ? "متى تريد الانطلاق؟" : "When would you like to leave?",
      suggestions: ar ? ["بعد ساعة", "بكرا الساعة 8 صباحاً"] : ["In an hour", "Tomorrow at 8 am"]
    };
  }
  // Everything was read but the reading is shaky: ask the passenger to confirm.
  const from = placeName(intent.pickup, locale);
  const to = placeName(intent.dropoff, locale);
  return {
    reason: "low_confidence",
    message: ar
      ? `هل تقصد من ${from} إلى ${to}؟ أكّد أو أعد كتابة الطلب.`
      : `Do you mean from ${from} to ${to}? Please confirm or rephrase your request.`,
    suggestions: [ar ? `من ${from} إلى ${to}` : `From ${from} to ${to}`]
  };
}
