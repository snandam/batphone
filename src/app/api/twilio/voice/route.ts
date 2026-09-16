import {
  findUserByPhone,
  insertCallIdentifying,
  listContactsForUser,
} from "@/lib/batphone/calls-repo";
import { callbackUrl, voiceSettings } from "@/lib/batphone/config";
import { classifyCallerId } from "@/lib/batphone/phone";
import {
  callLogContext,
  parseTwilioRequest,
  recordEvent,
  twimlResponse,
  withTwiml,
} from "@/lib/batphone/twilio-request";
import {
  contactHints,
  gatherPrompt,
  noContacts,
  notRegistered,
} from "@/lib/batphone/twiml";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const GATHER_PATH = "/api/twilio/gather";

/**
 * Inbound voice webhook
 *
 * Twilio posts here when someone dials the bat phone. The caller is
 * identified by caller ID (R3); a known caller with contacts gets a call
 * row in `identifying` and the "who would you like to call" prompt (R7).
 * Unauthenticated by design: the signature check and event log run first.
 */
export const POST = withTwiml(async (request) => {
  const parsed = await parseTwilioRequest(request);
  if (!parsed.ok) return parsed.response;
  const { params } = parsed;
  await recordEvent(params, "voice");
  const settings = voiceSettings();

  const callSid = params.CallSid ?? "";
  const from = params.From ?? "";
  const kind = classifyCallerId(from);
  if (kind !== "e164") {
    logger.warn("caller_not_registered", { call_sid: callSid, reason: kind });
    return twimlResponse(notRegistered(settings));
  }

  const caller = await findUserByPhone(from);
  if (!caller) {
    logger.warn("caller_not_registered", {
      call_sid: callSid,
      reason: "unknown",
    });
    return twimlResponse(notRegistered(settings));
  }

  const contacts = await listContactsForUser(caller.userId);
  if (contacts.length === 0) {
    logger.warn("caller_has_no_contacts", {
      call_sid: callSid,
      user_id: caller.userId,
    });
    return twimlResponse(noContacts(settings));
  }

  const row = await insertCallIdentifying({
    userId: caller.userId,
    twilioCallSid: callSid,
    fromNumber: from,
    inboundAt: new Date(),
  });
  logger.info("call_identified", {
    ...callLogContext(row, 1),
    user_id: caller.userId,
    contact_count: contacts.length,
  });

  return twimlResponse(
    gatherPrompt({
      settings,
      actionUrl: callbackUrl(GATHER_PATH, { callId: row.id, attempt: 1 }),
      hints: contactHints(contacts),
      callerFirstName: caller.firstName,
    })
  );
});
