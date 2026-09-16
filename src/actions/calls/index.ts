"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  call,
  resolutionAttempt,
  userProfile,
  type Call,
  type ResolutionAttempt,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import {
  resyncCall as pipelineResync,
  retryCall as pipelineRetry,
} from "@/lib/batphone/pipeline";
import { requireCompletedOnboarding } from "@/lib/batphone/require-profile";
import type { CallStatus } from "@/lib/batphone/state";
import { logger } from "@/lib/logger";

/**
 * Call history server actions
 *
 * Every read is scoped to the session user in the statement itself, so a
 * foreign call id behaves exactly like a missing one: `not_found`, with
 * no claim taken and no Twilio call made. Retry and resync hand the owned
 * call to the pipeline, which owns the claims and the Twilio reads.
 */

export type CallsFailure =
  | "unauthenticated"
  | "not_found"
  | "nothing_to_retry"
  | "confirm_required"
  | "not_stuck"
  | "failed";

export type CallsResult<T> =
  { ok: true; data: T } | { ok: false; reason: CallsFailure };

/** Which email went out for a call, if any. */
export type EmailKind = "transcript" | "metadata";

/** A history row: the columns the rows need, never the transcript. */
export interface CallSummary {
  id: string;
  contactName: string | null;
  /** E.164. */
  destinationNumber: string | null;
  status: CallStatus;
  inboundAt: Date;
  recordingStartedAt: Date | null;
  recordingDurationSec: number | null;
  dialDurationSec: number | null;
  /** What the last resolution attempt heard; shown for not_found calls. */
  lastHeardText: string | null;
  /** The transcript text column is populated. */
  hasTranscript: boolean;
  /** A Twilio recording sid is stored. */
  hasRecording: boolean;
  /** When the email went out: the transcript email, else the metadata one. */
  emailSentAt: Date | null;
  emailKind: EmailKind | null;
  /** Raw Twilio AnsweredBy from answering machine detection, null until known. */
  answeredBy: string | null;
  /** Whether the caller said anything, null until transcribed. */
  callerSpoke: boolean | null;
}

export interface CallHistory {
  calls: CallSummary[];
  /** IANA zone from the profile; timestamps render in it. */
  timeZone: string;
}

export interface CallDetailData {
  call: Call;
  /** Ordered by attempt number. */
  attempts: ResolutionAttempt[];
  timeZone: string;
  callerName: string;
}

export interface RetryOptions {
  confirmDuplicate?: boolean;
}

export interface ActionOutcome {
  outcome: string;
}

const HISTORY_PATH = "/calls";
const FALLBACK_ZONE = "UTC";
const MAX_ID_LENGTH = 64;

interface SessionUser {
  id: string;
  name: string;
}

async function currentUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  const profile = await requireCompletedOnboarding(session.user.id);
  return {
    id: session.user.id,
    name: `${profile.firstName} ${profile.lastName}`.trim(),
  };
}

function isCallId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH
  );
}

async function loadTimeZone(userId: string): Promise<string> {
  const [profile] = await db
    .select({ timezone: userProfile.timezone })
    .from(userProfile)
    .where(eq(userProfile.userId, userId))
    .limit(1);
  return profile?.timezone ?? FALLBACK_ZONE;
}

/** The transcript email wins over the metadata one when both were sent. */
function emailFacts(
  transcriptEmailSentAt: Date | null,
  metadataEmailSentAt: Date | null
): Pick<CallSummary, "emailSentAt" | "emailKind"> {
  if (transcriptEmailSentAt) {
    return { emailSentAt: transcriptEmailSentAt, emailKind: "transcript" };
  }
  if (metadataEmailSentAt) {
    return { emailSentAt: metadataEmailSentAt, emailKind: "metadata" };
  }
  return { emailSentAt: null, emailKind: null };
}

/** The call row only when it belongs to the user; null otherwise. */
async function loadOwnedCall(
  userId: string,
  callId: string
): Promise<Call | null> {
  const [row] = await db
    .select()
    .from(call)
    .where(and(eq(call.id, callId), eq(call.userId, userId)))
    .limit(1);
  return row ?? null;
}

/**
 * The session user's calls, newest first, without the transcript columns.
 * The latest resolution attempt's heard text rides along in a correlated
 * subquery so not_found rows can show what the bat phone heard. Transcript
 * and recording presence are computed in SQL so the text itself never
 * leaves the database; the email facts derive from the two sent-at
 * columns in code.
 */
export async function listCalls(): Promise<CallsResult<CallHistory>> {
  try {
    const user = await currentUser();
    if (!user) return { ok: false, reason: "unauthenticated" };

    const lastHeardText = sql<
      string | null
    >`(select ${resolutionAttempt.heardText} from ${resolutionAttempt} where ${resolutionAttempt.callId} = ${call.id} order by ${resolutionAttempt.attemptNumber} desc limit 1)`;

    const rows = await db
      .select({
        id: call.id,
        contactName: call.contactNameSnapshot,
        destinationNumber: call.destinationNumberSnapshot,
        status: call.status,
        inboundAt: call.inboundAt,
        recordingStartedAt: call.recordingStartedAt,
        recordingDurationSec: call.recordingDurationSec,
        dialDurationSec: call.dialDurationSec,
        lastHeardText,
        hasTranscript: sql<boolean>`${call.transcriptText} is not null`,
        hasRecording: sql<boolean>`${call.recordingSid} is not null`,
        transcriptEmailSentAt: call.transcriptEmailSentAt,
        metadataEmailSentAt: call.metadataEmailSentAt,
        answeredBy: call.answeredBy,
        callerSpoke: call.callerSpoke,
      })
      .from(call)
      .where(eq(call.userId, user.id))
      .orderBy(desc(call.inboundAt));
    const timeZone = await loadTimeZone(user.id);

    const calls: CallSummary[] = rows.map(
      ({ transcriptEmailSentAt, metadataEmailSentAt, ...row }) => ({
        ...row,
        ...emailFacts(transcriptEmailSentAt, metadataEmailSentAt),
      })
    );

    return { ok: true, data: { calls, timeZone } };
  } catch (error) {
    unstable_rethrow(error);
    logger.exception("list_calls_failed", error);
    return { ok: false, reason: "failed" };
  }
}

/** One call with its resolution attempts; not_found unless the user owns it. */
export async function getCall(
  callId: unknown
): Promise<CallsResult<CallDetailData>> {
  try {
    const user = await currentUser();
    if (!user) return { ok: false, reason: "unauthenticated" };
    if (!isCallId(callId)) return { ok: false, reason: "not_found" };

    const row = await loadOwnedCall(user.id, callId);
    if (!row) return { ok: false, reason: "not_found" };

    const timeZone = await loadTimeZone(user.id);
    const attempts = await db
      .select()
      .from(resolutionAttempt)
      .where(eq(resolutionAttempt.callId, row.id))
      .orderBy(asc(resolutionAttempt.attemptNumber));

    return {
      ok: true,
      data: { call: row, attempts, timeZone, callerName: user.name },
    };
  } catch (error) {
    unstable_rethrow(error);
    logger.exception("get_call_failed", error);
    return { ok: false, reason: "failed" };
  }
}

function revalidateCall(callId: string): void {
  revalidatePath(HISTORY_PATH);
  revalidatePath(`${HISTORY_PATH}/${callId}`);
}

/**
 * Re-run the failed or stale step (R20). Ownership is checked before the
 * pipeline is reached, so a foreign id takes no claim.
 */
export async function retryCall(
  callId: unknown,
  options: RetryOptions = {}
): Promise<CallsResult<ActionOutcome>> {
  try {
    const user = await currentUser();
    if (!user) return { ok: false, reason: "unauthenticated" };
    if (!isCallId(callId)) return { ok: false, reason: "not_found" };

    const row = await loadOwnedCall(user.id, callId);
    if (!row) return { ok: false, reason: "not_found" };

    const outcome = await pipelineRetry(row.id, {
      confirmDuplicate: options.confirmDuplicate === true,
    });
    revalidateCall(row.id);

    if (
      outcome === "not_found" ||
      outcome === "nothing_to_retry" ||
      outcome === "confirm_required"
    ) {
      return { ok: false, reason: outcome };
    }
    return { ok: true, data: { outcome } };
  } catch (error) {
    unstable_rethrow(error);
    logger.exception("retry_call_failed", error);
    return { ok: false, reason: "failed" };
  }
}

/**
 * Reconcile a stuck row against Twilio (R20). Ownership is checked before
 * any Twilio read.
 */
export async function resyncCall(
  callId: unknown
): Promise<CallsResult<ActionOutcome>> {
  try {
    const user = await currentUser();
    if (!user) return { ok: false, reason: "unauthenticated" };
    if (!isCallId(callId)) return { ok: false, reason: "not_found" };

    const row = await loadOwnedCall(user.id, callId);
    if (!row) return { ok: false, reason: "not_found" };

    const outcome = await pipelineResync(row.id);
    revalidateCall(row.id);

    if (outcome === "not_found" || outcome === "not_stuck") {
      return { ok: false, reason: outcome };
    }
    return { ok: true, data: { outcome } };
  } catch (error) {
    unstable_rethrow(error);
    logger.exception("resync_call_failed", error);
    return { ok: false, reason: "failed" };
  }
}
