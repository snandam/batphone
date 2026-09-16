import { getCallById, writeAnsweredBy } from "@/lib/batphone/calls-repo";
import {
  callLogContext,
  emptyResponse,
  parseTwilioRequest,
  recordEvent,
} from "@/lib/batphone/twilio-request";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** A verdict is only honoured while its call is younger than this. */
const MAX_CALL_AGE_MS = 24 * 60 * 60 * 1000;
const UNKNOWN_ANSWERED_BY = "unknown";

function parseMilliseconds(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  return Number(value);
}

/**
 * Answering machine detection callback for the outbound leg
 *
 * Twilio posts AnsweredBy and MachineDetectionDuration once the verdict is
 * in, while the leg is still live. The row is found by the signed callId
 * query rather than `bindCall`: AMD runs on the child call, so the body's
 * CallSid is the outbound leg's SID, which the row only learns from the
 * dial action after the leg ends. The SID is checked against the parent
 * and, once stored, the child; the signature over the URL is what ties
 * the request to the row. Twilio ignores the body, so every outcome is an
 * empty 200 except a thrown error, which is a 500 so it stays visible.
 */
export async function POST(request: Request): Promise<Response> {
  const parsed = await parseTwilioRequest(request);
  if (!parsed.ok) return parsed.response;
  const { params, query } = parsed;
  const callSid = params.CallSid ?? "";

  try {
    await recordEvent(params, "amd-status");

    const callId = query.get("callId");
    const row = callId ? await getCallById(callId) : null;
    if (!row) {
      logger.warn("amd_call_missing", {
        call_id: callId ?? "",
        call_sid: callSid,
      });
      return emptyResponse(200);
    }
    const context = callLogContext(row);

    const knownSid =
      callSid === row.twilioCallSid ||
      row.dialCallSid === null ||
      callSid === row.dialCallSid;
    if (!knownSid) {
      logger.warn("amd_sid_mismatch", {
        ...context,
        request_call_sid: callSid,
      });
      return emptyResponse(200);
    }
    if (Date.now() - row.inboundAt.getTime() > MAX_CALL_AGE_MS) {
      logger.warn("amd_call_expired", context);
      return emptyResponse(200);
    }

    const answeredBy = params.AnsweredBy || UNKNOWN_ANSWERED_BY;
    const machineDetectionDurationMs = parseMilliseconds(
      params.MachineDetectionDuration
    );
    const written = await writeAnsweredBy(row.id, {
      answeredBy,
      machineDetectionDurationMs,
    });
    if (written) {
      logger.info("amd_result", {
        ...callLogContext(written),
        answered_by: answeredBy,
        machine_detection_duration_ms: machineDetectionDurationMs,
      });
    } else {
      logger.warn("amd_row_missing", context);
    }
    return emptyResponse(200);
  } catch (error) {
    logger.exception("amd_handler_error", error, { call_sid: callSid });
    return emptyResponse(500);
  }
}
