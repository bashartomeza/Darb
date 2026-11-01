// Bilingual (Arabic / English) authentication email copy. The emailed proof is the 6-digit code that
// EmailAuthService hands over in `actionToken`; it is shown alone on its own line. No links.
import type { EmailDelivery } from "./emailAuth.js";

type Message = Parameters<EmailDelivery["send"]>[0];
type Purpose = Message["purpose"];
type Locale = Message["locale"];

export type RenderedEmail = { subject: string; text: string; html: string };

type Copy = { subject: string; intro: string; expiry: (minutes: number) => string; ignore: string; secret: string };

const enExpiry = (m: number) => `The code expires in ${m} ${m === 1 ? "minute" : "minutes"}.`;
const enSecret = "Never share this code with anyone. Darb staff will never ask for it.";
const arExpiry = (m: number) => `ينتهي الرمز بعد ${m} دقيقة.`;
const arSecret = "لا تشارك هذا الرمز مع أحد. لن يطلبه منك فريق درب أبداً.";

const COPY: Record<Locale, Record<Purpose, Copy>> = {
  en: {
    email_verification: {
      subject: "Your Darb verification code",
      intro: "Enter this verification code in the Darb app to finish creating your account:",
      expiry: enExpiry,
      ignore: "If you did not ask for it, you can ignore this message.",
      secret: enSecret
    },
    password_reset: {
      subject: "Reset your Darb password",
      intro: "Enter this code in the Darb app to reset your password:",
      expiry: enExpiry,
      ignore: "If you did not ask to reset your password, you can ignore this message; your password has not changed.",
      secret: enSecret
    },
    phone_code: {
      subject: "Your Darb verification code",
      intro: "Enter this verification code in the Darb app to continue. Darb sends codes by email, not by text message:",
      expiry: enExpiry,
      ignore: "If you did not ask for it, you can ignore this message.",
      secret: enSecret
    },
    password_set: {
      subject: "Set your Darb password",
      intro: "Enter this code in the Darb app to set a password for your account:",
      expiry: enExpiry,
      ignore: "If you did not ask to set a password, you can ignore this message.",
      secret: enSecret
    }
  },
  ar: {
    email_verification: {
      subject: "رمز التحقق من درب",
      intro: "أدخل رمز التحقق هذا في تطبيق درب لإكمال إنشاء حسابك:",
      expiry: arExpiry,
      ignore: "إن لم تطلب هذا الرمز فتجاهل هذه الرسالة.",
      secret: arSecret
    },
    password_reset: {
      subject: "إعادة تعيين كلمة مرور درب",
      intro: "أدخل هذا الرمز في تطبيق درب لإعادة تعيين كلمة المرور:",
      expiry: arExpiry,
      ignore: "إن لم تطلب إعادة تعيين كلمة المرور فتجاهل هذه الرسالة؛ لم تتغير كلمة مرورك.",
      secret: arSecret
    },
    phone_code: {
      subject: "رمز التحقق من درب",
      intro: "أدخل رمز التحقق هذا في تطبيق درب للمتابعة. يرسل درب الرموز عبر البريد الإلكتروني وليس عبر الرسائل النصية:",
      expiry: arExpiry,
      ignore: "إن لم تطلب هذا الرمز فتجاهل هذه الرسالة.",
      secret: arSecret
    },
    password_set: {
      subject: "تعيين كلمة مرور درب",
      intro: "أدخل هذا الرمز في تطبيق درب لتعيين كلمة مرور لحسابك:",
      expiry: arExpiry,
      ignore: "إن لم تطلب تعيين كلمة مرور فتجاهل هذه الرسالة.",
      secret: arSecret
    }
  }
};

const CODE_PATTERN = /^[A-Za-z0-9_-]{4,128}$/;

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Whole minutes until expiry, rounded up, never below 1. */
export function minutesUntil(expiresAt: Date, now = Date.now()) {
  return Math.max(1, Math.ceil((expiresAt.getTime() - now) / 60_000));
}

export function renderAuthEmail(message: Pick<Message, "locale" | "purpose" | "actionToken" | "expiresAt">, now = Date.now()): RenderedEmail {
  const copy = COPY[message.locale]?.[message.purpose];
  if (!copy) throw new Error("email_template_missing");
  if (!CODE_PATTERN.test(message.actionToken)) throw new Error("email_code_invalid");
  const minutes = minutesUntil(message.expiresAt, now);
  const text = [copy.intro, "", message.actionToken, "", copy.expiry(minutes), copy.ignore, copy.secret].join("\r\n") + "\r\n";
  const html = [
    "<!DOCTYPE html>",
    `<html lang="${message.locale}" dir="${message.locale === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>${escapeHtml(copy.subject)}</title></head>`,
    `<body style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#1a1a1a">`,
    `<p>${escapeHtml(copy.intro)}</p>`,
    `<p dir="ltr" style="font-size:28px;font-weight:bold;letter-spacing:6px;unicode-bidi:isolate">${escapeHtml(message.actionToken)}</p>`,
    `<p>${escapeHtml(copy.expiry(minutes))}</p>`,
    `<p>${escapeHtml(copy.ignore)}</p>`,
    `<p><strong>${escapeHtml(copy.secret)}</strong></p>`,
    "</body></html>"
  ].join("\r\n") + "\r\n";
  return { subject: copy.subject, text, html };
}
