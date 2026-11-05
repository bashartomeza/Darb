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
    default:
      return { title: lang === "en" ? "New notification" : "إشعار جديد" };
  }
}
