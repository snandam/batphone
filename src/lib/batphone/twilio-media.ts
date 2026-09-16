/**
 * Twilio recording media fetch
 *
 * Downloads a completed recording as WAV so the bytes can be uploaded to
 * Deepgram directly. Media auth is enforced on Twilio accounts, and a
 * credentialled URL must never be handed to a third party, so the file is
 * fetched here with basic auth from the Twilio API key and only the buffer
 * leaves this module.
 *
 * Retry policy (five attempts, four sleeps):
 *
 *   attempt 1  dual-channel  (RequestedChannels=2)
 *   sleep 2s
 *   attempt 2  dual-channel
 *   sleep 5s
 *   attempt 3  dual-channel
 *   sleep 15s
 *   attempt 4  dual-channel
 *   sleep 60s
 *   attempt 5  single-channel (plain .wav), one attempt only
 *
 * 404 and 5xx are retried because Twilio can fire the recording callback a
 * moment before the media is readable. The final attempt drops
 * `RequestedChannels` in case the dual mix is what is failing; a recording
 * that is still unavailable after 82 seconds is not going to appear by
 * waiting longer here, so the pipeline's retry action covers that case.
 * Any other 4xx (401, 403, 400) is a configuration problem and fails at
 * once. A thrown fetch error (network) counts as retryable.
 *
 * `fetch` and `sleep` are injectable so tests neither hit the network nor
 * wait. Error messages carry the status and recording SID only, never the
 * URL, so a logged error cannot leak credentials.
 */

import { twilioApiKey, type TwilioApiKey } from "./config";

export const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

/** Sleeps between attempts, in order. Exported so tests can assert them. */
export const RETRY_DELAYS_MS: readonly number[] = [2000, 5000, 15000, 60000];

export interface RecordingMedia {
  buffer: Uint8Array;
  channels: 1 | 2;
  contentType: string;
}

export interface TwilioMediaDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Defaults to `twilioApiKey()` from the environment. */
  apiKey?: TwilioApiKey;
}

export class RecordingFetchError extends Error {
  readonly recordingSid: string;
  /** HTTP status of the last attempt, undefined when the last attempt threw. */
  readonly status: number | undefined;
  readonly attempts: number;

  constructor(
    recordingSid: string,
    status: number | undefined,
    attempts: number,
    cause?: unknown
  ) {
    const reason =
      status === undefined ? "request failed" : `HTTP ${String(status)}`;
    super(
      `Twilio recording ${recordingSid} could not be fetched after ${String(attempts)} attempt(s): ${reason}`,
      cause === undefined ? undefined : { cause }
    );
    this.name = "RecordingFetchError";
    this.recordingSid = recordingSid;
    this.status = status;
    this.attempts = attempts;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireKey(key: TwilioApiKey): TwilioApiKey {
  const missing = (
    [
      ["TWILIO_ACCOUNT_SID", key.accountSid],
      ["TWILIO_API_KEY_SID", key.keySid],
      ["TWILIO_API_KEY_SECRET", key.keySecret],
    ] as const
  ).find(([, value]) => !value);
  if (missing) {
    throw new Error(`Missing required environment variable: ${missing[0]}`);
  }
  return key;
}

function recordingUrl(
  accountSid: string,
  recordingSid: string,
  channels: 1 | 2
): string {
  const base = `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(accountSid)}/Recordings/${encodeURIComponent(recordingSid)}.wav`;
  return channels === 2 ? `${base}?RequestedChannels=2` : base;
}

function basicAuth(key: TwilioApiKey): string {
  return `Basic ${Buffer.from(`${key.keySid}:${key.keySecret}`).toString("base64")}`;
}

/**
 * The Authorization header value for any Twilio REST call made with the
 * API key. Shared by the recording proxy and the resync reads so every
 * request authenticates the same way; the key is validated first so a
 * missing variable fails with its name rather than a Twilio 401.
 */
export function twilioAuthorization(key = twilioApiKey()): string {
  return basicAuth(requireKey(key));
}

/** Absolute URL of a resource path under the account, for example "Calls/CA….json". */
export function twilioAccountUrl(
  resourcePath: string,
  key = twilioApiKey()
): string {
  const { accountSid } = requireKey(key);
  return `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(accountSid)}/${resourcePath}`;
}

function isRetryableStatus(status: number): boolean {
  return status === 404 || status >= 500;
}

type Attempt =
  | { ok: true; media: RecordingMedia }
  | {
      ok: false;
      retryable: boolean;
      status: number | undefined;
      cause?: unknown;
    };

async function attemptFetch(
  fetchFn: typeof fetch,
  key: TwilioApiKey,
  recordingSid: string,
  channels: 1 | 2
): Promise<Attempt> {
  let response: Response;
  try {
    response = await fetchFn(
      recordingUrl(key.accountSid, recordingSid, channels),
      {
        method: "GET",
        headers: { Authorization: basicAuth(key), Accept: "audio/wav" },
        redirect: "follow",
      }
    );
  } catch (cause) {
    return { ok: false, retryable: true, status: undefined, cause };
  }

  if (!response.ok) {
    return {
      ok: false,
      retryable: isRetryableStatus(response.status),
      status: response.status,
    };
  }

  const buffer = new Uint8Array(await response.arrayBuffer());
  return {
    ok: true,
    media: {
      buffer,
      channels,
      contentType: response.headers.get("content-type") ?? "audio/x-wav",
    },
  };
}

/**
 * Fetch a recording as WAV, dual-channel when Twilio can serve it and
 * single-channel as the last resort. See the module comment for the policy.
 */
export async function fetchRecordingWav(
  recordingSid: string,
  deps: TwilioMediaDeps = {}
): Promise<RecordingMedia> {
  const key = requireKey(deps.apiKey ?? twilioApiKey());
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const totalAttempts = RETRY_DELAYS_MS.length + 1;

  let last: Attempt | undefined;
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    const channels: 1 | 2 = attempt === totalAttempts ? 1 : 2;
    last = await attemptFetch(fetchFn, key, recordingSid, channels);
    if (last.ok) return last.media;
    if (!last.retryable) {
      throw new RecordingFetchError(
        recordingSid,
        last.status,
        attempt,
        last.cause
      );
    }
    const delay = RETRY_DELAYS_MS[attempt - 1];
    if (attempt < totalAttempts && delay !== undefined) {
      await sleep(delay);
    }
  }

  const failure = last as Exclude<Attempt, { ok: true }>;
  throw new RecordingFetchError(
    recordingSid,
    failure.status,
    totalAttempts,
    failure.cause
  );
}
