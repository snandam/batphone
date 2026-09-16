/**
 * Bat Phone configuration
 *
 * The one place server code reads Bat Phone environment variables. Pure
 * module: no Next.js imports, reads process.env at call time so tests can
 * set values per case.
 *
 * Credentials are scoped by use. The auth token is exposed only through
 * `twilioAuthToken()` and is read only by the webhook signature validator;
 * every Twilio API call authenticates with the API key from `twilioApiKey()`.
 */

const DEFAULT_REGION = "CA";
const DEFAULT_TWILIO_VOICE = "Polly.Joanna-Neural";
/**
 * Deepgram's newest model: it boosts the contact-name hints as keywords,
 * and it keeps recognition with the provider that already transcribes the
 * recordings. `googlev2_telephony_short` is the alternative to compare.
 */
const DEFAULT_TWILIO_SPEECH_MODEL = "deepgram_nova-3";
const DEFAULT_EMAIL_FROM_NAME = "Bat Phone";
const LOCAL_BASE_URL = "http://localhost:3000";
const APP_PORT = 3000;

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * Where the world reaches this app, with no trailing slash.
 *
 * Priority order:
 * 1. Explicit `PUBLIC_BASE_URL`.
 * 2. Inside Codespaces (`CODESPACES=true`), the forwarded URL for port 3000:
 *    `https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`.
 * 3. `http://localhost:3000`.
 *
 * Twilio signs the public HTTPS URL, and Next.js never rewrites
 * `request.url` from forwarded headers, so every callback URL and the
 * signature check must be built from this value rather than the request.
 */
export function publicBaseUrl(): string {
  const explicit = env("PUBLIC_BASE_URL");
  if (explicit) return stripTrailingSlashes(explicit);

  const name = env("CODESPACE_NAME");
  const domain = env("GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN");
  if (env("CODESPACES") === "true" && name && domain) {
    return `https://${name}-${APP_PORT}.${domain}`;
  }

  return LOCAL_BASE_URL;
}

export type CallbackQuery = Record<
  string,
  string | number | boolean | null | undefined
>;

/**
 * Absolute URL for a callback path under the public base, with the query
 * percent-encoded by URLSearchParams. Undefined and null values are
 * omitted. Every TwiML verb that names a URL goes through here so the
 * signed URL Twilio sends back matches what the validator recomputes.
 */
export function callbackUrl(path: string, query?: CallbackQuery): string {
  const normalizedPath = `/${path.replace(/^\/+/, "")}`;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    params.append(key, String(value));
  }
  const search = params.toString();
  const base = stripTrailingSlashes(`${publicBaseUrl()}${normalizedPath}`);
  return search ? `${base}?${search}` : base;
}

/**
 * Twilio auth token. Signature validation only; never use it to call the
 * API. API calls go through the key from `twilioApiKey()`.
 */
export function twilioAuthToken(): string {
  return env("TWILIO_AUTH_TOKEN");
}

export interface TwilioApiKey {
  accountSid: string;
  keySid: string;
  keySecret: string;
}

/**
 * Standard API key used for every Twilio REST call: Verify, media
 * download, resync, email, and the configure script.
 */
export function twilioApiKey(): TwilioApiKey {
  return {
    accountSid: env("TWILIO_ACCOUNT_SID"),
    keySid: env("TWILIO_API_KEY_SID"),
    keySecret: env("TWILIO_API_KEY_SECRET"),
  };
}

/** The bat phone number in E.164, as configured on the server. */
export function twilioPhoneNumber(): string {
  return env("TWILIO_PHONE_NUMBER");
}

/** Verify service SID (starts with VA) used for SMS number verification. */
export function twilioVerifyServiceSid(): string {
  return env("TWILIO_VERIFY_SERVICE_SID");
}

/**
 * Speech recognition models Twilio accepts on Gather. Anything else in
 * TWILIO_SPEECH_MODEL would make every Gather fail, so an unknown value
 * falls back to the default and is reported once at startup.
 */
export const TWILIO_SPEECH_MODELS = [
  "default",
  "numbers_and_commands",
  "phone_call",
  "experimental_conversations",
  "experimental_utterances",
  "googlev2_long",
  "googlev2_short",
  "googlev2_telephony",
  "googlev2_telephony_short",
  "deepgram_nova-2",
  "deepgram_nova-3",
] as const;

export type TwilioSpeechModel = (typeof TWILIO_SPEECH_MODELS)[number];

function isSpeechModel(value: string): value is TwilioSpeechModel {
  return (TWILIO_SPEECH_MODELS as readonly string[]).includes(value);
}

/**
 * Text-to-speech voice for every Say verb, from TWILIO_VOICE. Defaults to
 * an Amazon Polly neural voice; any voice name Twilio accepts works.
 */
export function twilioVoice(): string {
  return env("TWILIO_VOICE") || DEFAULT_TWILIO_VOICE;
}

/**
 * Speech model for every Gather, from TWILIO_SPEECH_MODEL. Unknown values
 * fall back to the default; `invalidTwilioSpeechModel()` exposes them for
 * the startup warning.
 */
export function twilioSpeechModel(): TwilioSpeechModel {
  const value = env("TWILIO_SPEECH_MODEL");
  return isSpeechModel(value) ? value : DEFAULT_TWILIO_SPEECH_MODEL;
}

/** The configured TWILIO_SPEECH_MODEL when it is set and not recognised, else null. */
export function invalidTwilioSpeechModel(): string | null {
  const value = env("TWILIO_SPEECH_MODEL");
  return value && !isSpeechModel(value) ? value : null;
}

export interface VoiceSettings {
  /** Say voice name. */
  voice: string;
  /** Gather speechModel. */
  speechModel: TwilioSpeechModel;
}

/** Voice and speech model the TwiML builders need, read at call time. */
export function voiceSettings(): VoiceSettings {
  return { voice: twilioVoice(), speechModel: twilioSpeechModel() };
}

/** Deepgram key. Carries only the usage write scope. */
export function deepgramApiKey(): string {
  return env("DEEPGRAM_API_KEY");
}

export interface EmailSender {
  address: string;
  name: string;
}

/** Sender for transcript emails, from EMAIL_FROM and EMAIL_FROM_NAME. */
export function emailFrom(): EmailSender {
  return {
    address: env("EMAIL_FROM"),
    name: env("EMAIL_FROM_NAME") || DEFAULT_EMAIL_FROM_NAME,
  };
}

/**
 * When true the mailer renders and logs the email instead of sending it.
 * Accepts "true" or "1"; anything else is off.
 */
export function emailDryRun(): boolean {
  const value = env("EMAIL_DRY_RUN").toLowerCase();
  return value === "true" || value === "1";
}

/**
 * Region used to interpret phone numbers typed without a country code.
 * An ISO 3166-1 alpha-2 code such as "US" or "GB"; upper-cased here so an
 * operator's "gb" still works.
 */
export function defaultPhoneRegion(): string {
  const value = env("DEFAULT_PHONE_REGION").toUpperCase();
  return value || DEFAULT_REGION;
}

/**
 * The Twilio number employees dial, as configured for the server.
 * The browser bundle uses BAT_PHONE_NUMBER from `@/constants` instead
 * because NEXT_PUBLIC_* values are inlined at build time.
 */
export function batPhoneNumber(): string {
  return twilioPhoneNumber() || env("NEXT_PUBLIC_BAT_PHONE_NUMBER");
}
