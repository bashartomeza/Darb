// Production SMTP delivery for authentication emails (kind "approved"). Dependency-free: node:net/tls only.
// STARTTLS (usually port 587) refuses to send credentials before the connection is encrypted and verified;
// "tls" is implicit TLS (usually port 465). Errors carry short codes only, never server text or secrets.
import { randomBytes } from "node:crypto";
import net from "node:net";
import tls, { type ConnectionOptions } from "node:tls";
import type { EmailDelivery } from "./emailAuth.js";
import { renderAuthEmail } from "./emailTemplates.js";

export type SmtpDeliveryOptions = {
  host: string;
  port: number;
  secure: "starttls" | "tls";
  user?: string;
  password?: string;
  fromAddress: string;
  fromName?: string;
  /** Whole-conversation deadline, and idle limit for each step. */
  timeoutMs?: number;
  /** Local name announced in EHLO. */
  clientName?: string;
  /** Test seams only. Config never sets them. */
  tlsOptions?: ConnectionOptions;
  plaintextForTests?: boolean;
};

export class SmtpDeliveryError extends Error {
  constructor(readonly code: string) { super(code); this.name = "SmtpDeliveryError"; }
}

const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const MAX_REPLY_BYTES = 16 * 1024;

/** A bare address that cannot carry CR/LF, whitespace, angle brackets, quotes or a second address. */
export function assertSafeAddress(address: string, code: string) {
  if (typeof address !== "string" || address.length > 254 || !ADDRESS.test(address) || address.includes("..")) throw new SmtpDeliveryError(code);
  return address;
}

const b64 = (value: string) => Buffer.from(value, "utf8").toString("base64");
const wrap76 = (value: string) => value.replace(/(.{76})/g, "$1\r\n");

/** RFC 2047 encoded words (UTF-8, base64), split on code point boundaries so each word stays under 75 characters. */
export function encodeHeaderText(text: string) {
  if (/[\r\n\u0000]/.test(text)) throw new SmtpDeliveryError("smtp_header_invalid");
  if (/^[\x20-\x7e]*$/.test(text) && !text.includes("=?")) return text;
  const words: string[] = [];
  let chunk = "";
  for (const ch of text) {
    if (Buffer.byteLength(chunk + ch, "utf8") > 42) { words.push(chunk); chunk = ""; }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${b64(w)}?=`).join("\r\n ");
}

function fromHeader(name: string | undefined, address: string) {
  if (!name) return `<${address}>`;
  const encoded = encodeHeaderText(name);
  const display = encoded.startsWith("=?") ? encoded : `"${encoded.replace(/["\\]/g, "\\$&")}"`;
  return `${display} <${address}>`;
}

export function buildMimeMessage(input: { fromAddress: string; fromName?: string; to: string; subject: string; text: string; html: string; now?: Date }) {
  const from = assertSafeAddress(input.fromAddress, "smtp_from_invalid");
  const to = assertSafeAddress(input.to, "smtp_recipient_invalid");
  const boundary = `masari_${randomBytes(12).toString("hex")}`;
  const domain = from.split("@")[1];
  const part = (type: string, body: string) => [`Content-Type: ${type}; charset=UTF-8`, "Content-Transfer-Encoding: base64", "", wrap76(b64(body))].join("\r\n");
  const headers = [
    `From: ${fromHeader(input.fromName, from)}`,
    `To: <${to}>`,
    `Subject: ${encodeHeaderText(input.subject)}`,
    `Date: ${(input.now ?? new Date()).toUTCString()}`,
    `Message-ID: <${randomBytes(16).toString("hex")}@${domain}>`,
    "MIME-Version: 1.0",
    "Auto-Submitted: auto-generated",
    `Content-Type: multipart/alternative; boundary="${boundary}"`
  ];
  return headers.join("\r\n") + "\r\n\r\n" +
    `--${boundary}\r\n${part("text/plain", input.text)}\r\n` +
    `--${boundary}\r\n${part("text/html", input.html)}\r\n` +
    `--${boundary}--\r\n`;
}

/** Normalises line endings to CRLF and doubles a leading "." on every line (RFC 5321 4.5.2). */
export function dotStuff(data: string) {
  return data.replace(/\r\n|\r|\n/g, "\r\n").replace(/(^|\r\n)\./g, "$1..");
}

type Reply = { code: number; lines: string[] };

/** Reads complete (possibly multi-line) SMTP replies; replies that arrive early are queued. */
function replyReader(socket: net.Socket, onFail: (error: Error) => void) {
  socket.setEncoding("utf8");
  let buffer = "";
  let failure: Error | undefined;
  const ready: Reply[] = [];
  const pending: string[] = [];
  const waiters: { resolve: (r: Reply) => void; reject: (e: Error) => void }[] = [];
  const fail = (error: Error) => {
    failure ??= error; onFail(error);
    while (waiters.length) waiters.shift()!.reject(error);
  };
  const flush = () => {
    for (;;) {
      const index = buffer.indexOf("\r\n");
      if (index === -1) break;
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 2);
      if (!/^\d{3}([ -]|$)/.test(line)) return fail(new SmtpDeliveryError("smtp_protocol"));
      pending.push(line);
      if (line.length === 3 || line[3] === " ") {
        const reply = { code: Number(line.slice(0, 3)), lines: pending.splice(0) };
        const waiter = waiters.shift();
        if (waiter) waiter.resolve(reply); else ready.push(reply);
      }
    }
    if (buffer.length > MAX_REPLY_BYTES) fail(new SmtpDeliveryError("smtp_protocol"));
  };
  const onData = (chunk: string) => { buffer += chunk; flush(); };
  const onError = () => fail(new SmtpDeliveryError("smtp_connection"));
  const onClose = () => fail(new SmtpDeliveryError("smtp_connection_closed"));
  socket.on("data", onData); socket.on("error", onError); socket.on("close", onClose);
  return {
    next: () => new Promise<Reply>((resolve, reject) => {
      const early = ready.shift();
      if (early) return resolve(early);
      if (failure) return reject(failure);
      waiters.push({ resolve, reject });
    }),
    detach: () => { socket.off("data", onData); socket.off("error", onError); socket.off("close", onClose); }
  };
}

async function converse(options: SmtpDeliveryOptions, to: string, data: string) {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const clientName = options.clientName ?? "masari.local";
  const bareHost = options.host.replace(/^\[|\]$/g, "");
  const tlsBase: ConnectionOptions = { servername: net.isIP(bareHost) ? undefined : bareHost, minVersion: "TLSv1.2", ...options.tlsOptions };
  let abort: (error: Error) => void = () => {};
  const aborted = new Promise<never>((_, reject) => { abort = reject; });
  aborted.catch(() => {});

  let socket: net.Socket = options.secure === "tls" && !options.plaintextForTests
    ? tls.connect({ host: bareHost, port: options.port, ...tlsBase })
    : net.connect({ host: bareHost, port: options.port });
  const arm = (s: net.Socket) => {
    s.setTimeout(timeoutMs, () => { s.destroy(); abort(new SmtpDeliveryError("smtp_timeout")); });
    s.on("error", () => {});
  };
  const deadline = setTimeout(() => { socket.destroy(); abort(new SmtpDeliveryError("smtp_timeout")); }, timeoutMs);
  arm(socket);
  let reader = replyReader(socket, (e) => abort(e));
  const expect = async (accept: number[], label: string) => {
    const reply = await Promise.race([reader.next(), aborted]);
    if (!accept.includes(reply.code)) throw new SmtpDeliveryError(`smtp_${label}_${reply.code}`);
    return reply;
  };
  const say = (line: string) => { socket.write(line + "\r\n"); };
  const ehlo = async (label: string) => {
    say(`EHLO ${clientName}`);
    const reply = await expect([250], label);
    return reply.lines.slice(1).map((l) => l.slice(4).trim().toUpperCase());
  };

  try {
    await expect([220], "greeting");
    let caps = await ehlo("ehlo");
    if (options.secure === "starttls" && !options.plaintextForTests) {
      if (!caps.includes("STARTTLS")) throw new SmtpDeliveryError("smtp_starttls_unsupported");
      say("STARTTLS");
      await expect([220], "starttls");
      reader.detach();
      socket.setTimeout(0);
      socket = tls.connect({ socket, ...tlsBase });
      arm(socket);
      reader = replyReader(socket, (e) => abort(e));
      caps = await ehlo("ehlo_tls");
    }
    if (options.user && options.password) {
      const mechs = caps.find((c) => c.startsWith("AUTH "))?.slice(5).split(/\s+/) ?? [];
      if (mechs.includes("PLAIN")) {
        say(`AUTH PLAIN ${b64(`\u0000${options.user}\u0000${options.password}`)}`);
        await expect([235], "auth");
      } else if (mechs.includes("LOGIN")) {
        say("AUTH LOGIN"); await expect([334], "auth");
        say(b64(options.user)); await expect([334], "auth_user");
        say(b64(options.password)); await expect([235], "auth");
      } else throw new SmtpDeliveryError("smtp_auth_unsupported");
    }
    say(`MAIL FROM:<${options.fromAddress}>`); await expect([250], "mail_from");
    say(`RCPT TO:<${to}>`); await expect([250, 251], "rcpt_to");
    say("DATA"); await expect([354], "data");
    socket.write(dotStuff(data) + "\r\n.\r\n");
    await expect([250], "accepted");
    try { say("QUIT"); } catch { /* the message is already accepted */ }
  } catch (error) {
    throw error instanceof SmtpDeliveryError ? error : new SmtpDeliveryError("smtp_connection");
  } finally {
    clearTimeout(deadline);
    socket.end();
    socket.destroy();
  }
}

/**
 * The approved EmailDelivery. Any failure rejects with an SmtpDeliveryError (code only), so
 * EmailAuthService revokes the unsent proof and answers 503.
 */
export function createSmtpEmailDelivery(options: SmtpDeliveryOptions): EmailDelivery {
  const fromAddress = assertSafeAddress(options.fromAddress, "smtp_from_invalid");
  for (const secret of [options.user, options.password]) {
    if (secret !== undefined && /[\r\n\u0000]/.test(secret)) throw new SmtpDeliveryError("smtp_credentials_invalid");
  }
  return {
    kind: "approved",
    async send(message) {
      const to = assertSafeAddress(message.to, "smtp_recipient_invalid");
      const rendered = renderAuthEmail(message);
      const data = buildMimeMessage({ fromAddress, fromName: options.fromName, to, subject: rendered.subject, text: rendered.text, html: rendered.html });
      await converse({ ...options, fromAddress }, to, data);
    }
  };
}
