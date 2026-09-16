/**
 * Display formatting shared by the email templates and the call pages.
 *
 * Timestamps are stored in UTC and rendered here with the user's stored
 * IANA zone and an explicit locale, so the email and the UI agree and a
 * server's own zone never leaks into output. Extends `formatDate` in
 * `src/lib/utils.ts`, which renders a date only.
 */

import { formatForDisplay } from "./phone";

const FALLBACK_ZONE = "UTC";

function dateTimeFormatter(
  timeZone: string,
  locale: string
): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  };
  try {
    return new Intl.DateTimeFormat(locale, options);
  } catch {
    return new Intl.DateTimeFormat(locale, {
      ...options,
      timeZone: FALLBACK_ZONE,
    });
  }
}

/**
 * "Sep 11, 2026, 3:42 PM" for the instant in the given zone. An invalid
 * zone name falls back to UTC rather than throwing, since a bad stored
 * value must never block an email.
 */
export function formatInZone(
  date: Date,
  timeZone: string,
  locale = "en-US"
): string {
  return dateTimeFormatter(timeZone, locale).format(date);
}

/** "m:ss" with unbounded minutes: 0 -> "0:00", 3661 -> "61:01". */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/** International display form of an E.164 number ("+1 415 555 2671"). */
export function formatE164ForDisplay(e164: string): string {
  return formatForDisplay(e164);
}
