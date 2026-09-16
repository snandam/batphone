/**
 * Post-call pipeline: transcription, then the transcript email, with the
 * metadata-only email as the fallback (R12, R15, R16).
 *
 * Every step is: claim the step in one conditional update, do the network
 * work with no transaction held, then write the result guarded by the
 * claim token. A null claim means another request holds or finished the
 * step; a false completion means the claim was taken over (a manual retry
 * or a stale-claim takeover) and the step stops before it can send twice.
 *
 * `processRecording` claims transcribing only from awaiting_recording or
 * dialing. `retryCall` claims the same steps from transcription_failed,
 * email_failed, or a stale claim (R20), and `resyncCall` reconciles a row
 * stuck in dialing or awaiting_recording against the event log and the
 * Twilio REST API before resuming.
 *
 * Domain module: no Next.js imports. Everything with a side effect is
 * injectable through `PipelineDeps`.
 */

import type { Call } from "@/db/schema";
import { logger as appLogger } from "@/lib/logger";

import { callOutcome } from "./call-view";
import * as repo from "./calls-repo";
import { publicBaseUrl } from "./config";
import {
  renderMetadataOnlyEmail,
  renderTranscriptEmail,
  type CallEmailInput,
  type MetadataOnlyReason,
} from "./email-templates";
import {
  createMailer,
  type EmailKind,
  type Mailer,
  type SendResult,
} from "./mailer";
import { callerSpoke, isPossiblySent, isStale, isStuck } from "./state";
import {
  transcribeBuffer,
  transcriptToText,
  type MergedTranscript,
  type TranscriptionInput,
} from "./transcription";
import {
  fetchRecordingWav,
  twilioAccountUrl,
  twilioAuthorization,
  type RecordingMedia,
} from "./twilio-media";
import { callLogContext, type CallLogContext } from "./twilio-request";

import type { TwilioApiKey } from "./config";
import type { CallStatus, StoredTranscript } from "./state";

export type PipelineRepo = Pick<
  typeof repo,
  | "claim"
  | "complete"
  | "fail"
  | "getCallForPipeline"
  | "getCallById"
  | "listEventsForCall"
  | "writeDialOutcome"
  | "writeRecording"
  | "markRecordingAbsent"
>;

export type PipelineLogger = Pick<
  typeof appLogger,
  "info" | "warn" | "exception"
>;

export interface PipelineDeps {
  repo?: PipelineRepo;
  fetchRecording?: (recordingSid: string) => Promise<RecordingMedia>;
  transcribe?: (
    buffer: Uint8Array,
    input: TranscriptionInput
  ) => Promise<MergedTranscript>;
  mailer?: Mailer;
  now?: () => Date;
  logger?: PipelineLogger;
  /** Twilio REST reads used by resync; defaults to the API key from the environment. */
  twilio?: TwilioRest;
}

type ResolvedDeps = Required<PipelineDeps>;

function resolveDeps(deps: PipelineDeps): ResolvedDeps {
  return {
    repo: deps.repo ?? repo,
    fetchRecording:
      deps.fetchRecording ??
      ((recordingSid) => fetchRecordingWav(recordingSid)),
    transcribe:
      deps.transcribe ?? ((buffer, input) => transcribeBuffer(buffer, input)),
    mailer: deps.mailer ?? createMailer(),
    now: deps.now ?? (() => new Date()),
    logger: deps.logger ?? appLogger,
    twilio: deps.twilio ?? createTwilioRest(),
  };
}

export type TranscriptEmailResult =
  | "not_claimed"
  | "claim_lost"
  | "emailed"
  | "email_failed";

export type MetadataEmailResult =
  | "not_claimed"
  | "claim_lost"
  | "sent"
  | "failed";

export type ProcessRecordingResult =
  | "not_claimed"
  | "claim_lost"
  | "transcription_failed"
  | TranscriptEmailResult;

/** Statuses `processRecording` may claim from; failed states are the retry action's. */
export const PROCESS_RECORDING_FROM: readonly CallStatus[] = [
  "awaiting_recording",
  "dialing",
];
export const TRANSCRIPT_EMAIL_FROM: readonly CallStatus[] = ["transcribed"];
export const METADATA_EMAIL_FROM: readonly CallStatus[] = [
  "transcription_failed",
  "no_recording",
];

const UNKNOWN_CONTACT = "Unknown contact";

/** The call page in the app; the email never links to Twilio media. */
export function callPageUrl(callId: string): string {
  return `${publicBaseUrl()}/calls/${encodeURIComponent(callId)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The shape written to `call.transcript`: the merged transcript minus the contact name. */
function toStoredTranscript(merged: MergedTranscript): StoredTranscript {
  return {
    model: merged.model,
    requestId: merged.requestId,
    channelConfidence: merged.channelConfidence,
    identicalChannels: merged.identicalChannels,
    channels: merged.channels,
    empty: merged.empty,
    utterances: merged.utterances,
  };
}

/**
 * Header fields shared by both emails. Start time and duration come from
 * the recording, with the inbound time and dial duration as fallback.
 */
function emailInput(loaded: repo.PipelineCall): CallEmailInput {
  const { call, user } = loaded;
  return {
    callerName: user.name,
    contactName: call.contactNameSnapshot ?? UNKNOWN_CONTACT,
    destinationNumber: call.destinationNumberSnapshot ?? "",
    startedAt: call.recordingStartedAt ?? call.inboundAt,
    durationSec: call.recordingDurationSec ?? call.dialDurationSec,
    outcome: callOutcome(call).label,
    timeZone: user.timezone,
    callPageUrl: callPageUrl(call.id),
  };
}

async function deliver(
  mailer: Mailer,
  message: Parameters<Mailer["send"]>[0]
): Promise<SendResult> {
  try {
    return await mailer.send(message);
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

function stepContext(
  row: Pick<Call, "id" | "twilioCallSid" | "status">,
  step: string,
  attempt: number
): CallLogContext & { step: string } {
  return { ...callLogContext(row, attempt), step };
}

/**
 * Transcribe a stored recording and send the transcript email.
 *
 * Scheduled by the recording callback after it responds. Safe to invoke
 * any number of times for the same call: only the invocation that wins the
 * transcribing claim does any work.
 */
export function processRecording(
  callId: string,
  deps: PipelineDeps = {}
): Promise<ProcessRecordingResult> {
  return runTranscription(callId, PROCESS_RECORDING_FROM, deps);
}

/**
 * The transcribing step with its claim statuses as a parameter: the
 * pipeline claims from the post-dial states, the retry action from the
 * failed or stale one. Everything after the claim is identical.
 */
async function runTranscription(
  callId: string,
  fromStatuses: readonly CallStatus[],
  deps: PipelineDeps
): Promise<ProcessRecordingResult> {
  const d = resolveDeps(deps);
  const row = await d.repo.claim(callId, {
    step: "transcribing",
    fromStatuses: [...fromStatuses],
  });
  if (!row || !row.claimToken) {
    d.logger.info("transcribe_claim_skipped", { call_id: callId });
    return "not_claimed";
  }
  const token = row.claimToken;
  const context = stepContext(row, "transcribing", row.transcribeAttempts);
  d.logger.info("transcribe_claimed", context);

  let merged: MergedTranscript;
  try {
    if (!row.recordingSid) {
      throw new Error("call has no recording SID to transcribe");
    }
    const media = await d.fetchRecording(row.recordingSid);
    merged = await d.transcribe(media.buffer, {
      contactName: row.contactNameSnapshot ?? UNKNOWN_CONTACT,
      channels: media.channels,
    });
  } catch (error) {
    const lastError = errorMessage(error);
    d.logger.exception("transcribe_failed", error, context);
    const written = await d.repo.fail(callId, token, {
      status: "transcription_failed",
      lastError,
    });
    if (!written) {
      d.logger.warn("claim_lost", context);
      return "claim_lost";
    }
    await sendMetadataOnlyEmail(callId, "transcription_failed", deps);
    return "transcription_failed";
  }

  const stored = toStoredTranscript(merged);
  const written = await d.repo.complete(callId, token, {
    status: "transcribed",
    transcript: stored,
    transcriptText: transcriptToText(merged),
    recordingStatus: "completed",
    callerSpoke: callerSpoke(stored),
  });
  if (!written) {
    d.logger.warn("claim_lost", context);
    return "claim_lost";
  }
  d.logger.info("transcribed", {
    ...context,
    utterances: merged.utterances.length,
    channels: merged.channels,
    empty: merged.empty,
  });

  return sendTranscriptEmail(callId, deps);
}

/**
 * Send the full transcript email once (R14). Claims emailing from
 * transcribed while `transcript_email_sent_at` is null, so a retry after a
 * metadata-only email still ends with exactly one transcript email.
 */
export async function sendTranscriptEmail(
  callId: string,
  deps: PipelineDeps = {},
  fromStatuses: readonly CallStatus[] = TRANSCRIPT_EMAIL_FROM
): Promise<TranscriptEmailResult> {
  const d = resolveDeps(deps);
  const row = await d.repo.claim(callId, {
    step: "emailing",
    fromStatuses: [...fromStatuses],
  });
  if (!row || !row.claimToken) {
    d.logger.info("transcript_email_claim_skipped", { call_id: callId });
    return "not_claimed";
  }
  const token = row.claimToken;
  const context = stepContext(row, "emailing", row.emailAttempts);
  d.logger.info("transcript_email_claimed", context);

  const loaded = await d.repo.getCallForPipeline(callId);
  const transcript = loaded?.call.transcript;
  const result: SendResult =
    loaded && transcript
      ? await deliver(d.mailer, {
          ...renderTranscriptEmail({
            ...emailInput(loaded),
            transcript,
            answeredBy: loaded.call.answeredBy,
          }),
          to: loaded.user.email,
          callId,
          kind: "transcript" satisfies EmailKind,
        })
      : { ok: false, error: "call row or transcript missing at send time" };

  if (!result.ok) {
    d.logger.warn("transcript_email_failed", {
      ...context,
      error_message: result.error,
    });
    const written = await d.repo.fail(callId, token, {
      status: "email_failed",
      lastEmailError: result.error,
    });
    if (!written) d.logger.warn("claim_lost", context);
    return written ? "email_failed" : "claim_lost";
  }

  const written = await d.repo.complete(callId, token, {
    status: "emailed",
    transcriptEmailSentAt: d.now(),
    emailMessageId: result.messageId,
    emailedTo: loaded?.user.email ?? null,
  });
  if (!written) {
    d.logger.warn("claim_lost", { ...context, message_id: result.messageId });
    return "claim_lost";
  }
  d.logger.info("transcript_email_sent", {
    ...context,
    message_id: result.messageId,
  });
  return "emailed";
}

/**
 * Send the metadata-only email once (R15) after a transcription failure or
 * an absent recording. The claim requires `metadata_email_sent_at` null
 * and never changes the status, so the transcript can still be retried.
 */
export async function sendMetadataOnlyEmail(
  callId: string,
  reason: MetadataOnlyReason,
  deps: PipelineDeps = {}
): Promise<MetadataEmailResult> {
  const d = resolveDeps(deps);
  const row = await d.repo.claim(callId, {
    step: "metadata_email",
    fromStatuses: [...METADATA_EMAIL_FROM],
  });
  if (!row || !row.claimToken) {
    d.logger.info("metadata_email_claim_skipped", { call_id: callId, reason });
    return "not_claimed";
  }
  const token = row.claimToken;
  const context = {
    ...stepContext(row, "metadata_email", row.emailAttempts),
    reason,
  };
  d.logger.info("metadata_email_claimed", context);

  const loaded = await d.repo.getCallForPipeline(callId);
  const result: SendResult = loaded
    ? await deliver(d.mailer, {
        ...renderMetadataOnlyEmail({
          ...emailInput(loaded),
          reason,
        }),
        to: loaded.user.email,
        callId,
        kind: "metadata_only" satisfies EmailKind,
      })
    : { ok: false, error: "call row missing at send time" };

  if (!result.ok) {
    d.logger.warn("metadata_email_failed", {
      ...context,
      error_message: result.error,
    });
    const written = await d.repo.fail(callId, token, {
      lastEmailError: result.error,
    });
    if (!written) d.logger.warn("claim_lost", context);
    return written ? "failed" : "claim_lost";
  }

  const written = await d.repo.complete(callId, token, {
    metadataEmailSentAt: d.now(),
    emailMessageId: result.messageId,
    emailedTo: loaded?.user.email ?? null,
  });
  if (!written) {
    d.logger.warn("claim_lost", { ...context, message_id: result.messageId });
    return "claim_lost";
  }
  d.logger.info("metadata_email_sent", {
    ...context,
    message_id: result.messageId,
  });
  return "sent";
}

// ---------------------------------------------------------------------------
// Retry (R20)
// ---------------------------------------------------------------------------

export type RetryCallResult =
  | "not_found"
  | "nothing_to_retry"
  | "confirm_required"
  | ProcessRecordingResult;

export interface RetryCallOptions {
  /**
   * The user has seen the duplicate warning for a stale emailing claim
   * and still wants the email resent.
   */
  confirmDuplicate?: boolean;
}

/**
 * Re-run the failed or stale step under a new claim token. Ownership is
 * the caller's job (the server action checks it before calling here).
 *
 * transcription_failed, or transcribing with a stale claim: claim
 * transcribing from that status and run transcription plus the email.
 * email_failed or transcribed: claim emailing and send the transcript email.
 * The latter resumes a process that stopped between persisting the transcript
 * and claiming its email.
 * emailing with a stale claim: the message may already have gone out, so
 * the retry is refused until `confirmDuplicate` is set.
 * Anything else has nothing to retry.
 */
export async function retryCall(
  callId: string,
  options: RetryCallOptions = {},
  deps: PipelineDeps = {}
): Promise<RetryCallResult> {
  const d = resolveDeps(deps);
  const row = await d.repo.getCallById(callId);
  if (!row) return "not_found";
  const now = d.now();
  const context = { ...callLogContext(row), action: "retry" };

  if (
    row.status === "transcription_failed" ||
    (row.status === "transcribing" && isStale(row, now))
  ) {
    d.logger.info("retry_transcription", context);
    return runTranscription(callId, [row.status], deps);
  }

  if (row.status === "email_failed" || row.status === "transcribed") {
    d.logger.info("retry_email", context);
    return sendTranscriptEmail(callId, deps, [row.status]);
  }

  if (isPossiblySent(row, now)) {
    if (!options.confirmDuplicate) {
      d.logger.info("retry_confirm_required", context);
      return "confirm_required";
    }
    d.logger.warn("retry_email_possibly_sent", context);
    return sendTranscriptEmail(callId, deps, [row.status]);
  }

  d.logger.info("retry_nothing_to_do", context);
  return "nothing_to_retry";
}

// ---------------------------------------------------------------------------
// Resync (R20): reconcile a stuck row against Twilio
// ---------------------------------------------------------------------------

/** The fields read from a Twilio Call resource. */
export interface TwilioCallResource {
  sid: string;
  /** queued, ringing, in-progress, completed, busy, failed, no-answer, canceled. */
  status: string;
  /** Seconds as a string, null while in progress. */
  duration: string | null;
  /** RFC 2822. */
  end_time: string | null;
  parent_call_sid: string | null;
}

/** The fields read from a Twilio Recording resource. */
export interface TwilioRecordingResource {
  sid: string;
  /** processing, completed, absent, deleted. */
  status: string;
  duration: string | null;
  start_time: string | null;
  call_sid: string;
}

export interface TwilioRest {
  /** Null when Twilio answers 404. */
  getCall(callSid: string): Promise<TwilioCallResource | null>;
  /** The outbound legs Dial created under an inbound call. */
  listChildCalls(parentCallSid: string): Promise<TwilioCallResource[]>;
  listRecordings(callSid: string): Promise<TwilioRecordingResource[]>;
}

export interface TwilioRestDeps {
  fetch?: typeof fetch;
  apiKey?: TwilioApiKey;
}

/**
 * Minimal Twilio REST reader authenticated with the API key. Errors carry
 * the status and the resource kind only, never the URL or credentials.
 */
export function createTwilioRest(deps: TwilioRestDeps = {}): TwilioRest {
  const fetchFn = deps.fetch ?? globalThis.fetch;

  async function getJson(
    resourcePath: string,
    kind: string
  ): Promise<unknown | null> {
    const response = await fetchFn(
      twilioAccountUrl(resourcePath, deps.apiKey),
      {
        method: "GET",
        headers: {
          Authorization: twilioAuthorization(deps.apiKey),
          Accept: "application/json",
        },
      }
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(
        `Twilio ${kind} read failed: HTTP ${String(response.status)}`
      );
    }
    return response.json();
  }

  return {
    async getCall(callSid) {
      const payload = await getJson(
        `Calls/${encodeURIComponent(callSid)}.json`,
        "call"
      );
      return (payload as TwilioCallResource | null) ?? null;
    },
    async listChildCalls(parentCallSid) {
      const payload = (await getJson(
        `Calls.json?ParentCallSid=${encodeURIComponent(parentCallSid)}`,
        "child calls"
      )) as { calls?: TwilioCallResource[] } | null;
      return payload?.calls ?? [];
    },
    async listRecordings(callSid) {
      const payload = (await getJson(
        `Calls/${encodeURIComponent(callSid)}/Recordings.json`,
        "recordings"
      )) as { recordings?: TwilioRecordingResource[] } | null;
      return payload?.recordings ?? [];
    },
  };
}

export type ResyncCallResult =
  | "not_found"
  | "not_stuck"
  /** A recording was stored (or already known) and the pipeline resumed. */
  | "resumed"
  /** The child call ended busy, unanswered, failed, or cancelled. */
  | "dial_outcome"
  /** The call connected but Twilio has no completed recording. */
  | "no_recording"
  /** Twilio is still preparing the recording; keep the row recoverable. */
  | "recording_pending";

const CHILD_STATUS_OUTCOME: Readonly<Record<string, repo.DialOutcome>> = {
  busy: "busy",
  "no-answer": "no-answer",
  failed: "failed",
  canceled: "canceled",
  completed: "completed",
};

/** RFC 2822 from Twilio; null when absent or unparseable. */
function parseTwilioDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseTwilioSeconds(value: string | null | undefined): number | null {
  if (value === null || value === undefined || !/^\d+$/.test(value)) {
    return null;
  }
  return Number(value);
}

/** The most recent value of one field across the logged webhooks, if any. */
function latestEventField(
  events: readonly { payload: Record<string, string> }[],
  field: string
): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const value = events[i]?.payload[field];
    if (value) return value;
  }
  return null;
}

/**
 * Reconcile a row stuck in dialing or awaiting_recording (R20).
 *
 * Reads the event log for the call SID, then asks Twilio for the parent
 * call, the child call (by the stored dial SID, the logged one, or the
 * parent filter), and the recordings. Applies the same guarded writes the
 * webhook handlers use, so a callback that arrives late still updates
 * zero rows, and then resumes the pipeline, records the dial outcome, or
 * marks the recording absent and sends the metadata email.
 *
 * Refuses rows that are not stuck, so a live call is never touched.
 */
export async function resyncCall(
  callId: string,
  deps: PipelineDeps = {}
): Promise<ResyncCallResult> {
  const d = resolveDeps(deps);
  const row = await d.repo.getCallById(callId);
  if (!row) return "not_found";
  const now = d.now();
  const context = { ...callLogContext(row), action: "resync" };
  if (!isStuck(row, now)) {
    d.logger.info("resync_not_stuck", context);
    return "not_stuck";
  }

  const events = await d.repo.listEventsForCall(row.twilioCallSid);
  d.logger.info("resync_events", {
    ...context,
    event_kinds: events.map((e) => e.eventKind).join(","),
  });

  const parent = await d.twilio.getCall(row.twilioCallSid);
  const knownChildSid =
    row.dialCallSid ?? latestEventField(events, "DialCallSid");
  const child = knownChildSid
    ? await d.twilio.getCall(knownChildSid)
    : ((await d.twilio.listChildCalls(row.twilioCallSid))[0] ?? null);

  let recordings = await d.twilio.listRecordings(row.twilioCallSid);
  if (recordings.length === 0 && child) {
    recordings = await d.twilio.listRecordings(child.sid);
  }
  const recording = recordings.find((r) => r.status === "completed") ?? null;

  d.logger.info("resync_twilio", {
    ...context,
    parent_status: parent?.status ?? null,
    child_sid: child?.sid ?? null,
    child_status: child?.status ?? null,
    recording_sid: recording?.sid ?? null,
    recording_count: recordings.length,
  });

  if (recording) {
    const stored = await d.repo.writeRecording(callId, {
      recordingSid: recording.sid,
      startedAt: parseTwilioDate(recording.start_time),
      durationSec: parseTwilioSeconds(recording.duration),
    });
    d.logger.info("resync_recording", {
      ...context,
      recording_sid: recording.sid,
      result: stored,
    });
  }

  if (row.status === "dialing") {
    const outcome: repo.DialOutcome =
      (child && CHILD_STATUS_OUTCOME[child.status]) ??
      (recording ? "completed" : "failed");
    const written = await d.repo.writeDialOutcome(callId, {
      dialCallSid: child?.sid ?? knownChildSid,
      dialDurationSec: parseTwilioSeconds(child?.duration),
      endedAt:
        parseTwilioDate(parent?.end_time) ??
        parseTwilioDate(child?.end_time) ??
        row.endedAt ??
        now,
      outcome,
    });
    d.logger.info("resync_dial_outcome", {
      ...context,
      outcome,
      transitioned: written?.transitioned ?? false,
      new_status: written?.row.status ?? null,
    });
    if (outcome !== "completed") return "dial_outcome";
  }

  if (recording) {
    await processRecording(callId, deps);
    return "resumed";
  }

  if (
    recordings.some(
      (r) =>
        r.status === "processing" ||
        r.status === "in-progress" ||
        r.status === "paused"
    )
  ) {
    d.logger.info("resync_recording_pending", context);
    return "recording_pending";
  }

  const absent = await d.repo.markRecordingAbsent(callId);
  d.logger.info("resync_recording_absent", {
    ...context,
    transitioned: absent?.transitioned ?? false,
  });
  if (absent?.transitioned) {
    await sendMetadataOnlyEmail(callId, "no_recording", deps);
  }
  return "no_recording";
}
