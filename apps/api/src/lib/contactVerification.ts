/**
 * An account counts as having a verified contact when its email is verified, or
 * when it has no email and its phone was verified by a one-time code during an
 * invited sign-up. Accounts that only have an unverified phone never qualify.
 */
export function hasVerifiedContact(user: {
  email?: string | null;
  email_verified_at?: Date | null;
  phone_verified_at?: Date | null;
}) {
  return Boolean(user.email_verified_at) || (!user.email && Boolean(user.phone_verified_at));
}
