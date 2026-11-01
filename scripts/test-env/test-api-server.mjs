// Test-environment API: the real app, with one difference. The fake one-time-code
// provider also appends each code to a file (and emails it when a Gmail App Password is stored), so a tester can
// finish onboarding on a phone, and the email sender writes the email verification token to a second file
// so a normal user can finish sign-up without a real inbox. It runs on the permanent `darb` database (which the
// demo reset always refuses, lib/demoResetSafety.ts) or on an explicitly allow-listed disposable one, and never
// in staging/production or on any other database.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../..");
const dist = (path) => pathToFileURL(resolve(root, "apps/api/dist", path)).href;

const { config } = await import(dist("config.js"));
const databaseName = new URL(process.env.DATABASE_URL ?? "mysql://invalid/").pathname.slice(1);
const allowed = (process.env.DEMO_RESET_ALLOWED_DATABASES ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const permanent = databaseName === "darb";
const { evaluateDemoResetSafety } = await import(dist("lib/demoResetSafety.js"));
const resettable = evaluateDemoResetSafety(config).allowed;
if (config.isProduction || config.isStaging || (permanent ? resettable || allowed.length > 0 : !allowed.includes(databaseName))) {
  throw new Error("The local API runs outside staging/production, on the permanent darb database (never resettable) or an allow-listed disposable one.");
}

const otpFile = process.env.TEST_OTP_FILE;
if (!otpFile) throw new Error("TEST_OTP_FILE is required.");
const emailFile = resolve(dirname(otpFile), "email-codes.txt");
mkdirSync(dirname(otpFile), { recursive: true });

const { createApp } = await import(dist("app.js"));
const { FakeOtpProvider } = await import(dist("lib/otp.js"));
const { createGmailDelivery } = await import("./gmail-sender.mjs");

// With a stored Gmail App Password the email is also really sent; the file is kept either way,
// and a failed send is reported in the log without blocking the sign-up. Darb sends no SMS: the
// codes that used to be texted (invited / open sign-up and the phone step) are emailed to the address
// the app collected, exactly like production, and are also appended to the file for scripted checks.
const smtpReady = Boolean(process.env.DEMO_SMTP_USER && process.env.DEMO_SMTP_PASSWORD);
const gmail = smtpReady
  ? createGmailDelivery({ user: process.env.DEMO_SMTP_USER, appPassword: process.env.DEMO_SMTP_PASSWORD })
  : null;
delete process.env.DEMO_SMTP_PASSWORD;

// The scripted checks use fixed QA numbers and read the codes from the file, so they are not emailed.
const automatedPhone = /^\+97059000(02|03)\d{2}$/;
function emailPhoneCode(input) {
  if (!gmail || !input.email || automatedPhone.test(input.phoneE164) || input.email.endsWith("@example.com")) return;
  void sendPhoneCode(input);
}
async function sendPhoneCode(input) {
  try {
    await gmail.send({ to: input.email, locale: input.locale, purpose: "phone_code", actionToken: input.code, expiresAt: input.expiresAt });
    console.log(`verification code for ${input.phoneE164} emailed to ${input.email}`);
  } catch (error) {
    console.error(`verification code for ${input.phoneE164} could not be emailed: ${error instanceof Error ? error.message : "unknown"}`);
  }
}

class LoggingOtpProvider extends FakeOtpProvider {
  async send(input) {
    appendFileSync(otpFile, `${new Date().toISOString()} ${input.phoneE164} ${input.code}\n`);
    emailPhoneCode(input);
    return super.send(input);
  }
}
const loggingEmailDelivery = {
  kind: "test",
  async send(message) {
    appendFileSync(emailFile, `${new Date().toISOString()} ${message.to} ${message.purpose} ${message.actionToken}
`);
    if (!gmail) return;
    try {
      await gmail.send(message);
      console.log(`email sent to ${message.to} (${message.purpose})`);
    } catch (error) {
      console.error(`email to ${message.to} could not be sent: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }
};

// The phone check a normal user does after email sign-up goes to the same file as the invited codes.
// provesPhone false mirrors production: the code reaches the account's email, so the phone stays unverified.
const loggingPhoneProvider = {
  kind: "test",
  provesPhone: false,
  async send(input) {
    appendFileSync(otpFile, `${new Date().toISOString()} ${input.phoneE164} ${input.code}
`);
    emailPhoneCode(input);
  }
};

const app = createApp(config, {
  otpProvider: new LoggingOtpProvider(),
  emailDelivery: loggingEmailDelivery,
  phoneVerificationProvider: loggingPhoneProvider
});
app.listen(config.port, "0.0.0.0", () => console.log(`Darb test API on ${config.port} (database ${databaseName})`));
