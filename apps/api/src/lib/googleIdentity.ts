import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { z } from "zod";

export type VerifiedGoogleIdentity = { sub: string; email: string; emailVerified: true };
export type GoogleVerifier = (credential: string, audiences: string[]) => Promise<VerifiedGoogleIdentity>;
const googleClient = new OAuth2Client();

/** Identity claims only: discard display name, picture and all other profile data. */
export function validatedGoogleClaims(payload: TokenPayload | undefined, audiences: string[]): VerifiedGoogleIdentity {
  if (!payload || !audiences.includes(payload.aud) || !["https://accounts.google.com", "accounts.google.com"].includes(payload.iss)
    || !Number.isFinite(payload.exp) || payload.exp <= Date.now() / 1000
    || !Number.isFinite(payload.iat) || payload.iat > Date.now() / 1000 + 60
    || !payload.sub || payload.sub.length > 191 || payload.email_verified !== true) throw new Error("invalid_google_token");
  const email = z.string().trim().toLowerCase().email().max(191).safeParse(payload.email);
  if (!email.success) throw new Error("invalid_google_token");
  return { sub: payload.sub, email: email.data, emailVerified: true };
}

export const verifyGoogleIdentity: GoogleVerifier = async (credential, audiences) => {
  if (!audiences.length) throw new Error("google_auth_unavailable");
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: audiences });
    return validatedGoogleClaims(ticket.getPayload(), audiences);
  } catch { throw new Error("invalid_google_token"); }
};
