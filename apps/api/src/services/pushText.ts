/**
 * Wording for push notifications.
 *
 * The inbox stores a type plus parameters and each app words them itself, but a
 * push banner is shown by the phone's system before the app runs, so its text
 * has to be written here. It mirrors the app's strings (apps/mobile/lib/l10n,
 * keys notif*) in the language the device registered with; Arabic is the default.
 */

export type PushLanguage = "ar" | "en";
type Text = { title: string; body?: string };
type Strings = Record<PushLanguage, string>;

export function pushLanguage(locale: string | null | undefined): PushLanguage {
  return locale?.toLowerCase().startsWith("en") ? "en" : "ar";
}

const tripStatus: Record<string, Strings> = {
  accepted: { en: "Accepted", ar: "مقبول" },
  pickup_started: { en: "Pickup started", ar: "بدأ التوجه للاستلام" },
  picked_up: { en: "Picked up", ar: "تم الاستلام" },
  in_transit: { en: "In transit", ar: "قيد النقل" },
  delivered: { en: "Delivered", ar: "تم التسليم" },
  completed: { en: "Completed", ar: "مكتملة" },
  cancelled: { en: "Cancelled", ar: "ملغاة" },
  failed: { en: "Failed", ar: "فشلت" }
};

const documentKind: Record<string, Strings> = {
  licence: { en: "Driving licence", ar: "رخصة القيادة" },
  vehicle_registration: { en: "Vehicle registration", ar: "ترخيص المركبة" },
  insurance: { en: "Insurance", ar: "التأمين" },
  contract: { en: "Contract", ar: "العقد" }
};

/** Labels of the cancellation reason codes (services/cancellationReasons.ts); the app has the same in cancelReason_*. */
const cancelReason: Record<string, Strings> = {
  changed_plans: { en: "Changed plans", ar: "تغيّرت الخطط" },
  found_other_transport: { en: "Found other transport", ar: "وجدت وسيلة نقل أخرى" },
  driver_too_far: { en: "The driver is too far or too slow", ar: "السائق بعيد أو متأخر" },
  wrong_details: { en: "Wrong details entered", ar: "إدخال بيانات خاطئة" },
  found_other_delivery: { en: "Found another delivery option", ar: "وجدت خيار توصيل آخر" },
  vehicle_problem: { en: "Vehicle problem", ar: "مشكلة في المركبة" },
  emergency: { en: "Emergency", ar: "حالة طارئة" },
  cannot_reach_pickup: { en: "Cannot reach the pickup point", ar: "لا يمكن الوصول إلى نقطة الاستلام" },
  route_changed: { en: "Route changed", ar: "تغيّر المسار" },
  customer_request: { en: "Customer request", ar: "بطلب من العميل" },
  driver_unavailable: { en: "Driver unavailable", ar: "السائق غير متاح" },
  safety_concern: { en: "Safety concern", ar: "مخاوف تتعلق بالسلامة" },
  duplicate: { en: "Duplicate request", ar: "طلب مكرر" },
  policy_violation: { en: "Policy violation", ar: "مخالفة للسياسة" },
  other: { en: "Other", ar: "سبب آخر" },
  no_driver_in_time: { en: "No driver accepted in time", ar: "لم يقبله أي سائق في الوقت المحدد" }
};

const cancelNoun: Record<string, { title: Strings; the: Strings }> = {
  ride: { title: { en: "Ride request cancelled", ar: "تم إلغاء طلب الرحلة" }, the: { en: "ride request", ar: "طلب الرحلة" } },
  order: { title: { en: "Order cancelled", ar: "تم إلغاء الطلب" }, the: { en: "order", ar: "الطلب" } },
  parcel: { title: { en: "Parcel cancelled", ar: "تم إلغاء الطرد" }, the: { en: "parcel", ar: "الطرد" } }
};

/** Wording of the `cancelled` notification (services/cancellations.ts). Mirrors notifCancelled* in the app. */
function cancelledText(params: unknown, lang: PushLanguage): Text {
  const kind = param(params, "kind") ?? "order";
  const noun = cancelNoun[kind] ?? cancelNoun.order;
  const by = param(params, "by");
  const reason = cancelReason[param(params, "reason") ?? "other"]?.[lang] ?? cancelReason.other[lang];
  const flag = (key: string) => params && typeof params === "object" && (params as Record<string, unknown>)[key] === true;
  const en = lang === "en";
  if (param(params, "audience") === "driver") {
    if (flag("partial")) {
      return {
        title: en ? "Order removed from your trip" : "تمت إزالة طلب من رحلتك",
        body: en ? `A ${noun.the.en} was cancelled: ${reason}. The rest of the trip continues.` : `أُلغي ${noun.the.ar}: ${reason}. تستمر بقية الرحلة.`
      };
    }
    const who =
      by === "admin"
        ? { en: "The Darb team cancelled", ar: "ألغى فريق درب" }
        : kind === "ride"
          ? { en: "The passenger cancelled", ar: "ألغى الراكب" }
          : { en: "The sender cancelled", ar: "ألغى المرسل" };
    return { title: en ? "Trip cancelled" : "تم إلغاء الرحلة", body: `${who[lang]}${en ? " this trip" : " هذه الرحلة"}: ${reason}.` };
  }
  if (flag("waiting")) {
    return {
      title: en ? "Your driver cancelled" : "ألغى السائق الرحلة",
      body: en ? "Your request is waiting for another driver." : "طلبك بانتظار سائق آخر."
    };
  }
  if (flag("automatic")) {
    return {
      title: noun.title[lang],
      body: en ? "No driver accepted it in time, so it was cancelled." : "لم يقبله أي سائق في الوقت المحدد، لذلك أُلغي تلقائياً."
    };
  }
  return {
    title: noun.title[lang],
    body: by === "admin" ? (en ? `Cancelled by the Darb team: ${reason}.` : `ألغاه فريق درب: ${reason}.`) : `${reason}.`
  };
}

const fixed: Record<string, { title: Strings; body?: Strings }> = {
  match_offered: {
    title: { en: "New match offer", ar: "عرض مطابقة جديد" },
    body: { en: "A new request is waiting for your response.", ar: "لديك طلب جديد بانتظار ردّك." }
  },
  match_accepted: {
    title: { en: "Your request was accepted", ar: "تم قبول طلبك" },
    body: { en: "A driver accepted your request.", ar: "قَبِل أحد السائقين طلبك." }
  },
  match_rejected: {
    title: { en: "Driver declined", ar: "اعتذر السائق" },
    body: {
      en: "The driver declined the request. You can look for another match.",
      ar: "اعتذر السائق عن الطلب. يمكنك البحث عن مطابقة أخرى."
    }
  },
  driver_verification_approved: {
    title: { en: "Account approved", ar: "تمت الموافقة على حسابك" },
    body: {
      en: "Your driver account was approved. You can start working now.",
      ar: "تمت الموافقة على حساب السائق. يمكنك الآن البدء بالعمل."
    }
  },
  driver_documents_expired: {
    title: { en: "Your documents have expired", ar: "انتهت صلاحية مستنداتك" },
    body: {
      en: "You cannot go online or accept new trips until you send renewed documents and they are approved.",
      ar: "لا يمكنك الاتصال أو قبول رحلات جديدة حتى تُرسل مستندات مجددة وتتم الموافقة عليها."
    }
  },
  driver_documents_renewal_submitted: {
    title: { en: "Renewal documents sent", ar: "تم إرسال مستندات التجديد" },
    body: {
      en: "Our team will review them and you will be notified of the decision.",
      ar: "سيراجعها فريقنا وتصلك رسالة عند اتخاذ القرار."
    }
  },
  driver_approaching: {
    title: { en: "Your driver is approaching", ar: "سائقك يقترب" },
    body: {
      en: "Your driver is near your pickup point. Please get ready.",
      ar: "سائقك قريب من نقطة الانطلاق. يرجى الاستعداد."
    }
  }
};

function param(params: unknown, key: string): string | undefined {
  if (!params || typeof params !== "object" || Array.isArray(params)) return undefined;
  const value = (params as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function pushText(type: string, params: unknown, locale: string | null | undefined): Text {
  const lang = pushLanguage(locale);
  if (type === "driver_approaching" && param(params, "reason") === "pickup_started") {
    // The driver marked the pickup as started: they have set off, they are not near yet.
    return {
      title: fixed.driver_approaching.title[lang],
      body:
        lang === "en"
          ? "Your driver has set off to your pickup point. Please get ready."
          : "انطلق سائقك إلى نقطة الانطلاق. يرجى الاستعداد."
    };
  }
  const preset = fixed[type];
  if (preset) return { title: preset.title[lang], body: preset.body?.[lang] };

  switch (type) {
    case "trip_status": {
      const status = param(params, "status");
      const label = status ? tripStatus[status]?.[lang] ?? status : undefined;
      return {
        title: lang === "en" ? "Trip update" : "تحديث على الرحلة",
        body: label ? (lang === "en" ? `The trip is now: ${label}` : `حالة الرحلة الآن: ${label}`) : undefined
      };
    }
    case "driver_verification_rejected": {
      // The reviewer's free-text reason stays in the app: a lock screen is not the place for it.
      return {
        title: lang === "en" ? "Verification rejected" : "تم رفض طلب التحقق",
        body: lang === "en" ? "Your account verification was not approved." : "لم تتم الموافقة على طلب التحقق من حسابك."
      };
    }
    case "driver_documents_expiring": {
      const kind = param(params, "kind");
      const document = kind ? documentKind[kind]?.[lang] : undefined;
      const date = param(params, "expires_on");
      return {
        title: lang === "en" ? "Document expiring soon" : "مستند على وشك الانتهاء",
        body:
          document && date
            ? lang === "en"
              ? `Your ${document} expires on ${date}.`
              : `ينتهي ${document} بتاريخ ‪${date}‬.`
            : undefined
      };
    }
    case "incident_updated": {
      const status = param(params, "status");
      const body =
        status === "reviewing"
          ? { en: "Your report is under review.", ar: "بلاغك قيد المراجعة." }
          : status === "resolved"
            ? { en: "Your report has been resolved.", ar: "تمت معالجة بلاغك." }
            : undefined;
      return { title: lang === "en" ? "Update on your report" : "تحديث على بلاغك", body: body?.[lang] };
    }
    case "merchant_order_expired": {
      const raw = params && typeof params === "object" ? (params as Record<string, unknown>).max_age_hours : undefined;
      const hours = typeof raw === "number" ? raw : undefined;
      const body =
        param(params, "policy") === "departure_window"
          ? {
              en: "No driver was found before the pickup time you chose ended, so the order expired and nothing will be collected.",
              ar: "لم يُعثر على سائق قبل انتهاء وقت الاستلام الذي اخترته، فانتهت صلاحية الطلب ولن يُستلم شيء."
            }
          : hours !== undefined
            ? {
                en: `No driver took this order within ${hours} hours, so it expired and nothing will be collected.`,
                ar: `لم يأخذ أي سائق هذا الطلب خلال ${hours} ساعة، فانتهت صلاحيته ولن يُستلم شيء.`
              }
            : undefined;
      return { title: lang === "en" ? "Order expired" : "انتهت صلاحية الطلب", body: body?.[lang] };
    }
    case "cancelled":
      return cancelledText(params, lang);
    case "match_withdrawn": {
      const body =
        param(params, "reason") === "request_cancelled"
          ? {
              en: "The passenger cancelled this request, so it is no longer waiting for you.",
              ar: "ألغى الراكب هذا الطلب، لذلك لم يعد بانتظارك."
            }
          : param(params, "reason") === "expired"
          ? {
              en: "An order in this parcel offer expired, so it is no longer waiting for you.",
              ar: "انتهت صلاحية طلب في عرض الطرود هذا، لذلك لم يعد بانتظارك."
            }
          : {
              en: "The sender cancelled an order in this parcel offer, so it is no longer waiting for you.",
              ar: "ألغى المرسل طلباً في عرض الطرود هذا، لذلك لم يعد بانتظارك."
            };
      return { title: lang === "en" ? "Offer withdrawn" : "تم سحب العرض", body: body[lang] };
    }
    default:
      return { title: lang === "en" ? "New notification" : "إشعار جديد" };
  }
}
