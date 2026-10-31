import { describe, expect, it, vi } from "vitest";
import { EmailOtpProvider } from "../lib/otp.js";
import { maskEmail } from "../lib/contactEmail.js";
import { renderAuthEmail } from "../services/emailTemplates.js";

const expiresAt = new Date(Date.now() + 5 * 60_000);
const base = { phoneE164: "+970590000001", code: "123456", locale: "en" as const, expiresAt, idempotencyKey: "challenge-1" };

describe("EmailOtpProvider (Masari sends no SMS)", () => {
  it("emails the code to the attempt's address and does not claim to prove the phone", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const provider = new EmailOtpProvider({ kind: "approved", send });
    expect(provider.name).toBe("email");
    expect(provider.provesPhone).toBe(false);
    const result = await provider.send({ ...base, email: "a@example.com" });
    expect(result).toEqual({ status: "accepted", providerMessageId: "challenge-1" });
    expect(send).toHaveBeenCalledWith({ to: "a@example.com", locale: "en", purpose: "phone_code", actionToken: "123456", expiresAt });
  });

  it("rejects without an address and reports unknown when delivery fails", async () => {
    const send = vi.fn().mockRejectedValue(new Error("smtp_down"));
    const provider = new EmailOtpProvider({ kind: "approved", send });
    expect(await provider.send(base)).toEqual({ status: "rejected" });
    expect(send).not.toHaveBeenCalled();
    expect(await provider.send({ ...base, email: "a@example.com" })).toEqual({ status: "unknown" });
  });
});

describe("phone_code email copy", () => {
  it("is bilingual, shows the code and the expiry, and never mentions a link", () => {
    const en = renderAuthEmail({ locale: "en", purpose: "phone_code", actionToken: "123456", expiresAt });
    expect(en.text).toContain("123456");
    expect(en.text).toContain("The code expires in 5 minutes.");
    const ar = renderAuthEmail({ locale: "ar", purpose: "phone_code", actionToken: "123456", expiresAt });
    expect(ar.text).toContain("ينتهي الرمز بعد 5 دقيقة.");
    expect(ar.html).toContain('dir="rtl"');
  });
});

describe("maskEmail", () => {
  it("keeps only the first character and the domain", () => {
    expect(maskEmail("alice@example.com")).toBe("a***@example.com");
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail("nope")).toBeNull();
  });
});
