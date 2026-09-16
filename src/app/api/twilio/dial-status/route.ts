import { writeDialOutcome, type DialOutcome } from "@/lib/batphone/calls-repo";
import { voiceSettings } from "@/lib/batphone/config";
import {
  bindCall,
  callLogContext,
  parseTwilioRequest,
  recordEvent,
  twimlResponse,
  withTwiml,
} from "@/lib/batphone/twilio-request";
import { postDialOutcome, type PostDialOutcome } from "@/lib/batphone/twiml";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const KNOWN_OUTCOMES: ReadonlySet<string> = new Set<DialOutcome>([
  "busy",
  "no-answer",
  "failed",
  "canceled",
  "completed",
]);

/**
 * Twilio's DialCallStatus as the repository outcome. `answered` means the
 * leg was picked up and then ended by the far side, so it is a completed
 * call; anything unrecognised is stored as failed and logged.
 */
function toOutcome(dialCallStatus: string): {
  outcome: DialOutcome;
  known: boolean;
} {
  if (dialCallStatus === "answered")
    return { outcome: "completed", known: true };
  if (KNOWN_OUTCOMES.has(dialCallStatus)) {
    return { outcome: dialCallStatus as DialOutcome, known: true };
  }
  return { outcome: "failed", known: false };
}

function spoken(outcome: DialOutcome): PostDialOutcome {
  if (outcome === "failed" || outcome === "canceled") return "failed";
  return outcome;
}

function parseSeconds(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  return Number(value);
}

/**
 * Dial action: the outbound leg ended
 *
 * Stores the dial call SID, duration, and end time, then applies the one
 * guarded transition from dialing (R10). A recording that arrived first
 * has already moved the row on, in which case only the dial fields are
 * written (AE6). Whatever the row's state, the caller hears the outcome
 * and the inbound leg ends.
 */
export const POST = withTwiml(async (request) => {
  const parsed = await parseTwilioRequest(request);
  if (!parsed.ok) return parsed.response;
  const { params, query } = parsed;
  await recordEvent(params, "dial-status");

  const bound = await bindCall(params, query);
  if (!bound.ok) return bound.response;
  const { row } = bound;
  const context = callLogContext(row);

  const dialCallStatus = params.DialCallStatus ?? "";
  const { outcome, known } = toOutcome(dialCallStatus);
  if (!known) {
    logger.warn("dial_status_unknown", {
      ...context,
      dial_call_status: dialCallStatus,
    });
  }

  const result = await writeDialOutcome(row.id, {
    dialCallSid: params.DialCallSid ?? null,
    dialDurationSec: parseSeconds(params.DialCallDuration),
    endedAt: new Date(),
    outcome,
  });
  if (result) {
    logger.info("dial_outcome", {
      ...callLogContext(result.row),
      dial_call_status: dialCallStatus,
      transitioned: result.transitioned,
    });
  } else {
    logger.warn("dial_outcome_row_missing", context);
  }

  return twimlResponse(
    postDialOutcome(spoken(outcome), {
      settings: voiceSettings(),
      contactName: row.contactNameSnapshot ?? "Your contact",
    })
  );
});
