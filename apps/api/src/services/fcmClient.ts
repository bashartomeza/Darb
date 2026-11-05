import jwt from "jsonwebtoken";
import type { FcmServiceAccount } from "../lib/pushConfig.js";

/**
 * A minimal Firebase Cloud Messaging HTTP v1 client.
 *
 * Deliberately not firebase-admin: Darb needs one endpoint (messages:send) and
 * one OAuth grant (a service-account JWT, signed with jsonwebtoken, which the
 * API already uses). firebase-admin would add a large dependency tree (Google
 * Cloud clients, gRPC) to the API image for that.
 *
 * Tokens and credentials are never logged or put into error messages.
 */

export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const DEFAULT_TIMEOUT_MS = 5_000;
/** Refresh the OAuth token this long before Google says it expires. */
const ACCESS_TOKEN_SAFETY_MS = 5 * 60_000;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type PushMessage = {
  token: string;
  title: string;
  body?: string;
  /** FCM data values must be strings. */
  data: Record<string, string>;
};

export type PushSendResult =
  | { kind: "sent" }
  /** The token is gone for good (app uninstalled, token rotated, other project): revoke it. */
  | { kind: "invalid_token"; reason: string }
  | { kind: "failed"; reason: string; status?: number };

export interface PushSender {
  send(message: PushMessage): Promise<PushSendResult>;
}

type FcmClientOptions = {
  projectId: string;
  serviceAccount: FcmServiceAccount;
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
};

type CachedToken = { value: string; expiresAt: number };

export class FcmClient implements PushSender {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private cached: CachedToken | undefined;
  private pending: Promise<string> | undefined;

  constructor(private readonly options: FcmClientOptions) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get sendUrl() {
    return `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.options.projectId)}/messages:send`;
  }

  /** OAuth access token for the FCM scope, cached until shortly before it expires. */
  async accessToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt > this.now()) return this.cached.value;
    // One grant at a time: concurrent sends share the same request.
    this.pending ??= this.fetchAccessToken().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async fetchAccessToken(): Promise<string> {
    const account = this.options.serviceAccount;
    const issuedAt = Math.floor(this.now() / 1000);
    const assertion = jwt.sign(
      { iss: account.clientEmail, scope: FCM_SCOPE, aud: account.tokenUri, iat: issuedAt, exp: issuedAt + 3600 },
      account.privateKey,
      { algorithm: "RS256" }
    );
    const response = await this.fetchImpl(account.tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) throw new Error(`fcm_oauth_failed_${response.status}`);
    const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== "string" || body.access_token.length === 0) throw new Error("fcm_oauth_malformed");
    const lifetimeMs = (typeof body.expires_in === "number" ? body.expires_in : 3600) * 1000;
    this.cached = { value: body.access_token, expiresAt: this.now() + Math.max(lifetimeMs - ACCESS_TOKEN_SAFETY_MS, 0) };
    return body.access_token;
  }

  static requestBody(message: PushMessage) {
    return {
      message: {
        token: message.token,
        notification: { title: message.title, ...(message.body ? { body: message.body } : {}) },
        data: message.data,
        android: { priority: "high" },
        apns: { headers: { "apns-priority": "10" }, payload: { aps: { sound: "default" } } }
      }
    };
  }

  async send(message: PushMessage): Promise<PushSendResult> {
    try {
      let response = await this.post(message);
      if (response.status === 401) {
        // The cached grant was revoked or expired early: fetch a fresh one once.
        this.cached = undefined;
        response = await this.post(message);
      }
      if (response.ok) return { kind: "sent" };
      return classifyFailure(response.status, await readError(response));
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      return { kind: "failed", reason: timedOut ? "timeout" : error instanceof Error ? error.message.slice(0, 60) : "error" };
    }
  }

  private async post(message: PushMessage) {
    const token = await this.accessToken();
    return this.fetchImpl(this.sendUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(FcmClient.requestBody(message)),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
  }
}

type FcmErrorBody = { status?: string; message?: string; errorCode?: string };

async function readError(response: Response): Promise<FcmErrorBody> {
  try {
    const body = (await response.json()) as {
      error?: { status?: unknown; message?: unknown; details?: Array<{ "@type"?: unknown; errorCode?: unknown }> };
    };
    const detail = body.error?.details?.find(
      (item) => typeof item?.["@type"] === "string" && (item["@type"] as string).endsWith("google.firebase.fcm.v1.FcmError")
    );
    return {
      status: typeof body.error?.status === "string" ? body.error.status : undefined,
      message: typeof body.error?.message === "string" ? body.error.message : undefined,
      errorCode: typeof detail?.errorCode === "string" ? detail.errorCode : undefined
    };
  } catch {
    return {};
  }
}

/** Same rules as firebase-admin: only errors about the token itself retire it. */
export function classifyFailure(status: number, error: FcmErrorBody): PushSendResult {
  const code = error.errorCode ?? error.status;
  if (code === "UNREGISTERED" || (status === 404 && error.status === "NOT_FOUND")) {
    return { kind: "invalid_token", reason: "unregistered" };
  }
  if (code === "SENDER_ID_MISMATCH") return { kind: "invalid_token", reason: "sender_id_mismatch" };
  if (code === "INVALID_ARGUMENT" && /registration token/i.test(error.message ?? "")) {
    return { kind: "invalid_token", reason: "invalid_token" };
  }
  return { kind: "failed", status, reason: (code ?? `http_${status}`).toLowerCase() };
}
