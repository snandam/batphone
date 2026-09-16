/**
 * Call state rules
 *
 * Pure module: the status vocabulary for a call row, the allowed
 * transitions from the plan's state diagram, and the retryable, stale,
 * and stuck rules that the pipeline and the UI share.
 *
 * No Next.js or database imports; everything here is testable in
 * isolation and safe to import from the schema files.
 */

export const CALL_STATUSES = [
  "identifying",
  "abandoned",
  "not_found",
  "dialing",
  "busy",
  "no_answer",
  "dial_failed",
  "awaiting_recording",
  "no_recording",
  "transcribing",
  "transcription_failed",
  "transcribed",
  "emailing",
  "email_failed",
  "emailed",
] as const;

export type CallStatus = (typeof CALL_STATUSES)[number];

export const RESOLUTION_DECISIONS = ["match", "ambiguous", "none"] as const;
export type ResolutionDecision = (typeof RESOLUTION_DECISIONS)[number];

export const CALLER_RESPONSES = [
  "confirmed",
  "retried",
  "selected",
  "timeout",
  "hung_up",
] as const;
export type CallerResponse = (typeof CALLER_RESPONSES)[number];

export const RESOLUTION_INPUT_KINDS = ["speech", "digits"] as const;
export type ResolutionInputKind = (typeof RESOLUTION_INPUT_KINDS)[number];

export const RECORDING_STATUSES = ["completed", "absent"] as const;
export type RecordingStatus = (typeof RECORDING_STATUSES)[number];

/** One matcher candidate, stored in resolution_attempt.candidates in rank order. */
export type ResolutionCandidate = {
  contactId: string;
  name: string;
  score: number;
};

/**
 * Reduced transcript shape stored in call.transcript.
 *
 * Never holds word arrays or media URLs; utterances carry only what the
 * email and the call detail page render.
 */
export type TranscriptUtterance = {
  /** Twilio dual-channel index: 0 is the caller, 1 is the contact. */
  channel: number;
  /** Seconds from the start of the recording. */
  start: number;
  end: number;
  text: string;
  confidence: number;
};

export type StoredTranscript = {
  model: string;
  requestId: string;
  channelConfidence: number[];
  /** True when both channels carried the same text (a mixed recording). */
  identicalChannels: boolean;
  /** 1 when the media had to be fetched single-channel; absent means 2. */
  channels?: 1 | 2;
  /** True when no speech was detected at all. */
  empty?: boolean;
  utterances: TranscriptUtterance[];
};

/** Speakers can be labelled only from a dual-channel, non-mixed recording. */
export function speakersSeparated(transcript: StoredTranscript): boolean {
  return transcript.channels !== 1 && !transcript.identicalChannels;
}

const CALLER_CHANNEL = 0;

/**
 * True when the caller (channel 0) said anything at all. Stored on the row
 * at transcription time for diagnostics. Speech does not establish that
 * a voicemail message was left or saved.
 */
export function callerSpoke(transcript: StoredTranscript): boolean {
  return transcript.utterances.some(
    (u) => u.channel === CALLER_CHANNEL && u.text.trim().length > 0
  );
}

/**
 * Twilio's AnsweredBy values that mean a machine picked up: machine_start
 * (detection mode Enable) and the three machine_end_* values (mode
 * DetectMessageEnd). This cannot identify voicemail versus an automated
 * agent or IVR. human, fax, unknown, and a missing value are not.
 */
export function isAutomatedAnswer(
  answeredBy: string | null | undefined
): boolean {
  return typeof answeredBy === "string" && answeredBy.startsWith("machine");
}

/**
 * Allowed transitions, one entry per status, mirroring the diagram in the
 * plan. The self loop on identifying is the reprompt. The two backward
 * edges (transcription_failed -> transcribing, email_failed -> emailing)
 * are reached only through the retry action.
 */
export const ALLOWED_TRANSITIONS: Readonly<
  Record<CallStatus, ReadonlySet<CallStatus>>
> = {
  identifying: new Set(["abandoned", "identifying", "not_found", "dialing"]),
  abandoned: new Set(),
  not_found: new Set(),
  dialing: new Set([
    "busy",
    "no_answer",
    "dial_failed",
    "awaiting_recording",
    "no_recording",
    "transcribing",
  ]),
  busy: new Set(),
  no_answer: new Set(),
  dial_failed: new Set(),
  awaiting_recording: new Set(["no_recording", "transcribing"]),
  no_recording: new Set(["awaiting_recording"]),
  transcribing: new Set(["transcription_failed", "transcribed"]),
  transcription_failed: new Set(["transcribing"]),
  transcribed: new Set(["emailing"]),
  emailing: new Set(["email_failed", "emailed"]),
  email_failed: new Set(["emailing"]),
  emailed: new Set(),
};

export function canTransition(from: CallStatus, to: CallStatus): boolean {
  return ALLOWED_TRANSITIONS[from].has(to);
}

/** The subset of call columns the state rules read. */
export type StateRow = {
  status: CallStatus;
  claimedAt: Date | null;
  emailClaimedAt: Date | null;
  recordingDurationSec: number | null;
  inboundAt: Date;
  endedAt: Date | null;
  metadataEmailSentAt: Date | null;
};

const MINUTE_MS = 60_000;
const CLAIM_BASE_MS = 10 * MINUTE_MS;
/** A transcribing claim is allowed two seconds of work per recorded second. */
const TRANSCRIBE_PER_RECORDED_SEC_MS = 2_000;
const STUCK_AFTER_END_MS = 10 * MINUTE_MS;
const STUCK_AFTER_INBOUND_MS = 45 * MINUTE_MS;

function ageMs(at: Date | null, now: Date): number | null {
  return at ? now.getTime() - at.getTime() : null;
}

/**
 * A claim is stale when its holder has had more than the allowed time.
 * transcribing: ten minutes plus two seconds per recorded second.
 * emailing: ten minutes.
 * Other statuses hold no claim and are never stale.
 */
export function isStale(row: StateRow, now: Date): boolean {
  if (row.status === "transcribing") {
    const age = ageMs(row.claimedAt, now);
    if (age === null) return false;
    const allowance =
      CLAIM_BASE_MS +
      (row.recordingDurationSec ?? 0) * TRANSCRIBE_PER_RECORDED_SEC_MS;
    return age > allowance;
  }
  if (row.status === "emailing") {
    const age = ageMs(row.emailClaimedAt, now);
    return age !== null && age > CLAIM_BASE_MS;
  }
  return false;
}

/**
 * A stale emailing claim may have sent the message before the worker died.
 * It is never retried automatically and the UI retry warns about a duplicate.
 */
export function isPossiblySent(row: StateRow, now: Date): boolean {
  return row.status === "emailing" && isStale(row, now);
}

/**
 * Retryable: the two failure statuses, a stored transcript awaiting email,
 * or a stale claim.
 * The metadata email having been sent does not consume the retry; the
 * transcript can still be retried and emailed separately.
 */
export function isRetryable(row: StateRow, now: Date): boolean {
  if (
    row.status === "transcription_failed" ||
    row.status === "email_failed" ||
    row.status === "transcribed"
  ) {
    return true;
  }
  return isStale(row, now);
}

/**
 * Stuck: a dialing or awaiting_recording row whose call ended more than ten
 * minutes ago, or that has no end time and started more than 45 minutes ago.
 * A live twelve-minute call is never flagged.
 */
export function isStuck(row: StateRow, now: Date): boolean {
  if (row.status !== "dialing" && row.status !== "awaiting_recording") {
    return false;
  }
  const sinceEnd = ageMs(row.endedAt, now);
  if (sinceEnd !== null) return sinceEnd > STUCK_AFTER_END_MS;
  const sinceInbound = ageMs(row.inboundAt, now);
  return sinceInbound !== null && sinceInbound > STUCK_AFTER_INBOUND_MS;
}

const STATUS_BADGES: Readonly<Record<CallStatus, string>> = {
  identifying: "Finding contact",
  abandoned: "Hung up early",
  not_found: "Couldn't find a contact",
  dialing: "Dialing",
  busy: "Busy",
  no_answer: "No answer",
  dial_failed: "Call failed",
  awaiting_recording: "Waiting for recording",
  no_recording: "No recording",
  transcribing: "Transcribing",
  transcription_failed: "Transcription failed",
  transcribed: "Transcribed",
  emailing: "Sending email",
  email_failed: "Email failed",
  emailed: "Emailed",
};

export function statusBadge(status: CallStatus): string {
  return STATUS_BADGES[status];
}
