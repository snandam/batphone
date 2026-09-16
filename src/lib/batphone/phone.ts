/**
 * Phone number normalisation and caller-ID classification
 *
 * Pure module wrapping libphonenumber-js. Only E.164 is ever stored, so
 * the inbound webhook can identify the caller with an equality lookup.
 * No Next.js imports.
 */

import {
  type CountryCode,
  parsePhoneNumberFromString as parseWithMetadata,
} from "libphonenumber-js/core";
import metadata from "libphonenumber-js/metadata.min.json";

/**
 * The metadata is passed explicitly instead of using the package's bundled
 * entry point. That entry loads the JSON through require(), which some
 * loaders (tsx running the scripts) wrap as { default }, breaking every
 * parse. Passing it ourselves works the same in Next, Vitest, and tsx.
 */
function parsePhoneNumberFromString(
  text: string,
  defaultCountry?: CountryCode
) {
  return defaultCountry
    ? parseWithMetadata(text, defaultCountry, metadata)
    : parseWithMetadata(text, metadata);
}

export type NormalizeResult =
  | { ok: true; e164: string }
  | { ok: false; reason: string };

export type CallerIdKind = "e164" | "anonymous" | "invalid";

/** Strict E.164: a plus sign, a non-zero leading digit, at most 15 digits. */
const E164_PATTERN = /^\+[1-9]\d{1,14}$/;

/**
 * Values Twilio puts in `From` when the caller withheld their number.
 * The two numeric sentinels spell ANONYMOUS and RESTRICTED on a keypad.
 */
const ANONYMOUS_SENTINELS = new Set([
  "+266696687",
  "+7378742833",
  "anonymous",
  "unavailable",
  "restricted",
  "unknown",
  "private",
]);

/**
 * Parse user input into E.164. National input ("(555) 123-4567") is read
 * in `defaultRegion`; input with a country code keeps it. The number must
 * pass libphonenumber's validity check, not just its length check.
 */
export function normalizeToE164(
  input: string,
  defaultRegion: string
): NormalizeResult {
  const trimmed = (input ?? "").trim();
  if (!trimmed) {
    return { ok: false, reason: "Enter a phone number" };
  }

  const parsed = parsePhoneNumberFromString(
    trimmed,
    defaultRegion.toUpperCase() as CountryCode
  );
  if (!parsed || !parsed.isValid()) {
    return {
      ok: false,
      reason:
        "Enter a valid phone number, including the country code for numbers outside your region",
    };
  }

  const e164 = parsed.number;
  if (!E164_PATTERN.test(e164)) {
    return { ok: false, reason: "Enter a valid phone number" };
  }
  return { ok: true, e164 };
}

/**
 * Classify Twilio's `From` value. Anonymous and invalid callers skip the
 * database lookup and go straight to the "not registered" path.
 */
export function classifyCallerId(
  from: string | null | undefined
): CallerIdKind {
  const value = (from ?? "").trim();
  if (!value || ANONYMOUS_SENTINELS.has(value.toLowerCase())) {
    return "anonymous";
  }
  if (value.startsWith("client:") || value.startsWith("sip:")) {
    return "invalid";
  }
  return E164_PATTERN.test(value) ? "e164" : "invalid";
}

/** International display form ("+1 555 123 4567"); input unchanged if unparseable. */
export function formatForDisplay(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? parsed.formatInternational() : e164;
}

/** A tel: href with formatting stripped so it dials cleanly on any phone. */
export function toTelHref(number: string): string {
  return `tel:${number.replace(/[^\d+]/g, "")}`;
}
