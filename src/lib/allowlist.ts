/**
 * Sign-in allowlist
 *
 * Bat Phone is an internal tool. Only accounts the operator lists in
 * ALLOWED_EMAILS (exact addresses) or ALLOWED_EMAIL_DOMAINS (apex domains)
 * may sign in. Everything here is pure so it can be unit tested without
 * Better Auth; `src/lib/auth.ts` wires it into the user-create hook.
 *
 * Rules:
 * - Comparison is case-insensitive on both sides.
 * - An address entry must match the whole address.
 * - A domain entry matches the address's domain exactly, so listing
 *   `acme.com` does not admit `mail.acme.com`.
 * - Empty lists reject everyone. There is no "allow all" mode on purpose.
 */

export interface Allowlist {
  emails: readonly string[];
  domains: readonly string[];
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeList(values: readonly string[]): string[] {
  return values.map(normalize).filter((v) => v.length > 0);
}

export function isAllowedEmail(email: string, allowlist: Allowlist): boolean {
  const candidate = normalize(email);
  const at = candidate.lastIndexOf("@");
  if (at <= 0 || at === candidate.length - 1) {
    return false;
  }

  const emails = normalizeList(allowlist.emails);
  if (emails.includes(candidate)) {
    return true;
  }

  const domain = candidate.slice(at + 1);
  const domains = normalizeList(allowlist.domains);
  return domains.includes(domain);
}

/**
 * Parse the allowlist from an env-shaped object. Both variables are
 * comma-separated; whitespace and empty entries are ignored.
 */
export function parseAllowlist(env: Record<string, string | undefined>): {
  emails: string[];
  domains: string[];
} {
  const split = (value: string | undefined) =>
    normalizeList((value ?? "").split(","));
  return {
    emails: split(env.ALLOWED_EMAILS),
    domains: split(env.ALLOWED_EMAIL_DOMAINS),
  };
}
