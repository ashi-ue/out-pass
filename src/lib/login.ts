/**
 * Username ↔ login-address mapping.
 *
 * Supabase Auth is email-based, but staff sign in with a username. The username
 * is stored on `profiles` and mapped to a deterministic address here. The
 * `khuruj.local` suffix is a reserved TLD (RFC 2606), so no real mailbox can
 * collide with it and nothing is ever sent there.
 *
 * The same rule is enforced server-side (see `supabase/functions/admin-users`),
 * which is the real guard — this module only builds the address.
 */

export const LOGIN_DOMAIN = 'khuruj.local'

export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/

export function normaliseUsername(value: string): string {
  return value.trim().toLowerCase()
}

export function isValidUsername(value: string): boolean {
  return USERNAME_PATTERN.test(normaliseUsername(value))
}

/** The address Supabase Auth stores for a given username. */
export function loginEmail(username: string): string {
  return `${normaliseUsername(username)}@${LOGIN_DOMAIN}`
}
