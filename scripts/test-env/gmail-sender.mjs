// Sends the demo's verification emails through a Gmail account (SMTP with STARTTLS, port 587).
// Demo use only: it needs the Gmail address and an App Password. No dependencies.
import net from "node:net";
import tls from "node:tls";

const b64 = (text) => Buffer.from(text, "utf8").toString("base64");
const encodedSubject = (text) => `=?UTF-8?B?${b64(text)}?=`;

const COPY = {
  en: {
    email_verification: { subject: "Your Masari verification code", intro: "Paste this verification code into the Masari app to finish creating your account:" },
    password_reset: { subject: "Reset your Masari password", intro: "Paste this code into the Masari app to reset your password:" },
    password_set: { subject: "Set your Masari password", intro: "Paste this code into the Masari app to set your password:" },
    phone_code: { subject: "Your Masari verification code", intro: "Paste this verification code into the Masari app to continue (Masari sends codes by email, not by text message):" }
  },
  ar: {
    email_verification: { subject: "رمز التحقق من مساري", intro: "الصق رمز التحقق هذا في تطبيق مساري لإكمال إنشاء حسابك:" },
    password_reset: { subject: "إعادة تعيين كلمة مرور مساري", intro: "الصق هذا الرمز في تطبيق مساري لإعادة تعيين كلمة المرور:" },
    password_set: { subject: "تعيين كلمة مرور مساري", intro: "الصق هذا الرمز في تطبيق مساري لتعيين كلمة المرور:" },
    phone_code: { subject: "رمز التحقق من مساري", intro: "الصق رمز التحقق هذا في تطبيق مساري للمتابعة (يرسل مساري الرموز عبر البريد الإلكتروني وليس عبر الرسائل النصية):" }
  }
};

export function buildMessage({ from, message }) {
  const copy = (COPY[message.locale] ?? COPY.en)[message.purpose] ?? COPY.en.email_verification;
  const minutes = Math.max(1, Math.round((message.expiresAt.getTime() - Date.now()) / 60000));
  const body = [
    copy.intro,
    "",
    message.actionToken,
    "",
    message.locale === "ar" ? `ينتهي الرمز بعد ${minutes} دقيقة تقريباً. إن لم تطلبه فتجاهل هذه الرسالة.` : `The code expires in about ${minutes} minutes. If you did not ask for it, ignore this message.`
  ].join("\r\n");
  const headers = [
    `From: Masari demo <${from}>`,
    `To: ${message.to}`,
    `Subject: ${encodedSubject(copy.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64"
  ];
  const wrapped = b64(body).replace(/(.{76})/g, "$1\r\n");
  return headers.join("\r\n") + "\r\n\r\n" + wrapped;
}

/** Reads SMTP replies from a socket, one complete (possibly multi-line) reply at a time. */
function replyReader(socket, timeoutMs) {
  socket.setEncoding("utf8");
  let buffer = "";
  const waiters = [];
  const failAll = (error) => { while (waiters.length) waiters.shift().reject(error); };
  function flush() {
    while (waiters.length) {
      const lines = buffer.split("\r\n");
      const complete = lines.slice(0, -1);
      const end = complete.findIndex((line) => /^\d{3} /.test(line));
      if (end === -1) return;
      const reply = complete.slice(0, end + 1);
      buffer = lines.slice(end + 1).join("\r\n");
      waiters.shift().resolve({ code: Number(reply[end].slice(0, 3)), text: reply.join("\n") });
    }
  }
  const onData = (chunk) => { buffer += chunk; flush(); };
  const onError = (error) => failAll(error);
  const onClose = () => failAll(new Error("smtp_connection_closed"));
  socket.on("data", onData);
  socket.on("error", onError);
  socket.on("close", onClose);
  socket.setTimeout(timeoutMs, () => socket.destroy(new Error("smtp_timeout")));
  return {
    next: () => new Promise((resolve, reject) => { waiters.push({ resolve, reject }); flush(); }),
    detach: () => { socket.off("data", onData); socket.off("error", onError); socket.off("close", onClose); }
  };
}

/**
 * One SMTP conversation. mode "starttls" (port 587, the default for Gmail) starts in plain text and
 * upgrades before any password is sent; "tls" is implicit TLS (port 465); "plain" is for tests.
 */
async function smtpSend({ host, port, mode, user, password, from, to, data, timeoutMs }) {
  let socket = mode === "tls" ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
  let reader = replyReader(socket, timeoutMs);
  const expect = async (code, label) => {
    const r = await reader.next();
    if (r.code !== code) throw new Error(`smtp_${label}_${r.code}`);
  };
  const say = (line) => socket.write(line + "\r\n");

  try {
    await expect(220, "greeting");
    say("EHLO masari.local"); await expect(250, "ehlo");
    if (mode === "starttls") {
      say("STARTTLS"); await expect(220, "starttls");
      reader.detach();
      socket = tls.connect({ socket, servername: host });
      reader = replyReader(socket, timeoutMs);
      say("EHLO masari.local"); await expect(250, "ehlo_tls");
    }
    say("AUTH LOGIN"); await expect(334, "auth");
    say(b64(user)); await expect(334, "user");
    say(b64(password)); await expect(235, "password");
    say(`MAIL FROM:<${from}>`); await expect(250, "mail_from");
    say(`RCPT TO:<${to}>`); await expect(250, "rcpt_to");
    say("DATA"); await expect(354, "data");
    // Dot-stuffing: a line starting with "." must be doubled.
    socket.write(data.replace(/\r\n\./g, "\r\n..") + "\r\n.\r\n");
    await expect(250, "accepted");
    say("QUIT");
  } finally {
    socket.end();
  }
}

/** An EmailDelivery for the API. `host`, `port` and `mode` are only overridden by tests. */
export function createGmailDelivery({ user, appPassword, host = "smtp.gmail.com", port = 587, mode = "starttls", timeoutMs = 20000, onSent }) {
  const password = appPassword.replace(/\s+/g, "");
  return {
    kind: "test",
    async send(message) {
      await smtpSend({
        host, port, mode, user, password, from: user, to: message.to,
        data: buildMessage({ from: user, message }), timeoutMs
      });
      onSent?.(message);
    }
  };
}
