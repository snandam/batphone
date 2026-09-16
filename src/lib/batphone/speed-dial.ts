/**
 * Contact naming and speed-dial helpers
 *
 * Pure functions shared by the contacts actions (U5) and the seed script.
 */

/**
 * Canonical form of a contact name for the per-user uniqueness constraint
 * and for matching spoken names: lower-case, accents stripped, punctuation
 * removed, whitespace collapsed.
 */
export function normalizeContactName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The largest code the keypad flow accepts. */
export const MAX_SPEED_DIAL = 9999;

/** True for a whole number from 1 to MAX_SPEED_DIAL. */
export function isValidSpeedDial(code: number): boolean {
  return Number.isInteger(code) && code >= 1 && code <= MAX_SPEED_DIAL;
}

/**
 * The automatic speed-dial code for a new contact: the smallest positive
 * integer none of the user's contacts uses. A deleted contact's code is
 * free again, so after removing code 2 from {1, 2, 3} the next contact
 * gets 2. Non-positive and non-integer values in `used` are ignored.
 * Callers read `used` under a per-user lock so concurrent adds cannot
 * pick the same code; the unique index is the backstop.
 */
export function lowestFreeSpeedDial(used: Iterable<number>): number {
  const taken = new Set<number>();
  for (const code of used) {
    if (Number.isInteger(code) && code >= 1) taken.add(code);
  }
  let candidate = 1;
  while (taken.has(candidate)) candidate += 1;
  return candidate;
}
