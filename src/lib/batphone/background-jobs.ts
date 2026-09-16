import { getCallById } from "./calls-repo";
import { processRecording, retryCall, sendMetadataOnlyEmail } from "./pipeline";
import { isStale } from "./state";

export type BackgroundJob =
  | { version: 1; kind: "process-recording"; callId: string }
  | {
      version: 1;
      kind: "metadata-email";
      callId: string;
      reason: "no_recording" | "transcription_failed";
    };

/** Queue messages contain identifiers only, never credentials or call content. */
export function isBackgroundJob(value: unknown): value is BackgroundJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Record<string, unknown>;
  return (
    job.version === 1 &&
    typeof job.callId === "string" &&
    job.callId.length > 0 &&
    job.callId.length <= 200 &&
    (job.kind === "process-recording" ||
      (job.kind === "metadata-email" &&
        (job.reason === "no_recording" ||
          job.reason === "transcription_failed")))
  );
}

export type BackgroundJobResult = {
  status: "complete" | "retry" | "manual_review";
  delaySeconds?: number;
};

const defaults = {
  getCallById,
  processRecording,
  retryCall,
  sendMetadataOnlyEmail,
  now: () => new Date(),
};

/** Wait until the current lease can be evaluated again without exhausting retries. */
function waitForLease(
  start: Date | null,
  allowanceMs: number,
  now: Date
): BackgroundJobResult {
  const remainingMs = start
    ? allowanceMs - (now.getTime() - start.getTime())
    : allowanceMs;
  return {
    status: "retry",
    delaySeconds: Math.min(
      43_200,
      Math.max(60, Math.ceil(remainingMs / 1000) + 1)
    ),
  };
}

/** Resume persisted progress on redelivery without resending uncertain emails. */
export async function executeBackgroundJob(
  job: BackgroundJob,
  deps: typeof defaults = defaults
): Promise<BackgroundJobResult> {
  const row = await deps.getCallById(job.callId);
  if (!row) return { status: "complete" };
  if (job.kind === "metadata-email") {
    if (
      row.metadataEmailSentAt ||
      !["no_recording", "transcription_failed"].includes(row.status)
    ) {
      return { status: "complete" };
    }
    // A crash after provider acceptance cannot be distinguished from one before it.
    if (row.emailClaimedAt && !row.lastEmailError) {
      return deps.now().getTime() - row.emailClaimedAt.getTime() > 600_000
        ? { status: "manual_review" }
        : waitForLease(row.emailClaimedAt, 600_000, deps.now());
    }
    await deps.sendMetadataOnlyEmail(job.callId, job.reason);
    return { status: "complete" };
  }
  if (row.status === "transcribing") {
    if (!isStale(row, deps.now()))
      return waitForLease(
        row.claimedAt,
        600_000 + (row.recordingDurationSec ?? 0) * 2_000,
        deps.now()
      );
    await deps.retryCall(job.callId);
  } else if (row.status === "transcription_failed") {
    return executeBackgroundJob(
      {
        version: 1,
        kind: "metadata-email",
        callId: job.callId,
        reason: "transcription_failed",
      },
      deps
    );
  } else if (row.status === "transcribed") {
    await deps.retryCall(job.callId);
  } else if (row.status === "emailing") {
    return isStale(row, deps.now())
      ? { status: "manual_review" }
      : waitForLease(row.emailClaimedAt, 600_000, deps.now());
  } else if (row.status === "awaiting_recording" || row.status === "dialing") {
    await deps.processRecording(job.callId);
  }
  // Provider failures are persisted and surfaced for explicit retry in the UI.
  return { status: "complete" };
}
