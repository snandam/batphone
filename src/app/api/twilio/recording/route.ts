import { scheduleBackgroundJob } from "@/lib/batphone/after";
import { markRecordingAbsent, writeRecording } from "@/lib/batphone/calls-repo";
import {
  bindCall,
  callLogContext,
  emptyResponse,
  parseTwilioRequest,
  recordEvent,
  type CallLogContext,
} from "@/lib/batphone/twilio-request";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** RFC 2822 from Twilio; null when absent or unparseable. */
function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseSeconds(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  return Number(value);
}

async function handleCompleted(
  callId: string,
  params: Record<string, string>,
  context: CallLogContext
): Promise<void> {
  const recordingSid = params.RecordingSid;
  if (!recordingSid) {
    logger.warn("recording_sid_missing", context);
    return;
  }
  const result = await writeRecording(callId, {
    recordingSid,
    startedAt: parseDate(params.RecordingStartTime),
    durationSec: parseSeconds(params.RecordingDuration),
  });
  const detail = {
    ...context,
    recording_sid: recordingSid,
    channels: params.RecordingChannels,
  };
  switch (result) {
    case "stored":
      logger.info("recording_stored", detail);
      await scheduleBackgroundJob({
        version: 1,
        kind: "process-recording",
        callId,
      });
      return;
    case "duplicate":
      logger.info("recording_duplicate", detail);
      // A prior process may have stopped after storing the SID but before
      // scheduling work. The pipeline claim makes replay safe.
      await scheduleBackgroundJob({
        version: 1,
        kind: "process-recording",
        callId,
      });
      return;
    case "different_sid":
      logger.warn("recording_sid_conflict", detail);
      return;
  }
}

async function handleAbsent(
  callId: string,
  context: CallLogContext
): Promise<void> {
  const result = await markRecordingAbsent(callId);
  if (!result) {
    logger.warn("recording_absent_row_missing", context);
    return;
  }
  logger.info("recording_absent", {
    ...callLogContext(result.row),
    transitioned: result.transitioned,
  });
  if (result.row.status === "no_recording") {
    await scheduleBackgroundJob({
      version: 1,
      kind: "metadata-email",
      callId,
      reason: "no_recording",
    });
  }
}

/**
 * Recording status callback for the outbound leg
 *
 * Persists the recording reference and awaits durable queue acceptance on
 * Cloudflare; Node schedules after the response. Twilio ignores the body, so
 * a callback that cannot be bound to its row is acknowledged with an empty
 * 200 after the event log has kept it; no row is ever created from it.
 */
export async function POST(request: Request): Promise<Response> {
  const parsed = await parseTwilioRequest(request);
  if (!parsed.ok) return parsed.response;
  const { params, query } = parsed;

  try {
    await recordEvent(params, "recording");

    const bound = await bindCall(params, query);
    if (!bound.ok) return emptyResponse(200);
    const { row } = bound;
    const context = callLogContext(row);

    const status = params.RecordingStatus ?? "";
    if (status === "completed") {
      await handleCompleted(row.id, params, context);
    } else if (status === "absent") {
      await handleAbsent(row.id, context);
    } else {
      logger.info("recording_status_ignored", {
        ...context,
        recording_status: status,
      });
    }
    return emptyResponse(200);
  } catch (error) {
    logger.exception("recording_handler_error", error, {
      call_sid: params.CallSid ?? "",
    });
    return emptyResponse(500);
  }
}
