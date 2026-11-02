import { readFileSync } from "node:fs";

export type CliArgs = { flags: Set<string>; values: Map<string, string> };

const VALUE_FLAGS = new Set(["email", "name", "password-file"]);

export function parseCliArgs(argv: string[]): CliArgs {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error("unexpected_argument");
    const eq = arg.indexOf("=");
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    if (key === "password") throw new Error("password_must_not_be_a_cli_argument");
    if (VALUE_FLAGS.has(key)) {
      const value = inline ?? argv[++i];
      if (value === undefined) throw new Error(`missing_value:${key}`);
      values.set(key, value);
    } else {
      flags.add(key);
    }
  }
  return { flags, values };
}

/** Removes exactly one trailing line ending, so files saved by editors work. */
export function stripTrailingNewline(text: string) {
  return text.replace(/\r?\n$/, "");
}

export function readPasswordFile(path: string) {
  return stripTrailingNewline(readFileSync(path, "utf8"));
}

export async function readStdinText() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/** Hidden prompt: raw mode, nothing echoed. Requires a TTY. */
export function promptHidden(label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error("no_tty_use_password_file_or_stdin"));
    process.stderr.write(label);
    let value = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const finish = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", onData);
      process.stderr.write("\n");
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n" || char === "\u0004") {
          finish();
          return resolve(value);
        }
        if (char === "\u0003") {
          finish();
          return reject(new Error("cancelled"));
        }
        if (char === "\u007f" || char === "\b") value = [...value].slice(0, -1).join("");
        else value += char;
      }
    };
    process.stdin.on("data", onData);
  });
}
