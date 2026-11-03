export type TokenStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Where earlier console builds kept the Admin bearer token. The console now
 * signs in with an HttpOnly cookie that JavaScript cannot read, so nothing is
 * written here any more; the key is only purged from browsers that still hold
 * an old token.
 */
export const ADMIN_TOKEN_KEY = "darb_admin_token";

const sessionEndCodes = new Set([
  "access_token_expired",
  "invalid_token",
  "invalid_session",
  "session_revoked",
  "session_expired",
  "missing_token"
]);

export function purgeStoredAdminTokens(sessionStore: TokenStorage, legacyStore: TokenStorage) {
  sessionStore.removeItem(ADMIN_TOKEN_KEY);
  legacyStore.removeItem(ADMIN_TOKEN_KEY);
}

let handleSequence = 0;

/**
 * A marker for one sign-in in this tab, kept only in memory. Feature code
 * passes it with each request so a late failure from an earlier sign-in can be
 * told apart from the current one. It is not a credential: the API
 * authenticates the HttpOnly session cookie.
 */
export function newAdminSessionHandle() {
  handleSequence += 1;
  return `admin-session-${Date.now().toString(36)}-${handleSequence}`;
}

export function isAdminSessionEndError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const status = "status" in error && typeof error.status === "number" ? error.status : undefined;
  return (status === 401 && sessionEndCodes.has(error.message)) ||
    (status === 403 && error.message === "account_unavailable");
}

export function createAdminSessionExpiryHandler({
  currentSession,
  onExpired
}: {
  currentSession: () => string;
  onExpired: () => void;
}) {
  let handled = false;
  return {
    handle(error: unknown, requestSession: string) {
      if (
        handled ||
        !isAdminSessionEndError(error) ||
        currentSession() !== requestSession
      ) return false;
      handled = true;
      onExpired();
      return true;
    },
    reset() {
      handled = false;
    }
  };
}
