import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

/**
 * The parts of a Firebase service-account key the FCM HTTP v1 sender needs.
 * `toJSON` redacts the key so an accidental `JSON.stringify(config)` or a
 * structured log of the config never prints it.
 */
export type FcmServiceAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
};

export type PushConfig =
  | { enabled: false }
  | { enabled: true; projectId: string; serviceAccount: FcmServiceAccount };

export type RawPushEnvironment = {
  PUSH_NOTIFICATIONS_ENABLED?: string;
  FCM_SERVICE_ACCOUNT_JSON?: string;
  FCM_SERVICE_ACCOUNT_FILE?: string;
  FCM_PROJECT_ID?: string;
};

/** Google's OAuth token endpoint; a key naming any other endpoint is refused so the signed grant never leaves Google. */
export const GOOGLE_OAUTH_TOKEN_URI = "https://oauth2.googleapis.com/token";
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

function redacted(account: FcmServiceAccount): FcmServiceAccount {
  Object.defineProperty(account, "toJSON", {
    enumerable: false,
    value: () => ({ projectId: account.projectId, clientEmail: account.clientEmail, privateKey: "[redacted]" })
  });
  return account;
}

/** Inline value: the key file's JSON, or the same JSON base64-encoded (easier to keep on one line). */
function decodeInline(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("{")) return trimmed;
  return Buffer.from(trimmed, "base64").toString("utf8");
}

/**
 * Reads and validates the service account. Problems name variables and fields
 * only, never values: the key is a credential.
 */
export function parseServiceAccount(text: string, source: string, problems: string[]): FcmServiceAccount | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    problems.push(`${source} is not valid service-account JSON`);
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") {
    problems.push(`${source} is not valid service-account JSON`);
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  const missing = ["project_id", "client_email", "private_key"].filter(
    (field) => typeof record[field] !== "string" || (record[field] as string).trim() === ""
  );
  if (missing.length) {
    problems.push(`${source} is missing ${missing.join(", ")}`);
    return undefined;
  }
  if (record.type !== undefined && record.type !== "service_account") {
    problems.push(`${source} must be a service-account key`);
    return undefined;
  }
  const privateKey = (record.private_key as string).replace(/\\n/g, "\n");
  if (!/-----BEGIN (RSA )?PRIVATE KEY-----/.test(privateKey)) {
    problems.push(`${source} private_key is not a PEM private key`);
    return undefined;
  }
  const tokenUri = typeof record.token_uri === "string" ? record.token_uri : GOOGLE_OAUTH_TOKEN_URI;
  if (tokenUri !== GOOGLE_OAUTH_TOKEN_URI) {
    problems.push(`${source} token_uri must be ${GOOGLE_OAUTH_TOKEN_URI}`);
    return undefined;
  }
  return redacted({
    projectId: (record.project_id as string).trim(),
    clientEmail: (record.client_email as string).trim(),
    privateKey,
    tokenUri
  });
}

/**
 * Push notifications are off unless PUSH_NOTIFICATIONS_ENABLED=true, and then
 * exactly one credential source is required: FCM_SERVICE_ACCOUNT_JSON (inline
 * JSON or base64 JSON) or FCM_SERVICE_ACCOUNT_FILE (absolute path).
 */
export function parsePushConfig(
  raw: RawPushEnvironment,
  problems: string[],
  parseBoolean: (name: string, value: string | undefined) => boolean,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8")
): PushConfig {
  const enabled = parseBoolean("PUSH_NOTIFICATIONS_ENABLED", raw.PUSH_NOTIFICATIONS_ENABLED);
  if (!enabled) return { enabled: false };

  const inline = raw.FCM_SERVICE_ACCOUNT_JSON?.trim();
  const file = raw.FCM_SERVICE_ACCOUNT_FILE?.trim();
  if (!inline && !file) {
    problems.push("PUSH_NOTIFICATIONS_ENABLED requires FCM_SERVICE_ACCOUNT_JSON or FCM_SERVICE_ACCOUNT_FILE");
    return { enabled: false };
  }
  if (inline && file) {
    problems.push("Set only one of FCM_SERVICE_ACCOUNT_JSON and FCM_SERVICE_ACCOUNT_FILE");
    return { enabled: false };
  }

  let account: FcmServiceAccount | undefined;
  if (inline) {
    account = parseServiceAccount(decodeInline(inline), "FCM_SERVICE_ACCOUNT_JSON", problems);
  } else if (!isAbsolute(file!)) {
    problems.push("FCM_SERVICE_ACCOUNT_FILE must be an absolute path");
  } else {
    let text: string | undefined;
    try {
      text = readFile(file!);
    } catch {
      problems.push("FCM_SERVICE_ACCOUNT_FILE could not be read");
    }
    if (text !== undefined) account = parseServiceAccount(text, "FCM_SERVICE_ACCOUNT_FILE", problems);
  }
  if (!account) return { enabled: false };

  const projectId = raw.FCM_PROJECT_ID?.trim() || account.projectId;
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    problems.push("FCM_PROJECT_ID (or the key's project_id) is not a valid Firebase project id");
    return { enabled: false };
  }
  return { enabled: true, projectId, serviceAccount: account };
}
