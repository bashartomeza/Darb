import type { NormalizedParse, ParseContext } from "./types.js";

/**
 * Deliberately small keyword parser. It exists so the harness can be demonstrated
 * end to end before the real parser lands; it is NOT a candidate implementation.
 */

const STOP = { ppu: "demo-ppu-main-gate", bab: "demo-bab-al-zawiya", beth: "demo-bethlehem-center" };

export function normalizeText(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[ً-ٟـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase();
}

const PLACES: Array<{ re: RegExp; value: string }> = [
  { re: /باب ال?زاوي|bab e?l?[ -]?zaw/, value: STOP.bab },
  { re: /بوليتكن|بولتكن|polytechnic|\bppu\b|bolitekh|الجامعه|جامعه|jam3a|university/, value: STOP.ppu },
  { re: /بيت ?لحم|bethle|beit lah/, value: STOP.beth },
  { re: /الخليل|hebron|khalil/, value: "ambiguous" },
  { re: /نابلس|رام الله|القدس|جنين|غزه|nablus|ramallah|jerusalem|jenin|gaza/, value: "unsupported" }
];

const FROM = /(?:^|\s)(?:من|min|men|from)\s*$/;
const TO = /(?:^|\s)(?:الي|الى|على|ع|to|la|3a|3ala|ل|لـ)\s*$/;

function findPlaces(t: string): Array<{ index: number; value: string; role: "from" | "to" | "none" }> {
  const found: Array<{ index: number; value: string; role: "from" | "to" | "none" }> = [];
  for (const place of PLACES) {
    const m = place.re.exec(t);
    if (!m) continue;
    const before = t.slice(0, m.index);
    let role: "from" | "to" | "none" = "none";
    if (FROM.test(before)) role = "from";
    else if (TO.test(before) || /(?:^|\s)[لعب]$/.test(before)) role = "to";
    found.push({ index: m.index, value: place.value, role });
  }
  return found.sort((a, b) => a.index - b.index);
}

function parseTime(t: string): string | null {
  const day = /بكره|بكرا|tomorrow|bukra|bokra/.test(t) ? "tomorrow " : "";
  const bare = (v: string | null) => (v === null ? (day ? day.trim() : null) : day + v);
  if (/هلا|هسا|هلق|\bnow\b|asap|halla|بعد شوي/.test(t)) return "now";
  const pad = (n: number) => String(n).padStart(2, "0");
  const clock = /(\d{1,2}):(\d{2})\s*(am|pm)?/.exec(t);
  if (clock) return day + `${pad(Number(clock[1]) + (clock[3] === "pm" && Number(clock[1]) < 12 ? 12 : 0))}:${clock[2]}`;
  const eng = /\b(\d{1,2})\s*(am|pm)\b/.exec(t);
  if (eng) return day + `${pad((Number(eng[1]) % 12) + (eng[2] === "pm" ? 12 : 0))}:00`;
  const at = /(?:الساعه|sa3a|at)\s*(\d{1,2})/.exec(t) ?? /\bbukra el (\d{1,2})\b/.exec(t);
  if (at) {
    let h = Number(at[1]);
    const half = /ونص|و نص/.test(t) ? ":30" : ":00";
    const pm = /عصر|مسا|ليل|بعد الظهر|3asr/.test(t);
    const am = /صبح|فجر|sobeh|صباح/.test(t);
    if (pm && h < 12) h += 12;
    else if (!am && !pm && h >= 1 && h <= 6) h += 12;
    return day + `${pad(h)}${half}`;
  }
  if (/الليله/.test(t)) return day + "tonight";
  if (/عصر|بعد الظهر|3asr/.test(t)) return bare("afternoon");
  if (/مسا|evening/.test(t)) return bare("evening");
  if (/صبح|morning|sobeh/.test(t)) return bare("morning");
  if (/ظهر|noon/.test(t)) return bare("noon");
  return bare(null);
}

const WORD_NUMS: Record<string, number> = { اثنين: 2, اتنين: 2, ثلاث: 3, تلاته: 3, اربع: 4, خمس: 5, ستا: 6 };

export function baselineParse(text: string, _context?: ParseContext): NormalizedParse {
  const t = normalizeText(text);
  const parcel = /طرد|كرتون|ظرف|شنطه|كيس|علبه|اغراض|parcel|package|\bbox\b|tard/.test(t);
  const ride = /مشوار|مقعد|مقاعد|سياره|اروح|بدي|بدنا|ride|seat|taxi|mishwar|maq|baddi|arooh|توصيل|واصل|نفر|رجعني|ارجع/.test(t);
  const places = findPlaces(t);
  if (/ال?غي|cancel|مش بدي|ما بدي|لا شكرا/.test(t) && places.length === 0) return empty();
  if (!parcel && (!ride || places.length === 0 && !/مشوار|ride|mishwar|مقعد|seat/.test(t))) return empty();

  let pickup: string | null = null;
  let dropoff: string | null = null;
  for (const p of places) {
    if (p.role === "from" && pickup === null) pickup = p.value;
    else if (p.role === "to" && dropoff === null) dropoff = p.value;
  }
  for (const p of places) {
    if (p.role !== "none") continue;
    if (dropoff === null && pickup !== null) dropoff = p.value;
    else if (dropoff === null && p.value === STOP.beth) dropoff = p.value;
    else if (pickup === null) pickup = p.value;
  }

  let seats: number | null = null;
  let size: NormalizedParse["size"] = null;
  if (parcel) {
    if (/صغير|small|sgheer/.test(t)) size = "small";
    else if (/كبير|large|\bbig\b|kbeer/.test(t)) size = "large";
    else if (/متوسط|وسط حجم|medium/.test(t)) size = "medium";
  } else {
    seats = 1;
    const digit = /(\d+)\s*(?:مقاعد|مقعد|اشخاص|seats?|people|maq)/.exec(t);
    if (/مقعدين|maqa3deen|maq3adeen/.test(t)) seats = 2;
    else if (digit) seats = Number(digit[1]);
    else for (const [w, n] of Object.entries(WORD_NUMS)) if (t.includes(w)) seats = n;
  }
  return { type: parcel ? "parcel" : "ride", pickup, dropoff, time: parseTime(t), seats, size };
}

function empty(): NormalizedParse {
  return { type: "unknown", pickup: null, dropoff: null, time: null, seats: null, size: null };
}
