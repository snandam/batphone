/**
 * Call repository
 *
 * Every database access the Twilio webhook handlers need, kept in one
 * module so route tests can mock it as a unit. Functions are small and
 * single-purpose; state transitions are single conditional updates so a
 * duplicate callback updates zero rows instead of double-acting.
 */

import { and, asc, eq, inArray, isNull, isNotNull, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  call,
  contact,
  resolutionAttempt,
  twilioEvent,
  user,
  userProfile,
  type Call,
  type NewResolutionAttempt,
  type NewTwilioEvent,
  type TwilioEvent,
} from "@/db/schema";

import type { CallerResponse, CallStatus } from "./state";

export interface CallerUser {
  userId: string;
  timezone: string;
  email: string;
  /** First name explicitly entered during onboarding. */
  firstName: string;
}

/** The user whose verified number equals the caller ID, or null. */
export async function findUserByPhone(
  e164: string
): Promise<CallerUser | null> {
  const rows = await db
    .select({
      userId: userProfile.userId,
      timezone: userProfile.timezone,
      email: user.email,
      firstName: userProfile.firstName,
    })
    .from(userProfile)
    .innerJoin(user, eq(user.id, userProfile.userId))
    .where(
      and(
        eq(userProfile.phoneNumber, e164),
        isNotNull(userProfile.phoneVerifiedAt),
        sql`length(trim(${userProfile.firstName})) > 0`,
        sql`length(trim(${userProfile.lastName})) > 0`
      )
    )
    .limit(1);
  const row = rows[0];
  return row?.firstName ? { ...row, firstName: row.firstName } : null;
}

export interface ContactForCall {
  id: string;
  name: string;
  /** E.164. */
  phone: string;
  speedDial: number;
}

/** The user's contacts in speed-dial order. */
export async function listContactsForUser(
  userId: string
): Promise<ContactForCall[]> {
  return db
    .select({
      id: contact.id,
      name: contact.name,
      phone: contact.phone,
      speedDial: contact.speedDial,
    })
    .from(contact)
    .where(eq(contact.userId, userId))
    .orderBy(asc(contact.speedDial));
}

export interface NewIdentifyingCall {
  userId: string;
  twilioCallSid: string;
  /** Caller ID snapshot, E.164. */
  fromNumber: string;
  inboundAt: Date;
}

/**
 * Open a call in `identifying`. A re-delivered inbound webhook hits the
 * unique call SID and inserts nothing; the row is then re-read by SID so
 * both deliveries return the same row.
 */
export async function insertCallIdentifying(
  values: NewIdentifyingCall
): Promise<Call> {
  await db
    .insert(call)
    .values({ ...values, status: "identifying" })
    .onConflictDoNothing({ target: call.twilioCallSid });
  const row = await getCallBySid(values.twilioCallSid);
  if (!row) {
    throw new Error("call row missing after insert");
  }
  return row;
}

export async function getCallById(id: string): Promise<Call | null> {
  const rows = await db.select().from(call).where(eq(call.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getCallBySid(callSid: string): Promise<Call | null> {
  const rows = await db
    .select()
    .from(call)
    .where(eq(call.twilioCallSid, callSid))
    .limit(1);
  return rows[0] ?? null;
}

/** Append one verified webhook to the event log. */
export async function insertEvent(values: NewTwilioEvent): Promise<void> {
  await db.insert(twilioEvent).values(values);
}

/** Every logged webhook for a call SID, oldest first; read by resync. */
export async function listEventsForCall(
  callSid: string
): Promise<TwilioEvent[]> {
  return db
    .select()
    .from(twilioEvent)
    .where(eq(twilioEvent.callSid, callSid))
    .orderBy(asc(twilioEvent.receivedAt));
}

/**
 * identifying -> abandoned in one conditional update (R11). Returns true
 * when this call performed the transition; false when the row was in any
 * other state, including already abandoned.
 */
export async function markAbandonedIfIdentifying(
  callSid: string,
  endedAt: Date
): Promise<boolean> {
  const rows = await db
    .update(call)
    .set({ status: "abandoned", endedAt, updatedAt: new Date() })
    .where(and(eq(call.twilioCallSid, callSid), eq(call.status, "identifying")))
    .returning({ id: call.id });
  return rows.length > 0;
}

/** Record when the inbound leg ended; the first callback to arrive wins. */
export async function setEndedAt(
  callSid: string,
  endedAt: Date
): Promise<boolean> {
  const rows = await db
    .update(call)
    .set({ endedAt, updatedAt: new Date() })
    .where(and(eq(call.twilioCallSid, callSid), isNull(call.endedAt)))
    .returning({ id: call.id });
  return rows.length > 0;
}

/**
 * Close every resolution attempt still waiting for the caller's response
 * as hung_up (R26). Returns the number of attempts closed.
 */
export async function markOpenAttemptsHungUp(callId: string): Promise<number> {
  const rows = await db
    .update(resolutionAttempt)
    .set({ callerResponse: "hung_up", respondedAt: new Date() })
    .where(
      and(
        eq(resolutionAttempt.callId, callId),
        isNull(resolutionAttempt.callerResponse)
      )
    )
    .returning({ id: resolutionAttempt.id });
  return rows.length;
}

/**
 * Store one name-resolution attempt (R26) before the prompt is returned.
 * Returns the new row's id so it can travel in the confirm URL.
 */
export async function insertResolutionAttempt(
  values: NewResolutionAttempt
): Promise<string> {
  const rows = await db
    .insert(resolutionAttempt)
    .values(values)
    .returning({ id: resolutionAttempt.id });
  const row = rows[0];
  if (!row) {
    throw new Error("resolution attempt insert returned no row");
  }
  return row.id;
}

export interface AttemptResponse {
  /** The call the attempt must belong to; a foreign id updates nothing. */
  callId: string;
  callerResponse: CallerResponse;
  /** 1-based option the caller picked in selection mode. */
  selectedPosition?: number;
}

/**
 * Record what the caller did after a prompt. Only the first response is
 * kept: a re-delivered confirm callback updates zero rows. Returns true
 * when this call wrote the response.
 */
export async function updateResolutionAttemptResponse(
  id: string,
  response: AttemptResponse
): Promise<boolean> {
  const rows = await db
    .update(resolutionAttempt)
    .set({
      callerResponse: response.callerResponse,
      selectedPosition: response.selectedPosition ?? null,
      respondedAt: new Date(),
    })
    .where(
      and(
        eq(resolutionAttempt.id, id),
        eq(resolutionAttempt.callId, response.callId),
        isNull(resolutionAttempt.callerResponse)
      )
    )
    .returning({ id: resolutionAttempt.id });
  return rows.length > 0;
}

/**
 * identifying -> not_found after the third failed attempt (R8). Returns
 * true when this call performed the transition.
 */
export async function markNotFound(callId: string): Promise<boolean> {
  const rows = await db
    .update(call)
    .set({ status: "not_found", updatedAt: new Date() })
    .where(and(eq(call.id, callId), eq(call.status, "identifying")))
    .returning({ id: call.id });
  return rows.length > 0;
}

export interface DialingClaim {
  contactId: string;
  contactName: string;
  /** E.164. */
  destinationNumber: string;
}

/**
 * identifying -> dialing in one conditional update that also snapshots
 * the contact, takes a fresh claim from database time, and clears the
 * last error. Returns the updated row, or null when the row was no longer
 * identifying: a duplicate confirmation must not emit a second Dial (R16).
 */
export async function claimDialing(
  callId: string,
  claim: DialingClaim
): Promise<Call | null> {
  const rows = await db
    .update(call)
    .set({
      status: "dialing",
      contactId: claim.contactId,
      contactNameSnapshot: claim.contactName,
      destinationNumberSnapshot: claim.destinationNumber,
      claimToken: crypto.randomUUID(),
      claimedAt: sql`now()`,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(and(eq(call.id, callId), eq(call.status, "identifying")))
    .returning();
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Dial outcome, recording, and pipeline claims (U8)
// ---------------------------------------------------------------------------

/** Twilio's DialCallStatus values the dial action handler forwards. */
export type DialOutcome =
  "busy" | "no-answer" | "failed" | "canceled" | "completed";

export interface DialOutcomeInput {
  dialCallSid: string | null;
  dialDurationSec: number | null;
  endedAt: Date;
  outcome: DialOutcome;
}

export interface GuardedTransition {
  /** The row after the write. */
  row: Call;
  /** True when this call moved the status; false when only fields were written. */
  transitioned: boolean;
}

const TERMINAL_DIAL_STATUS: Record<
  Exclude<DialOutcome, "completed">,
  CallStatus
> = {
  busy: "busy",
  "no-answer": "no_answer",
  failed: "dial_failed",
  canceled: "dial_failed",
};

/**
 * Store the dial outcome (R10). One guarded update from dialing: busy,
 * no-answer, failed, and canceled become their terminal status; completed
 * becomes no_recording when the recording callback already reported
 * absent, otherwise awaiting_recording. The choice is made inside the
 * statement so an absent callback racing this write cannot be missed.
 *
 * When the row is no longer dialing (the recording arrived first and the
 * pipeline claimed it, AE6) only the dial fields are written and the
 * pipeline status is left alone. Returns null when the row does not exist.
 */
export async function writeDialOutcome(
  callId: string,
  input: DialOutcomeInput
): Promise<GuardedTransition | null> {
  const dialFields = {
    dialCallSid: input.dialCallSid,
    dialDurationSec: input.dialDurationSec,
    endedAt: input.endedAt,
    updatedAt: new Date(),
  };
  const status =
    input.outcome === "completed"
      ? sql<CallStatus>`(case when ${call.recordingStatus} = ${"absent"} then ${"no_recording"} else ${"awaiting_recording"} end)`
      : TERMINAL_DIAL_STATUS[input.outcome];

  const transitioned = await db
    .update(call)
    .set({ ...dialFields, status })
    .where(and(eq(call.id, callId), eq(call.status, "dialing")))
    .returning();
  if (transitioned[0]) return { row: transitioned[0], transitioned: true };

  const fieldsOnly = await db
    .update(call)
    .set(dialFields)
    .where(eq(call.id, callId))
    .returning();
  return fieldsOnly[0] ? { row: fieldsOnly[0], transitioned: false } : null;
}

export interface AnsweredByInput {
  /** Raw Twilio AnsweredBy value. */
  answeredBy: string;
  machineDetectionDurationMs: number | null;
}

/**
 * Store the answering machine detection result. Never touches the status:
 * the verdict arrives while the leg is live and the dial action owns the
 * transition. Idempotent, a re-delivered callback rewrites the same values.
 * Returns the row, or null when it does not exist.
 */
export async function writeAnsweredBy(
  callId: string,
  input: AnsweredByInput
): Promise<Call | null> {
  const rows = await db
    .update(call)
    .set({
      answeredBy: input.answeredBy,
      machineDetectionDurationMs: input.machineDetectionDurationMs,
      updatedAt: new Date(),
    })
    .where(eq(call.id, callId))
    .returning();
  return rows[0] ?? null;
}

export interface RecordingInput {
  recordingSid: string;
  startedAt: Date | null;
  durationSec: number | null;
}

export type WriteRecordingResult = "stored" | "duplicate" | "different_sid";

/**
 * Persist the recording reference once (R16). The write is guarded by
 * `recording_sid IS NULL`; when it matches nothing the row is read back to
 * tell a re-delivered callback (same SID, harmless) from a conflicting one
 * (different SID, kept only in the event log, never overwritten). A late
 * recording atomically reopens no_recording so the pipeline can run.
 */
export async function writeRecording(
  callId: string,
  input: RecordingInput
): Promise<WriteRecordingResult> {
  const rows = await db
    .update(call)
    .set({
      status: sql<CallStatus>`case when ${call.status} = ${"no_recording"} then ${"awaiting_recording"} else ${call.status} end`,
      recordingSid: input.recordingSid,
      recordingStatus: "completed",
      recordingStartedAt: input.startedAt,
      recordingDurationSec: input.durationSec,
      updatedAt: new Date(),
    })
    .where(and(eq(call.id, callId), isNull(call.recordingSid)))
    .returning({ id: call.id });
  if (rows.length > 0) return "stored";

  const existing = await getCallById(callId);
  return existing?.recordingSid === input.recordingSid
    ? "duplicate"
    : "different_sid";
}

/**
 * The recording callback reported absent. awaiting_recording moves to
 * no_recording; any other status (dialing, busy, a pipeline state) only
 * gets `recording_status` set, and for dialing the dial action decides.
 */
export async function markRecordingAbsent(
  callId: string
): Promise<GuardedTransition | null> {
  const transitioned = await db
    .update(call)
    .set({
      recordingStatus: "absent",
      status: "no_recording",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(call.id, callId),
        eq(call.status, "awaiting_recording"),
        isNull(call.recordingSid)
      )
    )
    .returning();
  if (transitioned[0]) return { row: transitioned[0], transitioned: true };

  const fieldsOnly = await db
    .update(call)
    .set({ recordingStatus: "absent", updatedAt: new Date() })
    .where(and(eq(call.id, callId), isNull(call.recordingSid)))
    .returning();
  const row = fieldsOnly[0] ?? (await getCallById(callId));
  return row ? { row, transitioned: false } : null;
}

export type ClaimStep = "transcribing" | "emailing" | "metadata_email";

export interface ClaimOptions {
  step: ClaimStep;
  /** Statuses the row must currently be in. */
  fromStatuses: readonly CallStatus[];
}

/**
 * Take a pipeline step in one conditional update. The guard is
 * `status IN fromStatuses` plus, for the email steps, that the email of
 * that kind has not been sent. The write takes a fresh claim token and
 * database time, increments the step's attempt counter, and clears the
 * step's last error. `metadata_email` never changes the status.
 *
 * Returns the row with its new token, or null when another request holds
 * the step (R16). Callers pass the token to `complete` and `fail`.
 */
export async function claim(
  callId: string,
  options: ClaimOptions
): Promise<Call | null> {
  const claimToken = crypto.randomUUID();
  const updatedAt = new Date();
  const inFrom = inArray(call.status, [...options.fromStatuses]);
  // Check expiry in the UPDATE itself: two readers of a stale row must not
  // both replace the active token and start the same external side effect.
  const transcriptionLease = options.fromStatuses.includes("transcribing")
    ? sql`(${call.status} <> 'transcribing' or ${call.claimedAt} < now() - interval '10 minutes' - coalesce(${call.recordingDurationSec}, 0) * interval '2 seconds')`
    : undefined;
  const emailLease = options.fromStatuses.includes("emailing")
    ? sql`(${call.status} <> 'emailing' or ${call.emailClaimedAt} < now() - interval '10 minutes')`
    : undefined;

  const rows =
    options.step === "transcribing"
      ? await db
          .update(call)
          .set({
            status: "transcribing",
            claimToken,
            claimedAt: sql`now()`,
            transcribeAttempts: sql`${call.transcribeAttempts} + 1`,
            lastError: null,
            updatedAt,
          })
          .where(and(eq(call.id, callId), inFrom, transcriptionLease))
          .returning()
      : options.step === "emailing"
        ? await db
            .update(call)
            .set({
              status: "emailing",
              claimToken,
              emailClaimedAt: sql`now()`,
              emailAttempts: sql`${call.emailAttempts} + 1`,
              lastEmailError: null,
              updatedAt,
            })
            .where(
              and(
                eq(call.id, callId),
                inFrom,
                isNull(call.transcriptEmailSentAt),
                emailLease
              )
            )
            .returning()
        : await db
            .update(call)
            .set({
              claimToken,
              emailClaimedAt: sql`now()`,
              emailAttempts: sql`${call.emailAttempts} + 1`,
              lastEmailError: null,
              updatedAt,
            })
            .where(
              and(
                eq(call.id, callId),
                inFrom,
                isNull(call.metadataEmailSentAt),
                or(isNull(call.emailClaimedAt), isNotNull(call.lastEmailError))
              )
            )
            .returning();
  return rows[0] ?? null;
}

/** Columns a pipeline step may write after its claim. */
export type CallPatch = Partial<
  Pick<
    Call,
    | "status"
    | "transcript"
    | "transcriptText"
    | "recordingStatus"
    | "lastError"
    | "lastEmailError"
    | "transcriptEmailSentAt"
    | "metadataEmailSentAt"
    | "emailMessageId"
    | "emailedTo"
    | "callerSpoke"
  >
>;

async function writeWithToken(
  callId: string,
  token: string,
  patch: CallPatch
): Promise<boolean> {
  const rows = await db
    .update(call)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(call.id, callId), eq(call.claimToken, token)))
    .returning({ id: call.id });
  return rows.length > 0;
}

/**
 * Finish a step. Updates only while the claim token still matches; false
 * means the claim was taken over and the caller must stop without sending.
 */
export function complete(
  callId: string,
  token: string,
  patch: CallPatch
): Promise<boolean> {
  return writeWithToken(callId, token, patch);
}

/** Record a step failure under the same token guard as `complete`. */
export function fail(
  callId: string,
  token: string,
  patch: CallPatch
): Promise<boolean> {
  return writeWithToken(callId, token, patch);
}

export interface PipelineUser {
  email: string;
  name: string;
  /** IANA zone from the profile. */
  timezone: string;
}

export interface PipelineCall {
  call: Call;
  user: PipelineUser;
}

/** The call row with what the emails need from the user and profile. */
export async function getCallForPipeline(
  callId: string
): Promise<PipelineCall | null> {
  const rows = await db
    .select({
      call,
      email: user.email,
      name: user.name,
      timezone: userProfile.timezone,
    })
    .from(call)
    .innerJoin(user, eq(user.id, call.userId))
    .innerJoin(userProfile, eq(userProfile.userId, call.userId))
    .where(eq(call.id, callId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    call: row.call,
    user: { email: row.email, name: row.name, timezone: row.timezone },
  };
}
