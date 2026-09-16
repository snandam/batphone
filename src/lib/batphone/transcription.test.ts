import { describe, expect, it, vi } from "vitest";

import fixture from "@/test/fixtures/deepgram/multichannel.json";

import {
  DEEPGRAM_REQUEST_OPTIONS,
  EMPTY_TRANSCRIPT_TEXT,
  mergeTranscript,
  transcribeBuffer,
  TranscriptionError,
  transcriptToText,
  utteranceLabel,
  type DeepgramResponse,
  type DeepgramTranscriber,
} from "./transcription";

import type { ListenV1Response } from "@deepgram/sdk";

const CONTACT = "Mike Anderson";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function multichannel(): ListenV1Response {
  return clone(fixture) as ListenV1Response;
}

function alternative(response: ListenV1Response, channel: number) {
  const alt = response.results.channels[channel]?.alternatives?.[0];
  if (!alt) throw new Error(`fixture has no alternative on channel ${channel}`);
  return alt;
}

function firstChannel(response: ListenV1Response) {
  const channel = response.results.channels[0];
  if (!channel) throw new Error("fixture has no channel 0");
  return channel;
}

/** Collect every own property key reachable from a JSON value. */
function allKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, into);
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      into.add(key);
      allKeys(nested, into);
    }
  }
  return into;
}

describe("mergeTranscript", () => {
  it("interleaves both channels by start time with You and the contact name", () => {
    const merged = mergeTranscript(multichannel(), {
      contactName: CONTACT,
      channels: 2,
    });

    expect(merged.channels).toBe(2);
    expect(merged.empty).toBe(false);
    expect(merged.contactName).toBe(CONTACT);
    expect(merged.utterances.map((u) => u.channel)).toEqual([0, 1, 0, 1, 1, 0]);
    const starts = merged.utterances.map((u) => u.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(merged.utterances[0]).toEqual({
      channel: 0,
      start: 0.48,
      end: 2.72,
      text: "Hey Mike, it's Sanjeev. Do you have a minute?",
      confidence: 0.9931,
    });
    expect(merged.utterances.map((u) => utteranceLabel(merged, u))).toEqual([
      "You",
      CONTACT,
      "You",
      CONTACT,
      CONTACT,
      "You",
    ]);
  });

  it("reduces to the stored shape with no word arrays, URLs, or paragraphs", () => {
    const merged = mergeTranscript(multichannel(), {
      contactName: CONTACT,
      channels: 2,
    });

    expect(merged.model).toBe("general-nova-3");
    expect(merged.requestId).toBe("0f2d6f3e-2c5a-4d0b-9c1e-7a8b2f6e4c11");
    expect(merged.channelConfidence).toEqual([0.9927, 0.9884]);
    expect(merged.identicalChannels).toBe(false);

    const keys = allKeys(merged);
    expect(keys.has("words")).toBe(false);
    expect(keys.has("paragraphs")).toBe(false);
    expect(keys.has("sha256")).toBe(false);
    expect(JSON.stringify(merged)).not.toMatch(/https?:\/\//);
    expect(Object.keys(merged.utterances[0] ?? {}).sort()).toEqual([
      "channel",
      "confidence",
      "end",
      "start",
      "text",
    ]);
  });

  it("flags identical channel text so the UI can warn about a mono recording", () => {
    const response = multichannel();
    alternative(response, 1).transcript =
      ` ${alternative(response, 0).transcript}\n`;
    const merged = mergeTranscript(response, {
      contactName: CONTACT,
      channels: 2,
    });
    expect(merged.identicalChannels).toBe(true);
  });

  it("returns the empty marker instead of throwing when there is no speech", () => {
    const response = multichannel();
    response.results.utterances = [];
    for (const channel of [0, 1]) {
      alternative(response, channel).transcript = "";
      alternative(response, channel).words = [];
    }
    const merged = mergeTranscript(response, {
      contactName: CONTACT,
      channels: 2,
    });
    expect(merged.empty).toBe(true);
    expect(merged.utterances).toEqual([]);
    expect(merged.identicalChannels).toBe(false);
    expect(transcriptToText(merged)).toBe(EMPTY_TRANSCRIPT_TEXT);
    expect(EMPTY_TRANSCRIPT_TEXT).toBe("No speech was detected.");
  });

  it("labels nothing and marks channels 1 for a single-channel recording", () => {
    const response = multichannel();
    response.metadata.channels = 1;
    response.results.channels = [firstChannel(response)];
    response.results.utterances = (response.results.utterances ?? []).map(
      (u) => ({ ...u, channel: 0 })
    );
    const merged = mergeTranscript(response, {
      contactName: CONTACT,
      channels: 1,
    });
    expect(merged.channels).toBe(1);
    expect(merged.channelConfidence).toEqual([0.9927]);
    expect(merged.identicalChannels).toBe(false);
    expect(merged.utterances.every((u) => u.channel === 0)).toBe(true);
    expect(merged.utterances.map((u) => utteranceLabel(merged, u))).toEqual(
      merged.utterances.map(() => null)
    );
    expect(transcriptToText(merged).split("\n")[0]).toBe(
      "Hey Mike, it's Sanjeev. Do you have a minute?"
    );
  });
});

describe("transcriptToText", () => {
  it("renders one labelled line per utterance", () => {
    const merged = mergeTranscript(multichannel(), {
      contactName: CONTACT,
      channels: 2,
    });
    expect(transcriptToText(merged)).toBe(
      [
        "You: Hey Mike, it's Sanjeev. Do you have a minute?",
        "Mike Anderson: Sure. What's up?",
        "You: The Phoenix build is failing on the release branch again.",
        "Mike Anderson: Ugh.",
        "Mike Anderson: I'll take a look after lunch and ping you.",
        "You: Perfect. Thanks.",
      ].join("\n")
    );
  });
});

describe("transcribeBuffer", () => {
  function fakeClient(
    impl: (...args: unknown[]) => Promise<DeepgramResponse>
  ): DeepgramTranscriber & { transcribeFile: ReturnType<typeof vi.fn> } {
    return { transcribeFile: vi.fn(impl) };
  }

  it("sends the buffer with nova-3, multichannel, smart_format, utterances, and paragraphs", async () => {
    const client = fakeClient(async () => multichannel());
    const buffer = new Uint8Array([1, 2, 3]);
    const merged = await transcribeBuffer(
      buffer,
      { contactName: CONTACT, channels: 2 },
      { client }
    );

    expect(client.transcribeFile).toHaveBeenCalledTimes(1);
    const [sent, request] = client.transcribeFile.mock.calls[0] ?? [];
    expect(sent).toBe(buffer);
    expect(request).toEqual({
      model: "nova-3",
      multichannel: true,
      smart_format: true,
      utterances: true,
      paragraphs: true,
    });
    expect(DEEPGRAM_REQUEST_OPTIONS.model).toBe("nova-3");
    expect(merged.utterances).toHaveLength(6);
  });

  it("disables multichannel for a single-channel buffer", async () => {
    const response = multichannel();
    response.results.channels = [firstChannel(response)];
    const client = fakeClient(async () => response);
    await transcribeBuffer(
      new Uint8Array([1]),
      { contactName: CONTACT, channels: 1 },
      { client }
    );
    const [, request] = client.transcribeFile.mock.calls[0] ?? [];
    expect(request).toMatchObject({ multichannel: false });
  });

  it("rethrows a 401 immediately as non-retryable without a second call", async () => {
    const unauthorized = Object.assign(new Error("Unauthorized"), {
      statusCode: 401,
    });
    const client = fakeClient(async () => {
      throw unauthorized;
    });
    const attempt = transcribeBuffer(
      new Uint8Array([1]),
      { contactName: CONTACT, channels: 2 },
      { client }
    );
    await expect(attempt).rejects.toBeInstanceOf(TranscriptionError);
    await attempt.catch((error: TranscriptionError) => {
      expect(error.status).toBe(401);
      expect(error.retryable).toBe(false);
      expect(error.cause).toBe(unauthorized);
    });
    expect(client.transcribeFile).toHaveBeenCalledTimes(1);
  });

  it("propagates other Deepgram errors as retryable after the SDK's own retries", async () => {
    const client = fakeClient(async () => {
      throw Object.assign(new Error("Service Unavailable"), {
        statusCode: 503,
      });
    });
    const attempt = transcribeBuffer(
      new Uint8Array([1]),
      { contactName: CONTACT, channels: 2 },
      { client }
    );
    await expect(attempt).rejects.toBeInstanceOf(TranscriptionError);
    await attempt.catch((error: TranscriptionError) => {
      expect(error.status).toBe(503);
      expect(error.retryable).toBe(true);
    });
    expect(client.transcribeFile).toHaveBeenCalledTimes(1);
  });

  it("rejects an async accepted response that carries no results", async () => {
    const client = fakeClient(
      async () => ({ request_id: "abc" }) as unknown as DeepgramResponse
    );
    await expect(
      transcribeBuffer(
        new Uint8Array([1]),
        { contactName: CONTACT, channels: 2 },
        { client }
      )
    ).rejects.toThrow(/no results/i);
  });
});
