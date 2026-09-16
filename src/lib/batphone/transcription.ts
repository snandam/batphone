/**
 * Deepgram transcription and transcript reduction
 *
 * `transcribeBuffer` uploads recording bytes to Deepgram (never a URL, so
 * Twilio credentials stay in this process) and reduces the response to the
 * stored transcript shape. `mergeTranscript` and `transcriptToText` are
 * pure so the email templates and the call page can share them.
 *
 * Dual-channel recordings put the caller on channel 0 and the contact on
 * channel 1, so Deepgram `multichannel` with `utterances` gives speaker
 * labels for free and diarization is not used. When the recording is
 * single-channel the speakers cannot be separated: every utterance is on
 * channel 0, labels are null, and `channels: 1` marks the transcript so the
 * UI can say so.
 *
 * The SDK retries 408, 429, and 5xx itself (`maxRetries` on the client), so
 * this module adds no retry loop. Errors are wrapped in
 * `TranscriptionError` with `retryable` false for 400, 401, and 403 (the
 * request or the key is wrong) and true otherwise.
 *
 * SDK surface used (@deepgram/sdk 5.10.1, dist/cjs):
 *   new DeepgramClient({ apiKey, maxRetries, timeoutInSeconds })   BaseClient.d.ts
 *   client.listen.v1.media.transcribeFile(uploadable, request)     listen/resources/v1/resources/media/client/Client.d.ts
 *   MediaTranscribeRequestOctetStream option names                 .../media/client/requests/MediaTranscribeRequestOctetStream.d.ts
 *   ListenV1Response / ListenV1AcceptedResponse                    api/types/ListenV1Response.d.ts
 *   DeepgramError.statusCode                                       errors/DeepgramError.d.ts
 */

import {
  DeepgramClient,
  type ListenV1AcceptedResponse,
  type ListenV1Response,
  type ListenV1ResponseResultsUtterancesItem,
} from "@deepgram/sdk";

import { deepgramApiKey } from "./config";

import type { StoredTranscript, TranscriptUtterance } from "./state";

export type DeepgramResponse = ListenV1Response | ListenV1AcceptedResponse;

/** The one SDK call this module makes, narrowed so tests can pass a fake. */
export interface DeepgramTranscriber {
  transcribeFile(
    uploadable: Uint8Array,
    request: DeepgramRequestOptions
  ): Promise<DeepgramResponse>;
}

export interface DeepgramRequestOptions {
  model: "nova-3";
  multichannel: boolean;
  smart_format: boolean;
  utterances: boolean;
  paragraphs: boolean;
}

export const DEEPGRAM_REQUEST_OPTIONS: Omit<
  DeepgramRequestOptions,
  "multichannel"
> = {
  model: "nova-3",
  smart_format: true,
  utterances: true,
  paragraphs: true,
};

/** Retries and timeout applied to the real client. */
export const DEEPGRAM_MAX_RETRIES = 3;
export const DEEPGRAM_TIMEOUT_SECONDS = 300;

export const EMPTY_TRANSCRIPT_TEXT = "No speech was detected.";
export const CALLER_LABEL = "You";

export interface TranscriptionInput {
  /** Display name of the contact on channel 1. */
  contactName: string;
  /** Channels in the recording that was uploaded. */
  channels: 1 | 2;
}

/**
 * The stored transcript column. Extends `StoredTranscript` from state.ts
 * with the markers the renderers need: `channels` (1 means speakers could
 * not be separated), `contactName` (snapshot of the label for channel 1 at
 * transcription time, so the text is a pure function of this object), and
 * `empty` (no speech detected).
 */
export type MergedTranscript = StoredTranscript & {
  channels: 1 | 2;
  contactName: string;
  empty: boolean;
};

export interface TranscribeDeps {
  client?: DeepgramTranscriber;
  /** Defaults to `deepgramApiKey()` from the environment. */
  apiKey?: string;
}

export class TranscriptionError extends Error {
  readonly status: number | undefined;
  readonly retryable: boolean;

  constructor(message: string, status: number | undefined, cause: unknown) {
    super(message, { cause });
    this.name = "TranscriptionError";
    this.status = status;
    this.retryable = !(status === 400 || status === 401 || status === 403);
  }
}

/** Builds the real SDK client. Kept separate so tests never construct it. */
export function createDeepgramTranscriber(apiKey: string): DeepgramTranscriber {
  if (!apiKey) {
    throw new Error("Missing required environment variable: DEEPGRAM_API_KEY");
  }
  const client = new DeepgramClient({
    apiKey,
    maxRetries: DEEPGRAM_MAX_RETRIES,
    timeoutInSeconds: DEEPGRAM_TIMEOUT_SECONDS,
  });
  return {
    transcribeFile: (uploadable, request) =>
      client.listen.v1.media.transcribeFile(uploadable, request),
  };
}

function deepgramStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === "number" ? status : undefined;
}

function hasResults(response: DeepgramResponse): response is ListenV1Response {
  return (
    typeof (response as ListenV1Response).results === "object" &&
    (response as ListenV1Response).results !== null
  );
}

/**
 * Upload the recording bytes and return the reduced transcript. Throws
 * `TranscriptionError`; `retryable` tells the pipeline whether a retry
 * could help.
 */
export async function transcribeBuffer(
  buffer: Uint8Array,
  input: TranscriptionInput,
  deps: TranscribeDeps = {}
): Promise<MergedTranscript> {
  const client =
    deps.client ?? createDeepgramTranscriber(deps.apiKey ?? deepgramApiKey());

  let response: DeepgramResponse;
  try {
    response = await client.transcribeFile(buffer, {
      ...DEEPGRAM_REQUEST_OPTIONS,
      multichannel: input.channels === 2,
    });
  } catch (cause) {
    const status = deepgramStatus(cause);
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new TranscriptionError(
      status === undefined
        ? `Deepgram request failed: ${message}`
        : `Deepgram request failed with HTTP ${String(status)}: ${message}`,
      status,
      cause
    );
  }

  if (!hasResults(response)) {
    throw new TranscriptionError(
      "Deepgram returned no results (asynchronous accepted response)",
      undefined,
      undefined
    );
  }

  return mergeTranscript(response, input);
}

function modelName(metadata: ListenV1Response["metadata"]): string {
  const [uuid] = metadata.models ?? [];
  const info = uuid ? metadata.model_info?.[uuid] : undefined;
  const name =
    typeof info === "object" && info !== null
      ? (info as { name?: unknown }).name
      : undefined;
  return typeof name === "string" && name
    ? name
    : DEEPGRAM_REQUEST_OPTIONS.model;
}

function channelTexts(response: ListenV1Response): string[] {
  return response.results.channels.map(
    (channel) => channel.alternatives?.[0]?.transcript?.trim() ?? ""
  );
}

function reduceUtterance(
  utterance: ListenV1ResponseResultsUtterancesItem,
  channels: 1 | 2
): TranscriptUtterance | null {
  const text = utterance.transcript?.trim() ?? "";
  if (!text) return null;
  const channel = channels === 1 ? 0 : (utterance.channel ?? 0);
  return {
    channel,
    start: utterance.start ?? 0,
    end: utterance.end ?? utterance.start ?? 0,
    text,
    confidence: utterance.confidence ?? 0,
  };
}

/**
 * Pure reduction of a Deepgram response to the stored shape: utterances
 * from every channel ordered by start time, per-channel confidence, and
 * the identical-channels flag. Word arrays, paragraphs, and anything
 * resembling a URL are dropped.
 *
 * `identicalChannels` is true only when both channel texts are non-empty
 * and equal after trimming; two silent channels are reported through
 * `empty` instead.
 */
export function mergeTranscript(
  response: ListenV1Response,
  input: TranscriptionInput
): MergedTranscript {
  const texts = channelTexts(response);
  const utterances = (response.results.utterances ?? [])
    .map((utterance) => reduceUtterance(utterance, input.channels))
    .filter((utterance): utterance is TranscriptUtterance => utterance !== null)
    .sort((a, b) => a.start - b.start || a.channel - b.channel);

  const [callerText, contactText] = texts;
  const identicalChannels =
    input.channels === 2 &&
    typeof callerText === "string" &&
    callerText.length > 0 &&
    callerText === contactText;

  return {
    model: modelName(response.metadata),
    requestId: response.metadata.request_id,
    channelConfidence: response.results.channels.map(
      (channel) => channel.alternatives?.[0]?.confidence ?? 0
    ),
    identicalChannels,
    channels: input.channels,
    contactName: input.contactName,
    empty: utterances.length === 0,
    utterances,
  };
}

/** "You" for channel 0, the contact name for channel 1, null when unknown. */
export function utteranceLabel(
  transcript: Pick<MergedTranscript, "channels" | "contactName">,
  utterance: Pick<TranscriptUtterance, "channel">
): string | null {
  if (transcript.channels === 1) return null;
  return utterance.channel === 0 ? CALLER_LABEL : transcript.contactName;
}

/** One line per utterance, labelled where speakers are known. */
export function transcriptToText(transcript: MergedTranscript): string {
  if (transcript.empty || transcript.utterances.length === 0) {
    return EMPTY_TRANSCRIPT_TEXT;
  }
  return transcript.utterances
    .map((utterance) => {
      const label = utteranceLabel(transcript, utterance);
      return label === null ? utterance.text : `${label}: ${utterance.text}`;
    })
    .join("\n");
}
