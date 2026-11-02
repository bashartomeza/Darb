export type TokenStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const ADMIN_TOKEN_KEY = "darb_admin_token";

const sessionEndCodes = new Set([
  "access_token_expired",
  "invalid_token",
  "invalid_session",
  "session_revoked",
  "session_expired",
  "missing_token"
]);

export function clearAdminSession(sessionStore: TokenStorage, legacyStore: TokenStorage) {
  sessionStore.removeItem(ADMIN_TOKEN_KEY);
  legacyStore.removeItem(ADMIN_TOKEN_KEY);
}

export function isAdminSessionEndError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const status = "status" in error && typeof error.status === "number" ? error.status : undefined;
  return (status === 401 && sessionEndCodes.has(error.message)) ||
    (status === 403 && error.message === "account_unavailable");
}

export function createAdminSessionExpiryHandler({
  sessionStore,
  legacyStore,
  onExpired
}: {
  sessionStore: TokenStorage;
  legacyStore: TokenStorage;
  onExpired: () => void;
}) {
  let handled = false;
  return {
    handle(error: unknown, requestToken: string) {
      if (
        handled ||
        !isAdminSessionEndError(error) ||
        sessionStore.getItem(ADMIN_TOKEN_KEY) !== requestToken
      ) return false;
      handled = true;
      clearAdminSession(sessionStore, legacyStore);
      onExpired();
      return true;
    },
    reset() {
      handled = false;
    }
  };
}
