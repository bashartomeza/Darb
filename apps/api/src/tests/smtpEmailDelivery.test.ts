import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSmtpEmailDelivery, dotStuff, encodeHeaderText, SmtpDeliveryError } from "../services/smtpEmailDelivery.js";
import { renderAuthEmail } from "../services/emailTemplates.js";

type Behavior = {
  transport?: "plain" | "tls" | "starttls";
  advertiseStarttls?: boolean;
  starttlsReply?: string;
  authMechs?: string;
  authReply?: string;
  rcptReply?: string;
  silent?: boolean;
};

type Fake = { port: number; lines: string[]; data: string; connections: number; close(): Promise<void> };

let key = "";
let cert = "";
let tlsAvailable = false;
let dir = "";

beforeAll(() => {
  try {
    dir = mkdtempSync(join(tmpdir(), "masari-smtp-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"),
      "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
    key = readFileSync(join(dir, "k.pem"), "utf8"); cert = readFileSync(join(dir, "c.pem"), "utf8");
    tlsAvailable = true;
  } catch { tlsAvailable = false; }
});
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

async function fakeSmtp(b: Behavior = {}): Promise<Fake> {
  const state = { lines: [] as string[], data: "", connections: 0 };
  const sockets = new Set<net.Socket>();
  const handle = (initial: net.Socket) => {
    let socket = initial;
    let inData = false;
    let pending = "";
    let secure = b.transport === "tls";
    const send = (text: string) => { if (!socket.destroyed) socket.write(text + "\r\n"); };
    const onData = (chunk: Buffer) => {
      pending += chunk.toString("utf8");
      let index: number;
      while ((index = pending.indexOf("\r\n")) !== -1) {
        const line = pending.slice(0, index); pending = pending.slice(index + 2);
        if (inData) {
          if (line === ".") { inData = false; send("250 queued"); } else state.data += line + "\n";
          continue;
        }
        state.lines.push(line);
        if (line.startsWith("EHLO")) {
          const caps = ["250-fake.example"];
          if (b.transport === "starttls" && !secure && b.advertiseStarttls !== false) caps.push("250-STARTTLS");
          caps.push(`250 AUTH ${b.authMechs ?? "PLAIN LOGIN"}`);
          send(caps.join("\r\n"));
        } else if (line === "STARTTLS") {
          if (b.starttlsReply) { send(b.starttlsReply); continue; }
          send("220 go ahead");
          const upgraded = new tls.TLSSocket(socket, { isServer: true, key, cert });
          socket.off("data", onData); socket = upgraded; secure = true; pending = "";
          upgraded.on("data", onData); upgraded.on("error", () => {});
        } else if (line.startsWith("AUTH PLAIN ")) send(b.authReply ?? "235 ok");
        else if (line === "AUTH LOGIN") send("334 VXNlcm5hbWU6");
        else if (state.lines.at(-2) === "AUTH LOGIN") send("334 UGFzc3dvcmQ6");
        else if (state.lines.at(-3) === "AUTH LOGIN") send(b.authReply ?? "235 ok");
        else if (line.startsWith("MAIL FROM")) send("250 ok");
        else if (line.startsWith("RCPT TO")) send(b.rcptReply ?? "250 ok");
        else if (line === "DATA") { inData = true; send("354 go"); }
        else if (line === "QUIT") socket.end("221 bye\r\n");
      }
    };
    void secure;
    socket.on("data", onData); socket.on("error", () => {});
    if (!b.silent) send("220 fake ready"); else return;
  };
  const server = b.transport === "tls"
    ? tls.createServer({ key, cert }, (s) => { state.connections++; sockets.add(s); handle(s); })
    : net.createServer((s) => { state.connections++; sockets.add(s); handle(s); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return {
    port: (server.address() as net.AddressInfo).port,
    get lines() { return state.lines; }, get data() { return state.data; }, get connections() { return state.connections; },
    close: () => new Promise<void>((resolve) => { for (const s of sockets) s.destroy(); server.close(() => resolve()); })
  };
}

const message = (extra: Record<string, unknown> = {}) => ({
  to: "rider@example.com", locale: "en" as const, purpose: "email_verification" as const,
  actionToken: "482913", expiresAt: new Date(Date.now() + 15 * 60_000), ...extra
});
const base = { fromAddress: "no-reply@masari.example", fromName: "Masari", user: "mailer", password: "s3cret-pass", timeoutMs: 3000 };
const plain = (port: number, extra = {}) => createSmtpEmailDelivery({ ...base, host: "127.0.0.1", port, secure: "starttls", plaintextForTests: true, ...extra });
const decodeParts = (data: string) => {
  const parts = [...data.matchAll(/Content-Type: (text\/\w+); charset=UTF-8\nContent-Transfer-Encoding: base64\n\n([\s\S]*?)\n--/g)];
  return Object.fromEntries(parts.map((m) => [m[1], Buffer.from(m[2].replace(/\n/g, ""), "base64").toString("utf8")]));
};

describe("SMTP email delivery", () => {
  it("is an approved delivery and sends a bilingual multipart message with AUTH PLAIN", async () => {
    const smtp = await fakeSmtp();
    try {
      const delivery = plain(smtp.port);
      expect(delivery.kind).toBe("approved");
      await delivery.send(message({ locale: "ar", purpose: "password_reset" }));
      const auth = smtp.lines.find((l) => l.startsWith("AUTH PLAIN "))!;
      expect(Buffer.from(auth.slice(11), "base64").toString()).toBe("\u0000mailer\u0000s3cret-pass");
      expect(smtp.lines).toContain("MAIL FROM:<no-reply@masari.example>");
      expect(smtp.lines).toContain("RCPT TO:<rider@example.com>");
      expect(smtp.data).toMatch(/^From: "?Masari"? <no-reply@masari\.example>$/m);
      expect(smtp.data).toMatch(/^To: <rider@example\.com>$/m);
      expect(smtp.data).toMatch(/^Subject: =\?UTF-8\?B\?/m);
      expect(smtp.data).toMatch(/Content-Type: multipart\/alternative; boundary="masari_[0-9a-f]+"/);
      const parts = decodeParts(smtp.data);
      expect(parts["text/plain"]).toMatch(/\r\n\r\n482913\r\n\r\n/);
      expect(parts["text/plain"]).toContain("مساري");
      expect(parts["text/plain"]).toContain("15 دقيقة");
      expect(parts["text/html"]).toContain('dir="rtl"');
      expect(parts["text/html"]).toContain("482913");
      expect(smtp.data).not.toContain("s3cret-pass");
    } finally { await smtp.close(); }
  });

  it("falls back to AUTH LOGIN when PLAIN is not offered", async () => {
    const smtp = await fakeSmtp({ authMechs: "LOGIN" });
    try {
      await plain(smtp.port).send(message());
      const at = smtp.lines.indexOf("AUTH LOGIN");
      expect(Buffer.from(smtp.lines[at + 1], "base64").toString()).toBe("mailer");
      expect(Buffer.from(smtp.lines[at + 2], "base64").toString()).toBe("s3cret-pass");
    } finally { await smtp.close(); }
  });

  it("fails when the server offers no usable AUTH mechanism", async () => {
    const smtp = await fakeSmtp({ authMechs: "CRAM-MD5" });
    try {
      await expect(plain(smtp.port).send(message())).rejects.toMatchObject({ code: "smtp_auth_unsupported" });
      expect(smtp.lines.some((l) => l.startsWith("MAIL FROM"))).toBe(false);
    } finally { await smtp.close(); }
  });

  it("surfaces an authentication failure without leaking the password or server text", async () => {
    const smtp = await fakeSmtp({ authReply: "535 5.7.8 s3cret-pass rejected" });
    try {
      const error = await plain(smtp.port).send(message()).then(() => undefined, (e: unknown) => e);
      expect(error).toBeInstanceOf(SmtpDeliveryError);
      expect((error as SmtpDeliveryError).code).toBe("smtp_auth_535");
      expect(String((error as Error).message)).not.toContain("s3cret-pass");
      expect(smtp.lines.some((l) => l === "DATA")).toBe(false);
    } finally { await smtp.close(); }
  });

  it("surfaces a rejected recipient", async () => {
    const smtp = await fakeSmtp({ rcptReply: "550 no such user" });
    try { await expect(plain(smtp.port).send(message())).rejects.toMatchObject({ code: "smtp_rcpt_to_550" }); }
    finally { await smtp.close(); }
  });

  it("times out when the server stops answering", async () => {
    const smtp = await fakeSmtp({ silent: true });
    try {
      const started = Date.now();
      await expect(plain(smtp.port, { timeoutMs: 250 }).send(message())).rejects.toMatchObject({ code: "smtp_timeout" });
      expect(Date.now() - started).toBeLessThan(2500);
    } finally { await smtp.close(); }
  });

  it("reports a refused connection as an error", async () => {
    const probe = net.createServer(); await new Promise<void>((r) => probe.listen(0, "127.0.0.1", () => r()));
    const port = (probe.address() as net.AddressInfo).port; await new Promise<void>((r) => probe.close(() => r()));
    await expect(plain(port).send(message())).rejects.toBeInstanceOf(SmtpDeliveryError);
  });

  it.each([
    "rider@example.com\r\nBcc: attacker@example.com",
    "rider@example.com>\r\nRCPT TO:<attacker@example.com",
    "rider@example.com, attacker@example.com",
    "Rider <rider@example.com>",
    "rider@example.com\nX: y",
    "ri der@example.com",
    ""
  ])("rejects an unsafe recipient before connecting: %j", async (to) => {
    const smtp = await fakeSmtp();
    try {
      await expect(plain(smtp.port).send(message({ to }))).rejects.toMatchObject({ code: "smtp_recipient_invalid" });
      expect(smtp.connections).toBe(0);
    } finally { await smtp.close(); }
  });

  it("rejects unsafe sender configuration", () => {
    expect(() => plain(1, { fromAddress: "a@b.example\r\nBcc: x@y.example" })).toThrow(/smtp_from_invalid/);
    expect(() => plain(1, { password: "pw\r\nQUIT" })).toThrow(/smtp_credentials_invalid/);
    expect(() => plain(1, { user: "u\nv" })).toThrow(/smtp_credentials_invalid/);
  });

  it("refuses a sender display name that carries a header break, and encodes Arabic names", async () => {
    const smtp = await fakeSmtp();
    try {
      await expect(plain(smtp.port, { fromName: "Masari\r\nBcc: x@y.example" }).send(message())).rejects.toMatchObject({ code: "smtp_header_invalid" });
      expect(smtp.connections).toBe(0);
      await plain(smtp.port, { fromName: "مساري" }).send(message());
      expect(smtp.data).toMatch(/^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <no-reply@masari\.example>$/m);
      expect(smtp.data).not.toMatch(/^Bcc:/m);
    } finally { await smtp.close(); }
  });

  it("rejects an action token that is not a plain code", () => {
    expect(() => renderAuthEmail(message({ actionToken: "1\r\nBcc: x" }))).toThrow(/email_code_invalid/);
  });

  describe("encoding helpers", () => {
    it("dot-stuffs leading dots and normalises line endings", () => {
      expect(dotStuff(".first\n.second\r\nmid .x\r\n..already")).toBe("..first\r\n..second\r\nmid .x\r\n...already");
    });
    it("keeps ASCII subjects and splits long UTF-8 subjects into short encoded words", () => {
      expect(encodeHeaderText("Hello")).toBe("Hello");
      const encoded = encodeHeaderText("رمز التحقق من مساري ".repeat(4));
      for (const word of encoded.split("\r\n ")) {
        expect(word.length).toBeLessThanOrEqual(75);
        expect(Buffer.from(word.slice(10, -2), "base64").toString("utf8")).not.toContain("�");
      }
      expect(() => encodeHeaderText("a\r\nBcc: x")).toThrow(/smtp_header_invalid/);
    });
    it("renders the code alone on a line with the expiry in minutes, in both languages", () => {
      const en = renderAuthEmail(message({ expiresAt: new Date(Date.now() + 10 * 60_000 - 5) }));
      expect(en.subject).toBe("Your Masari verification code");
      expect(en.text).toMatch(/\r\n\r\n482913\r\n\r\nThe code expires in 10 minutes\./);
      const ar = renderAuthEmail(message({ locale: "ar", purpose: "password_set", expiresAt: new Date(Date.now() + 5 * 60_000) }));
      expect(ar.text).toMatch(/\r\n\r\n482913\r\n\r\nينتهي الرمز بعد 5 دقيقة\./);
    });
  });

  describe("transport security", () => {
    it("refuses to authenticate when STARTTLS is not advertised", async () => {
      const smtp = await fakeSmtp({ transport: "starttls", advertiseStarttls: false });
      try {
        const delivery = createSmtpEmailDelivery({ ...base, host: "127.0.0.1", port: smtp.port, secure: "starttls" });
        await expect(delivery.send(message())).rejects.toMatchObject({ code: "smtp_starttls_unsupported" });
        expect(smtp.lines.some((l) => l.startsWith("AUTH") || l.startsWith("MAIL"))).toBe(false);
      } finally { await smtp.close(); }
    });

    it("refuses to authenticate when the server declines the STARTTLS upgrade", async () => {
      const smtp = await fakeSmtp({ transport: "starttls", starttlsReply: "454 TLS not available" });
      try {
        const delivery = createSmtpEmailDelivery({ ...base, host: "127.0.0.1", port: smtp.port, secure: "starttls" });
        await expect(delivery.send(message())).rejects.toMatchObject({ code: "smtp_starttls_454" });
        expect(smtp.lines.some((l) => l.startsWith("AUTH") || l.startsWith("MAIL"))).toBe(false);
      } finally { await smtp.close(); }
    });

    it.runIf(() => tlsAvailable)("upgrades with STARTTLS, verifies the certificate, then authenticates", async () => {
      if (!tlsAvailable) return;
      const smtp = await fakeSmtp({ transport: "starttls" });
      try {
        const delivery = createSmtpEmailDelivery({ ...base, host: "localhost", port: smtp.port, secure: "starttls", tlsOptions: { ca: cert } });
        await delivery.send(message({ locale: "ar" }));
        expect(smtp.lines.indexOf("STARTTLS")).toBeGreaterThan(-1);
        expect(smtp.lines.findIndex((l) => l.startsWith("AUTH"))).toBeGreaterThan(smtp.lines.indexOf("STARTTLS"));
        expect(decodeParts(smtp.data)["text/plain"]).toContain("482913");
      } finally { await smtp.close(); }
    });

    it.runIf(() => tlsAvailable)("does not send credentials to a server whose certificate is not trusted", async () => {
      if (!tlsAvailable) return;
      const smtp = await fakeSmtp({ transport: "starttls" });
      try {
        const delivery = createSmtpEmailDelivery({ ...base, host: "localhost", port: smtp.port, secure: "starttls" });
        await expect(delivery.send(message())).rejects.toBeInstanceOf(SmtpDeliveryError);
        expect(smtp.lines.some((l) => l.startsWith("AUTH"))).toBe(false);
      } finally { await smtp.close(); }
    });

    it.runIf(() => tlsAvailable)("supports implicit TLS", async () => {
      if (!tlsAvailable) return;
      const smtp = await fakeSmtp({ transport: "tls" });
      try {
        const delivery = createSmtpEmailDelivery({ ...base, host: "localhost", port: smtp.port, secure: "tls", tlsOptions: { ca: cert } });
        await delivery.send(message());
        expect(smtp.lines).toContain("RCPT TO:<rider@example.com>");
      } finally { await smtp.close(); }
    });
  });
});
