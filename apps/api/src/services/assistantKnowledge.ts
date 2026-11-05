/**
 * Small-talk and app-help answers for the passenger assistant.
 *
 * Pure and deterministic: no network, no database. Every answer states only what the product really
 * does today (see docs/api/passenger-assistant.md "Product facts" and docs/api/route-fares.md); if a capability does not exist yet
 * (in-app payment, fares, a support inbox) the answer says so instead of inventing it. Answers are
 * static strings, so they are effectively cached and cost no provider call.
 */
import { normalizeText, type AssistantLocale } from "./assistantParser.js";

export type KnowledgeTopic =
  | "greeting"
  | "how_are_you"
  | "thanks"
  | "goodbye"
  | "capabilities"
  | "cancel"
  | "payment"
  | "checkpoints"
  | "support"
  | "how_to_book"
  | "parcel_help"
  | "booking_status";

export type KnowledgeAnswer = { topic: KnowledgeTopic; message: string; suggestions: string[] };

type Rule = {
  topic: KnowledgeTopic;
  /** Phrases are matched on whole-word boundaries after normalisation. */
  phrases: string[];
  /** Topics a passenger asks while still mentioning a trip ("how do I cancel my trip to Hebron"). */
  helpQuestion?: boolean;
};

const n = (...values: string[]) => values.map(normalizeText);

// Order matters: the first rule with a hit wins, most specific first.
const RULES: Rule[] = [
  {
    topic: "cancel",
    helpQuestion: true,
    phrases: n(
      "الغاء", "الغي", "الغيه", "الغيلي", "الغاء الحجز", "كنسل", "كانسل", "كنسلي", "بطلت", "بطل الرحله", "بدي الغي",
      "لغي", "كيف لغي", "cancel", "cancel my", "cancellation", "call off", "undo my request"
    )
  },
  {
    topic: "payment",
    helpQuestion: true,
    phrases: n(
      "الدفع", "ادفع", "دفع", "ادفعلو", "اجره", "الاجره", "اجرة", "سعر", "السعر", "الاسعار", "تسعيره", "تكلف", "بكم", "كم الاجره",
      "كم بتكلف", "كم الحساب", "فلوس", "كاش", "نقدا", "بطاقه", "فيزا", "تعرفه",
      "pay", "payment", "paying", "price", "prices", "fare", "fares", "cost", "how much", "cash", "card", "charge"
    )
  },
  {
    topic: "checkpoints",
    helpQuestion: true,
    phrases: n(
      "حاجز", "حواجز", "الحواجز", "الحاجز", "ازمه", "ازمة", "سكره", "مسكر", "مسكره", "الطريق مسكر", "طريق مسكر",
      "checkpoint", "checkpoints", "barrier", "barriers", "road closed", "traffic jam", "closure"
    )
  },
  {
    topic: "support",
    helpQuestion: true,
    phrases: n(
      "دعم", "الدعم", "مساعده", "ساعدوني", "تواصل", "اتواصل", "كلم", "اكلم", "رقم", "ايميل", "شكوى", "شكوي", "مشكله", "عندي مشكله",
      "خدمه العملاء", "مسؤول", "ادمن",
      "support", "help desk", "contact", "contact you", "complaint", "complain", "customer service", "talk to a person", "human", "agent", "admin"
    )
  },
  {
    topic: "parcel_help",
    phrases: n(
      "كيف ابعت طرد", "كيف ارسل طرد", "كيف اوصل طرد", "how do i send a parcel", "how to send a parcel", "send a parcel", "how do i send a package"
    )
  },
  {
    topic: "booking_status",
    phrases: n(
      "وين رحلتي", "وين سائقي", "وين السواق", "وين السايق", "متى بوصل", "شو صار بطلبي", "حاله طلبي", "حاله الحجز", "رحلتي", "حجزي",
      "where is my driver", "where is my ride", "where is my trip", "status of my", "my booking", "my request status", "my trip"
    )
  },
  {
    topic: "how_to_book",
    phrases: n(
      "كيف احجز", "كيف بحجز", "كيف اطلب", "كيف بطلب", "كيف بدي احجز", "كيف استخدم", "كيف بستخدم", "طريقه الحجز", "شو بتعمل", "كيف اطلب مشوار",
      "how do i book", "how to book", "how do i order", "how does it work", "how do i use", "how to use", "how to request"
    )
  },
  {
    topic: "capabilities",
    phrases: n(
      "شو بتعرف", "شو بتقدر", "شو بتعمل", "شو فيك", "شو بتساعد", "ايش بتقدر", "من انت", "مين انت", "انت مين", "شو انت", "تعرفني", "عرفني",
      "what can you do", "what do you do", "who are you", "what are you", "what can i ask", "help me"
    )
  },
  { topic: "how_are_you", phrases: n("كيفك", "كيف حالك", "شو اخبارك", "شلونك", "كيف الحال", "اخبارك", "شو الاخبار", "how are you", "how r u", "hows it going", "what s up", "whats up") },
  { topic: "thanks", phrases: n("شكرا", "يسلمو", "يسلمو ايديك", "يعطيك العافيه", "مشكور", "تسلم", "ممنون", "thanks", "thank you", "thx", "appreciate") },
  { topic: "goodbye", phrases: n("مع السلامه", "باي", "بشوفك", "الله يسلمك", "bye", "goodbye", "see you", "good night", "تصبح على خير") },
  { topic: "greeting", phrases: n("مرحبا", "مرحبتين", "اهلا", "اهلين", "هلا", "هلو", "سلام", "السلام عليكم", "صباح الخير", "مساء الخير", "هاي", "hi", "hello", "hey", "good morning", "good evening", "good afternoon", "salam") }
];

function hasPhrase(norm: string, phrase: string) {
  if (!phrase) return false;
  return new RegExp(`(?:^|\\s)[وفب]?${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`).test(norm);
}

/** Generic words the passenger may add around a greeting/thanks without changing its meaning. */
const FILLER = new Set(n("يا", "حبيبي", "كتير", "جدا", "الله", "يخليك", "لو", "سمحت", "please", "so", "much", "very", "a", "lot", "the", "again", "بس", "هلا", "وسهلا", "اهلا", "ورحبا", "my", "dear", "friend", "assistant", "darb", "درب"));

/** Which topic, if any, a message is about. */
export function detectKnowledgeTopic(text: string): { topic: KnowledgeTopic; helpQuestion: boolean } | null {
  const norm = normalizeText(text);
  if (!norm) return null;
  for (const rule of RULES) {
    if (rule.phrases.some((phrase) => hasPhrase(norm, phrase))) {
      // Social phrases only count when the message is short: "hi, I need a ride" is a ride request.
      const social = rule.topic === "greeting" || rule.topic === "thanks" || rule.topic === "goodbye" || rule.topic === "how_are_you";
      if (social && norm.split(" ").length > 7) continue;
      return { topic: rule.topic, helpQuestion: Boolean(rule.helpQuestion) };
    }
  }
  return null;
}

/** True when the text is only a greeting plus filler (so a booking turn with a greeting still books). */
export function isOnlySocial(text: string): boolean {
  const norm = normalizeText(text);
  const rest = norm.split(" ").filter((t) => t && !FILLER.has(t));
  return rest.length <= 4;
}

type Example = { from: string; to: string } | null;

function sampleRide(example: Example, ar: boolean, when: boolean) {
  if (!example) return ar ? "من الخليل إلى بيت لحم بكرا الساعة 8 صباحاً" : "From Hebron to Bethlehem tomorrow at 8 am";
  const tail = when ? (ar ? " بكرا الساعة 8 صباحاً" : " tomorrow at 8 am") : "";
  return ar ? `من ${example.from} إلى ${example.to}${tail}` : `From ${example.from} to ${example.to}${tail}`;
}

export function answerKnowledge(
  topic: KnowledgeTopic,
  locale: AssistantLocale,
  example: Example = null
): KnowledgeAnswer {
  const ar = locale === "ar";
  const ride = sampleRide(example, ar, true);
  const bookChip = sampleRide(example, ar, false);
  const helpChips = ar
    ? ["كيف ألغي طلبي؟", "هل في حواجز؟", "كيف أتواصل مع الدعم؟"]
    : ["How do I cancel?", "Are there checkpoints?", "How do I contact support?"];

  switch (topic) {
    case "greeting":
      return {
        topic,
        message: ar
          ? `أهلاً فيك! أنا مساعد درب. بقدر أرتب لك مشوار: احكيلي من وين لوين ومتى، مثلاً «${ride}». وبجاوبك كمان عن الإلغاء والحواجز والدعم.`
          : `Hi! I'm the Darb assistant. I can set up a ride: tell me where from, where to and when, for example "${ride}". I can also answer questions about cancelling, checkpoints and support.`,
        suggestions: [bookChip, ...helpChips.slice(0, 2)]
      };
    case "how_are_you":
      return {
        topic,
        message: ar
          ? "الحمد لله تمام، شكراً لسؤالك! شو بتحب أساعدك فيه؟ مشوار، سؤال عن الإلغاء أو الحواجز؟"
          : "I'm doing well, thanks for asking! What can I help with: a ride, or a question about cancelling or checkpoints?",
        suggestions: [bookChip, ...helpChips.slice(0, 2)]
      };
    case "thanks":
      return {
        topic,
        message: ar ? "على الرحب والسعة! إذا بدك شي ثاني أنا جاهز." : "You're welcome! I'm here if you need anything else.",
        suggestions: []
      };
    case "goodbye":
      return {
        topic,
        message: ar ? "مع السلامة! رحلة آمنة." : "Goodbye! Safe travels.",
        suggestions: []
      };
    case "capabilities":
      return {
        topic,
        message: ar
          ? `بقدر: 1) أجهّز لك طلب مشوار من وين لوين ومتى ولكم شخص، وبعدها بتراجعه وبتأكده أنت. 2) أجاوب عن الإلغاء والحواجز والدفع والدعم. ما بقدر أحجز بدون تأكيدك. جرّب: «${ride}».`
          : `I can: 1) prepare a ride request from where, to where, when and how many people; you review and confirm it yourself. 2) Answer questions about cancelling, checkpoints, payment and support. I never book without your confirmation. Try: "${ride}".`,
        suggestions: [bookChip, ...helpChips.slice(0, 2)]
      };
    case "how_to_book":
      return {
        topic,
        message: ar
          ? `احكيلي أو اكتبلي من وين لوين ومتى (وكم راكب إذا أكتر من واحد)، مثلاً «${ride}». بعدها بتشوف ملخص الطلب وبتأكده، وبعدين بنبحث لك عن رحلات مناسبة.`
          : `Tell or type where from, where to and when (and how many people if more than one), for example "${ride}". You then see a summary to confirm, and we search for matching trips.`,
        suggestions: [bookChip]
      };
    case "cancel":
      return {
        topic,
        message: ar
          ? "لإلغاء طلب أو حجز: افتح «رحلاتي»، اختر الطلب، واضغط «إلغاء الطلب» ثم اختر السبب. إذا كان الإلغاء غير متاح في هذه المرحلة بيظهر لك التطبيق ذلك. أنا ما بقدر ألغي نيابة عنك من هذه المحادثة."
          : "To cancel a request or booking: open \"My trips\", pick the request, tap \"Cancel request\" and choose a reason. If cancelling isn't possible at that stage the app tells you. I can't cancel for you from this chat.",
        suggestions: [bookChip, helpChips[2]]
      };
    case "payment":
      return {
        topic,
        message: ar
          ? "الدفع ما بتم داخل التطبيق: الأجرة تقديرية وبتدفعها للسائق مباشرة. بتشوف الأجرة التقديرية للمقعد على بطاقة الرحلة قبل ما تحجز، وإذا ما انحدد سعر للمسار بيظهر لك ذلك. أنا ما بقدر أقولك سعراً من هون."
          : "Payment doesn't happen in the app: the fare is an estimate that you pay the driver directly. You see the estimated per-seat fare on the trip card before booking, and the app says so when a route has no fare set. I can't quote a price from this chat.",
        suggestions: [bookChip, helpChips[2]]
      };
    case "checkpoints":
      return {
        topic,
        message: ar
          ? "حالة الحواجز بتلاقيها في تبويب «الخريطة» (الحواجز). هي آخر حالة مؤكدة وممكن تكون قديمة شوي. وبعد ما سائق يقبل رحلتك بتشوف تنبيهات الحواجز على مسارها بالخريطة. أنا ما عندي حالة حواجز مباشرة."
          : "Checkpoint status is on the \"Map\" tab (Barriers). It shows the last confirmed state and may be slightly out of date. Once a driver accepts your trip you also see barrier alerts on its route. I don't have live checkpoint data myself.",
        suggestions: [bookChip, helpChips[2]]
      };
    case "support":
      return {
        topic,
        message: ar
          ? "للتواصل مع الدعم افتح الإعدادات ثم «المساعدة والدعم». قناة دعم مباشرة داخل التطبيق مش متصلة حالياً، فإذا كانت المشكلة عاجلة وبتخص سلامتك تواصل مع الجهات المختصة مباشرة. وبقدر أساعدك بإنشاء طلب مشوار من هنا."
          : "To reach support open Settings, then \"Help & Support\". A live in-app support channel is not connected yet, so if it is urgent or about your safety contact the authorities directly. I can still help you create a ride request here.",
        suggestions: [bookChip]
      };
    case "parcel_help":
      return {
        topic,
        message: ar
          ? "إرسال الطرود من هذه المحادثة غير متاح بعد. اطلب مشوار ركاب من هنا، أو استخدم نموذج الطلب إن كان متاحاً لحسابك."
          : "Sending parcels from this chat isn't available yet. I can set up a passenger ride, or you can use the order form if your account has it.",
        suggestions: [bookChip]
      };
    case "booking_status":
      return {
        topic,
        message: ar
          ? "ما بقدر أشوف حالة رحلتك من هون. افتح «رحلاتي» لتشوف حالة كل طلب، وبعد قبول سائق بتلاقي موقعه والمسار في تبويب «الخريطة»."
          : "I can't see your trip status from this chat. Open \"My trips\" for the status of each request; once a driver accepts you can follow the route on the \"Map\" tab.",
        suggestions: [helpChips[2]]
      };
  }
}
