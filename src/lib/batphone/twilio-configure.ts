/**
 * Twilio number configuration
 *
 * Pure logic behind `npm run twilio:configure`. Points the bat phone number's
 * webhooks at the current public base URL and makes sure a Verify service
 * exists. The Twilio client is injected so the computation can be tested
 * without network access; `scripts/twilio-configure.ts` is the CLI wrapper.
 */

import {
  callbackUrl,
  publicBaseUrl,
  twilioApiKey,
  twilioPhoneNumber,
  twilioVerifyServiceSid,
  voiceSettings,
} from "./config";
import { unavailable, type VoiceSettings } from "./twiml";

/** The subset of the Twilio SDK the configure step touches. */
export interface ConfigureClient {
  listIncomingPhoneNumbers(phoneNumber: string): Promise<IncomingNumber[]>;
  updateIncomingPhoneNumber(
    sid: string,
    params: NumberWebhookUpdate
  ): Promise<void>;
  createVerifyService(friendlyName: string): Promise<{ sid: string }>;
}

export interface IncomingNumber {
  sid: string;
  phoneNumber: string;
}

export interface NumberWebhookUpdate {
  voiceUrl: string;
  voiceMethod: "POST";
  statusCallback: string;
  statusCallbackMethod: "POST";
  voiceFallbackUrl: string;
  voiceFallbackMethod: "GET" | "POST";
}

export interface ConfigureEnv {
  phoneNumber: string;
  voice: VoiceSettings;
  /** Overrides the hosted default with the operator's own TwiML URL. */
  fallbackTwimlUrl?: string;
  verifyServiceSid?: string;
}

export interface ConfigureResult {
  baseUrl: string;
  numberSid: string;
  phoneNumber: string;
  update: NumberWebhookUpdate;
  verifyServiceSid: string;
  verifyServiceCreated: boolean;
  notes: string[];
}

export const VERIFY_SERVICE_NAME = "Bat Phone";

const VOICE_PATH = "/api/twilio/voice";
const STATUS_PATH = "/api/twilio/call-status";
/**
 * Twilio's hosted Echo Twimlet returns the TwiML in its query string. It
 * needs no account, costs nothing, and stays up when this app does not,
 * which is exactly when the voice fallback URL is requested.
 */
export const ECHO_TWIMLET_URL = "https://twimlets.com/echo";

/** A Twilio-hosted URL that serves the given TwiML verbatim. */
export function echoTwimlUrl(twiml: string): string {
  return `${ECHO_TWIMLET_URL}?Twiml=${encodeURIComponent(twiml)}`;
}

/**
 * The webhook update for the number, derived from the public base URL.
 * The voice fallback always points somewhere the caller can hear an
 * apology: the operator's own TwiML URL when given, otherwise the
 * "unavailable" message served by the Echo Twimlet.
 */
export function buildNumberUpdate(
  voice: VoiceSettings,
  fallbackTwimlUrl?: string
): NumberWebhookUpdate {
  const override = fallbackTwimlUrl?.trim();
  return {
    voiceUrl: callbackUrl(VOICE_PATH),
    voiceMethod: "POST",
    statusCallback: callbackUrl(STATUS_PATH),
    statusCallbackMethod: "POST",
    // GET lets Twilio cache the static fallback; TwiML Bins accept either.
    voiceFallbackUrl: override || echoTwimlUrl(unavailable(voice)),
    voiceFallbackMethod: "GET",
  };
}

/**
 * Read the configure inputs from process.env. Throws with the variable
 * name when a required value is missing so the CLI can exit clearly.
 */
export function readConfigureEnv(): ConfigureEnv {
  const { accountSid, keySid, keySecret } = twilioApiKey();
  const phoneNumber = twilioPhoneNumber();
  const missing = [
    ["TWILIO_ACCOUNT_SID", accountSid],
    ["TWILIO_API_KEY_SID", keySid],
    ["TWILIO_API_KEY_SECRET", keySecret],
    ["TWILIO_PHONE_NUMBER", phoneNumber],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}`
    );
  }
  return {
    phoneNumber,
    voice: voiceSettings(),
    fallbackTwimlUrl:
      process.env.TWILIO_FALLBACK_TWIML_URL?.trim() || undefined,
    verifyServiceSid: twilioVerifyServiceSid() || undefined,
  };
}

/**
 * Point the number at the app and ensure a Verify service exists.
 * Returns everything it set so the CLI can print it.
 */
export async function configureTwilio(
  client: ConfigureClient,
  env: ConfigureEnv
): Promise<ConfigureResult> {
  const notes: string[] = [];
  const numbers = await client.listIncomingPhoneNumbers(env.phoneNumber);
  const number =
    numbers.find((n) => n.phoneNumber === env.phoneNumber) ?? numbers[0];
  if (!number) {
    throw new Error(
      `No incoming phone number matching ${env.phoneNumber} on this Twilio account. ` +
        "Check TWILIO_PHONE_NUMBER (E.164) and that the number belongs to TWILIO_ACCOUNT_SID."
    );
  }

  const update = buildNumberUpdate(env.voice, env.fallbackTwimlUrl);
  if (!env.fallbackTwimlUrl) {
    notes.push(
      "Voice fallback uses Twilio's hosted Echo Twimlet with the unavailable message. " +
        "Set TWILIO_FALLBACK_TWIML_URL to serve your own TwiML instead."
    );
  }
  await client.updateIncomingPhoneNumber(number.sid, update);

  let verifyServiceSid = env.verifyServiceSid ?? "";
  let verifyServiceCreated = false;
  if (!verifyServiceSid) {
    const service = await client.createVerifyService(VERIFY_SERVICE_NAME);
    verifyServiceSid = service.sid;
    verifyServiceCreated = true;
    notes.push(
      `Created Verify service "${VERIFY_SERVICE_NAME}" (${service.sid}). ` +
        "Add it as the TWILIO_VERIFY_SERVICE_SID Codespaces secret so the next start reuses it."
    );
  }

  return {
    baseUrl: publicBaseUrl(),
    numberSid: number.sid,
    phoneNumber: number.phoneNumber,
    update,
    verifyServiceSid,
    verifyServiceCreated,
    notes,
  };
}

/** Human-readable report of a configure run, one value per line. */
export function formatConfigureResult(result: ConfigureResult): string {
  const lines = [
    `Public base URL:        ${result.baseUrl}`,
    `Number:                 ${result.phoneNumber} (${result.numberSid})`,
    `Voice URL:              ${result.update.voiceUrl} [${result.update.voiceMethod}]`,
    `Status callback:        ${result.update.statusCallback} [${result.update.statusCallbackMethod}]`,
    `Voice fallback URL:     ${result.update.voiceFallbackUrl} [${result.update.voiceFallbackMethod}]`,
    `Verify service SID:     ${result.verifyServiceSid}${result.verifyServiceCreated ? " (created)" : ""}`,
  ];
  for (const note of result.notes) {
    lines.push(`Note: ${note}`);
  }
  return lines.join("\n");
}

/**
 * Build the SDK-backed client. Authenticates with the API key scoped to
 * the account, never the auth token, matching `verify.ts`.
 */
export async function sdkConfigureClient(): Promise<ConfigureClient> {
  const { accountSid, keySid, keySecret } = twilioApiKey();
  const { default: twilio } = await import("twilio");
  const client = twilio(keySid, keySecret, { accountSid });
  return {
    async listIncomingPhoneNumbers(phoneNumber) {
      const list = await client.incomingPhoneNumbers.list({
        phoneNumber,
        limit: 20,
      });
      return list.map((n) => ({ sid: n.sid, phoneNumber: n.phoneNumber }));
    },
    async updateIncomingPhoneNumber(sid, params) {
      await client.incomingPhoneNumbers(sid).update(params);
    },
    async createVerifyService(friendlyName) {
      const service = await client.verify.v2.services.create({ friendlyName });
      return { sid: service.sid };
    },
  };
}
