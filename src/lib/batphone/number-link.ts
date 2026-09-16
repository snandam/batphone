/**
 * Number link check
 *
 * Answers "do calls to the bat phone number actually reach this app?" by
 * reading the number's voice webhook from Twilio and comparing it with the
 * URL this deployment would install. The dashboard shows the result so a
 * stale webhook (a new codespace, a changed tunnel) is visible before the
 * first failed call. The Twilio read is cached briefly because the
 * dashboard refreshes itself every few seconds.
 */

import { logger } from "@/lib/logger";

import { callbackUrl, twilioApiKey, twilioPhoneNumber } from "./config";

export type NumberLinkStatus = "connected" | "disconnected" | "unknown";

export interface NumberLink {
  status: NumberLinkStatus;
  /** The voice URL Twilio reported, when the number was found. */
  voiceUrl: string | null;
  /** The voice URL this deployment expects. */
  expectedVoiceUrl: string;
}

/** The one Twilio read the check needs, so tests can fake it. */
export interface NumberLinkClient {
  /** The number's voice webhook, or null when it is not on the account. */
  fetchVoiceWebhook(
    phoneNumber: string
  ): Promise<{ voiceUrl: string; voiceMethod: string } | null>;
}

export const VOICE_PATH = "/api/twilio/voice";
/** How long one Twilio answer stands in for the next reads. */
export const NUMBER_LINK_TTL_MS = 60_000;
/** Bound the Twilio read so a slow provider cannot hold up the page. */
const REQUEST_TIMEOUT_MS = 3_000;

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** Compare the webhook URL and method against this POST-only endpoint. */
export async function checkNumberLink(
  client: NumberLinkClient,
  phoneNumber: string,
  expectedVoiceUrl: string
): Promise<NumberLink> {
  const webhook = await client.fetchVoiceWebhook(phoneNumber);
  if (webhook === null) {
    return { status: "unknown", voiceUrl: null, expectedVoiceUrl };
  }
  const { voiceUrl, voiceMethod } = webhook;
  const status =
    normalizeUrl(voiceUrl) === normalizeUrl(expectedVoiceUrl) &&
    voiceMethod === "POST"
      ? "connected"
      : "disconnected";
  return { status, voiceUrl, expectedVoiceUrl };
}

/** SDK-backed client using the API key, never the auth token. */
export async function sdkNumberLinkClient(): Promise<NumberLinkClient> {
  const { accountSid, keySid, keySecret } = twilioApiKey();
  if (!accountSid || !keySid || !keySecret) {
    throw new Error("Twilio API key is not configured");
  }
  const { default: twilio } = await import("twilio");
  const client = twilio(keySid, keySecret, {
    accountSid,
    timeout: REQUEST_TIMEOUT_MS,
  });
  return {
    async fetchVoiceWebhook(phoneNumber) {
      const [number] = await client.incomingPhoneNumbers.list({
        phoneNumber,
        limit: 1,
      });
      return number
        ? { voiceUrl: number.voiceUrl, voiceMethod: number.voiceMethod }
        : null;
    },
  };
}

interface CacheEntry {
  expiresAt: number;
  link: NumberLink;
}

let cache: CacheEntry | undefined;
let inflight: Promise<NumberLink> | undefined;

/** Drop the cached answer; tests and the configure step use this. */
export function resetNumberLinkCache(): void {
  cache = undefined;
  inflight = undefined;
}

/**
 * The cached link status for the configured number. Never throws: a
 * provider or configuration error is logged and reported as "unknown" so
 * the page still renders and nothing alarms the caller falsely.
 */
export async function numberLinkStatus(
  deps: { client?: () => Promise<NumberLinkClient>; now?: () => number } = {}
): Promise<NumberLink> {
  const now = deps.now ?? Date.now;
  if (cache && cache.expiresAt > now()) return cache.link;
  if (inflight) return inflight;

  const expectedVoiceUrl = callbackUrl(VOICE_PATH);
  inflight = (async () => {
    try {
      const client = await (deps.client ?? sdkNumberLinkClient)();
      const link = await checkNumberLink(
        client,
        twilioPhoneNumber(),
        expectedVoiceUrl
      );
      if (link.status !== "connected") {
        logger.warn("number_link_not_connected", {
          status: link.status,
          voice_url: link.voiceUrl,
          expected_voice_url: link.expectedVoiceUrl,
        });
      }
      return link;
    } catch (error) {
      logger.warn("number_link_check_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return { status: "unknown", voiceUrl: null, expectedVoiceUrl };
    }
  })();
  try {
    const link = await inflight;
    cache = { expiresAt: now() + NUMBER_LINK_TTL_MS, link };
    return link;
  } finally {
    inflight = undefined;
  }
}
