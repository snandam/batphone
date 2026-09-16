import {
  getCallBySid,
  markAbandonedIfIdentifying,
  markOpenAttemptsHungUp,
  setEndedAt,
} from "@/lib/batphone/calls-repo";
import {
  emptyResponse,
  parseTwilioRequest,
  recordEvent,
} from "@/lib/batphone/twilio-request";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** CallStatus values that mean the inbound leg is over. */
const ENDED_STATUSES = new Set([
  "completed",
  "failed",
  "busy",
  "no-answer",
  "canceled",
]);

/** Twilio's Timestamp is RFC 2822; fall back to now when absent or unparseable. */
function endedAtFrom(timestamp: string | undefined): Date {
  if (timestamp) {
    const parsed = new Date(timestamp);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

/**
 * Call status callback for the inbound leg
 *
 * Runs when the caller's call ends, whatever state the pipeline is in.
 * Records ended_at, closes a call that was still identifying as abandoned
 * (R11), and marks any resolution attempt still waiting on the caller as
 * hung_up (R26). Never returns TwiML: Twilio ignores the body here.
 */
export async function POST(request: Request): Promise<Response> {
  const parsed = await parseTwilioRequest(request);
  if (!parsed.ok) return parsed.response;
  const { params } = parsed;

  try {
    await recordEvent(params, "call-status");

    const callSid = params.CallSid ?? "";
    const status = params.CallStatus ?? "";
    if (!ENDED_STATUSES.has(status)) {
      return emptyResponse(204);
    }

    const endedAt = endedAtFrom(params.Timestamp);
    await setEndedAt(callSid, endedAt);
    const abandoned = await markAbandonedIfIdentifying(callSid, endedAt);
    const row = await getCallBySid(callSid);
    if (row) {
      const hungUp = abandoned ? await markOpenAttemptsHungUp(row.id) : 0;
      logger.info("call_ended", {
        call_id: row.id,
        call_sid: callSid,
        status: row.status,
        twilio_status: status,
        abandoned,
        attempts_hung_up: hungUp,
      });
    } else {
      logger.info("call_ended_unknown_sid", {
        call_sid: callSid,
        twilio_status: status,
      });
    }
    return emptyResponse(204);
  } catch (error) {
    logger.exception("call_status_handler_error", error, {
      call_sid: params.CallSid ?? "",
    });
    return emptyResponse(500);
  }
}
