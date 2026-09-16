import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchRecordingWav,
  RecordingFetchError,
  RETRY_DELAYS_MS,
  type TwilioMediaDeps,
} from "./twilio-media";

const ACCOUNT_SID = "ACtest000000000000000000000000000";
const KEY_SID = "SKtest000000000000000000000000000";
const KEY_SECRET = "s3cretKeyValue";
const RECORDING_SID = "REtest000000000000000000000000000";

const DUAL_URL = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Recordings/${RECORDING_SID}.wav?RequestedChannels=2`;
const MONO_URL = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Recordings/${RECORDING_SID}.wav`;

const WAV_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x01]);

function wav(status = 200): Response {
  return new Response(WAV_BYTES, {
    status,
    headers: { "content-type": "audio/x-wav" },
  });
}

function status(code: number): Response {
  return new Response("nope", { status: code });
}

function deps(responses: Response[]): Required<TwilioMediaDeps> & {
  fetch: ReturnType<typeof vi.fn>;
  sleep: ReturnType<typeof vi.fn>;
} {
  const fetch = vi.fn();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  return {
    fetch,
    sleep: vi.fn().mockResolvedValue(undefined),
    apiKey: { accountSid: ACCOUNT_SID, keySid: KEY_SID, keySecret: KEY_SECRET },
  };
}

function requestedUrl(call: unknown[] | undefined): string {
  return String(call?.[0]);
}

function requestedAuth(call: unknown[] | undefined): string | undefined {
  const init = call?.[1] as { headers?: Record<string, string> } | undefined;
  return init?.headers?.Authorization;
}

describe("fetchRecordingWav", () => {
  beforeEach(() => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", ACCOUNT_SID);
    vi.stubEnv("TWILIO_API_KEY_SID", KEY_SID);
    vi.stubEnv("TWILIO_API_KEY_SECRET", KEY_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requests the dual-channel wav with basic auth from the API key", async () => {
    const d = deps([wav()]);
    const media = await fetchRecordingWav(RECORDING_SID, d);

    expect(d.fetch).toHaveBeenCalledTimes(1);
    expect(requestedUrl(d.fetch.mock.calls[0])).toBe(DUAL_URL);
    const expectedAuth = `Basic ${Buffer.from(`${KEY_SID}:${KEY_SECRET}`).toString("base64")}`;
    expect(requestedAuth(d.fetch.mock.calls[0])).toBe(expectedAuth);
    expect(d.sleep).not.toHaveBeenCalled();

    expect(media.channels).toBe(2);
    expect(media.contentType).toBe("audio/x-wav");
    expect(Array.from(media.buffer)).toEqual(Array.from(WAV_BYTES));
  });

  it("reads the API key from the environment when no key is injected", async () => {
    const d = deps([wav()]);
    await fetchRecordingWav(RECORDING_SID, { fetch: d.fetch, sleep: d.sleep });
    expect(requestedUrl(d.fetch.mock.calls[0])).toBe(DUAL_URL);
    expect(requestedAuth(d.fetch.mock.calls[0])).toBe(
      `Basic ${Buffer.from(`${KEY_SID}:${KEY_SECRET}`).toString("base64")}`
    );
  });

  it("throws before any request when the API key is not configured", async () => {
    vi.stubEnv("TWILIO_API_KEY_SECRET", "");
    const d = deps([wav()]);
    await expect(
      fetchRecordingWav(RECORDING_SID, { fetch: d.fetch, sleep: d.sleep })
    ).rejects.toThrow(/TWILIO_API_KEY_SECRET/);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("succeeds after one backoff when a 404 is followed by a 200", async () => {
    const d = deps([status(404), wav()]);
    const media = await fetchRecordingWav(RECORDING_SID, d);

    expect(d.fetch).toHaveBeenCalledTimes(2);
    expect(requestedUrl(d.fetch.mock.calls[1])).toBe(DUAL_URL);
    expect(d.sleep).toHaveBeenCalledTimes(1);
    expect(d.sleep).toHaveBeenCalledWith(2000);
    expect(media.channels).toBe(2);
  });

  it("retries a 5xx with the same schedule", async () => {
    const d = deps([status(503), status(500), wav()]);
    await fetchRecordingWav(RECORDING_SID, d);
    expect(d.sleep.mock.calls.map((c) => c[0])).toEqual([2000, 5000]);
  });

  it("falls back to one single-channel request after four dual-channel 404s", async () => {
    const d = deps([status(404), status(404), status(404), status(404), wav()]);
    const media = await fetchRecordingWav(RECORDING_SID, d);

    expect(d.fetch).toHaveBeenCalledTimes(5);
    for (let i = 0; i < 4; i += 1) {
      expect(requestedUrl(d.fetch.mock.calls[i])).toBe(DUAL_URL);
    }
    expect(requestedUrl(d.fetch.mock.calls[4])).toBe(MONO_URL);
    expect(d.sleep.mock.calls.map((c) => c[0])).toEqual([
      2000, 5000, 15000, 60000,
    ]);
    expect(RETRY_DELAYS_MS).toEqual([2000, 5000, 15000, 60000]);
    expect(media.channels).toBe(1);
  });

  it("throws a typed error carrying the last status when every attempt fails", async () => {
    const d = deps([
      status(404),
      status(404),
      status(404),
      status(404),
      status(503),
    ]);
    const attempt = fetchRecordingWav(RECORDING_SID, d);
    await expect(attempt).rejects.toBeInstanceOf(RecordingFetchError);
    await attempt.catch((error: RecordingFetchError) => {
      expect(error.status).toBe(503);
      expect(error.recordingSid).toBe(RECORDING_SID);
      expect(error.attempts).toBe(5);
      expect(error.message).not.toContain(KEY_SECRET);
      expect(error.message).not.toContain("https://");
    });
    expect(d.fetch).toHaveBeenCalledTimes(5);
  });

  it("does not retry a 401 or 403 and never reveals credentials", async () => {
    for (const code of [401, 403]) {
      const d = deps([status(code)]);
      const attempt = fetchRecordingWav(RECORDING_SID, d);
      await expect(attempt).rejects.toBeInstanceOf(RecordingFetchError);
      await attempt.catch((error: RecordingFetchError) => {
        expect(error.status).toBe(code);
        expect(error.message).not.toContain(KEY_SECRET);
      });
      expect(d.fetch).toHaveBeenCalledTimes(1);
      expect(d.sleep).not.toHaveBeenCalled();
    }
  });

  it("treats a thrown network error as retryable", async () => {
    const d = deps([]);
    d.fetch.mockRejectedValueOnce(new Error("socket hang up"));
    d.fetch.mockResolvedValueOnce(wav());
    const media = await fetchRecordingWav(RECORDING_SID, d);
    expect(d.sleep).toHaveBeenCalledWith(2000);
    expect(media.channels).toBe(2);
  });
});
