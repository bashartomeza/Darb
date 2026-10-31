import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { buildMessage, createGmailDelivery } from "../test-env/gmail-sender.mjs";

/** A tiny SMTP server that records what the client says. */
function fakeSmtp({ rejectPassword = false } = {}) {
  const log = { lines: [], data: "" };
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let inData = false;
    let pending = "";
    socket.write("220 fake ready\r\n");
    socket.on("data", (chunk) => {
      pending += chunk;
      let index;
      while ((index = pending.indexOf("\r\n")) !== -1) {
        const line = pending.slice(0, index);
        pending = pending.slice(index + 2);
        if (inData) {
          if (line === ".") { inData = false; socket.write("250 queued\r\n"); } else log.data += line + "\n";
          continue;
        }
        log.lines.push(line);
        if (line.startsWith("EHLO")) socket.write("250-fake\r\n250 AUTH LOGIN\r\n");
        else if (line === "AUTH LOGIN") socket.write("334 VXNlcm5hbWU6\r\n");
        else if (log.lines.at(-2) === "AUTH LOGIN") socket.write("334 UGFzc3dvcmQ6\r\n");
        else if (log.lines.at(-3) === "AUTH LOGIN") socket.write(rejectPassword ? "535 bad\r\n" : "235 ok\r\n");
        else if (line.startsWith("MAIL FROM") || line.startsWith("RCPT TO")) socket.write("250 ok\r\n");
        else if (line === "DATA") { inData = true; socket.write("354 go\r\n"); }
        else if (line === "QUIT") socket.end("221 bye\r\n");
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, log, port: server.address().port })));
}

const message = (extra = {}) => ({
  to: "someone@example.com", locale: "en", purpose: "email_verification",
  actionToken: "tok_" + "a".repeat(39), expiresAt: new Date(Date.now() + 60 * 60 * 1000), ...extra
});

test("sends the token to the recipient from the Gmail account", async () => {
  const { server, log, port } = await fakeSmtp();
  try {
    const delivery = createGmailDelivery({ user: "owner@gmail.com", appPassword: "abcd efgh ijkl mnop", host: "127.0.0.1", port, mode: "plain" });
    await delivery.send(message());
    assert.ok(log.lines.includes("MAIL FROM:<owner@gmail.com>"));
    assert.ok(log.lines.includes("RCPT TO:<someone@example.com>"));
    assert.equal(Buffer.from(log.lines[log.lines.indexOf("AUTH LOGIN") + 1], "base64").toString(), "owner@gmail.com");
    // Spaces in a pasted Google App Password are dropped.
    assert.equal(Buffer.from(log.lines[log.lines.indexOf("AUTH LOGIN") + 2], "base64").toString(), "abcdefghijklmnop");
    const body = Buffer.from(log.data.split("\n\n").at(-1).replace(/\n/g, ""), "base64").toString();
    assert.match(body, /tok_a{39}/);
  } finally { server.close(); }
});

test("a refused password is reported, not swallowed", async () => {
  const { server, port } = await fakeSmtp({ rejectPassword: true });
  try {
    const delivery = createGmailDelivery({ user: "owner@gmail.com", appPassword: "wrong", host: "127.0.0.1", port, mode: "plain" });
    await assert.rejects(delivery.send(message()), /smtp_password_535/);
  } finally { server.close(); }
});

test("the message is bilingual and keeps the token on its own line", () => {
  const ar = buildMessage({ from: "owner@gmail.com", message: message({ locale: "ar" }) });
  assert.match(ar, /^Subject: =\?UTF-8\?B\?/m);
  assert.match(ar, /Content-Type: text\/plain; charset=UTF-8/);
  const text = Buffer.from(ar.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString();
  assert.match(text, /\r\n\r\ntok_a{39}\r\n\r\n/);
  assert.match(text, /مساري/);
});
