import {
  claimDialing,
  listContactsForUser,
  updateResolutionAttemptResponse,
  type AttemptResponse,
  type ContactForCall,
} from "@/lib/batphone/calls-repo";
import {
  callbackUrl,
  twilioPhoneNumber,
  voiceSettings,
} from "@/lib/batphone/config";
import {
  AMD_STATUS_PATH,
  DIAL_STATUS_PATH,
  notIdentifyingResponse,
  RECORDING_PATH,
  repromptAfterFailure,
} from "@/lib/batphone/resolution-flow";
import {
  bindCall,
  callLogContext,
  parseTwilioRequest,
  recordEvent,
  twimlResponse,
  withTwiml,
  type CallLogContext,
} from "@/lib/batphone/twilio-request";
import { alreadyConnecting, dial, goodbyeNotFound } from "@/lib/batphone/twiml";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * What the caller's key press means in this mode: the contact to dial, or
 * the response to record before reprompting.
 */
type Choice =
  | { kind: "dial"; contact: ContactForCall; response: AttemptResponse }
  | { kind: "reprompt"; response: AttemptResponse };

/** What the caller did after the prompt, keypad first because a key press is unambiguous. */
interface ConfirmInput {
  digits: string;
  speech: string;
}

/** Spoken confirmations; the prompt offers "yes" and the hints include the digit words. */
const YES_SPEECH = /^(yes|yeah|yep|yup|one|1)\b/i;
const NO_SPEECH = /^(no|nope|two|2)\b/i;

type Answer = "yes" | "no" | "other" | "none";

/**
 * Single-candidate answer. Anything that is not a clear yes counts as
 * "no", so a misheard word never dials the wrong person.
 */
function singleCandidateAnswer(input: ConfirmInput): Answer {
  if (input.digits !== "") return input.digits === "1" ? "yes" : "no";
  if (input.speech === "") return "none";
  if (YES_SPEECH.test(input.speech)) return "yes";
  if (NO_SPEECH.test(input.speech)) return "no";
  return "other";
}

/** Single-candidate mode: 1 or yes confirms, anything else retries, silence is a timeout. */
function singleCandidateChoice(
  input: ConfirmInput,
  contact: ContactForCall,
  callId: string
): Choice {
  const answer = singleCandidateAnswer(input);
  if (answer === "none") {
    return {
      kind: "reprompt",
      response: { callId, callerResponse: "timeout" },
    };
  }
  if (answer === "yes") {
    return {
      kind: "dial",
      contact,
      response: { callId, callerResponse: "confirmed" },
    };
  }
  return { kind: "reprompt", response: { callId, callerResponse: "retried" } };
}

/** Selection mode: a digit from 1 to N picks that candidate; anything else retries. */
function selectionChoice(
  digits: string,
  candidates: ContactForCall[],
  callId: string
): Choice {
  if (digits === "") {
    return {
      kind: "reprompt",
      response: { callId, callerResponse: "timeout" },
    };
  }
  const position = /^\d$/.test(digits) ? Number(digits) : 0;
  const contact = position >= 1 ? candidates[position - 1] : undefined;
  if (!contact) {
    return {
      kind: "reprompt",
      response: { callId, callerResponse: "retried" },
    };
  }
  return {
    kind: "dial",
    contact,
    response: {
      callId,
      callerResponse: "selected",
      selectedPosition: position,
    },
  };
}

/**
 * Confirmation action: the caller pressed a key or spoke after the
 * confirm or disambiguation prompt
 *
 * The signed query names either one `contactId` (single-candidate mode)
 * or an ordered `candidates` list (selection mode); bindCall has already
 * checked the caller owns every id. The caller's response is written to
 * the attempt first so it is never lost, then the one compare-and-set from
 * identifying to dialing decides whether this request emits the Dial verb
 * (R16). A duplicate delivery updates zero rows and hears
 * "already connecting".
 */
export const POST = withTwiml(async (request) => {
  const parsed = await parseTwilioRequest(request);
  if (!parsed.ok) return parsed.response;
  const { params, query } = parsed;
  await recordEvent(params, "confirm");

  const bound = await bindCall(params, query);
  if (!bound.ok) return bound.response;
  const { row, attempt } = bound;
  const context = callLogContext(row, attempt);

  const contacts = await listContactsForUser(row.userId);
  const byId = new Map(contacts.map((contact) => [contact.id, contact]));
  const settings = voiceSettings();
  const digits = (params.Digits ?? "").trim();
  const speech = (params.SpeechResult ?? "").trim();
  const contactId = query.get("contactId");
  const candidateIds = (query.get("candidates") ?? "")
    .split(",")
    .filter((id) => id.length > 0);

  let choice: Choice;
  if (contactId) {
    const contact = byId.get(contactId);
    if (!contact) return unknownContact(context);
    choice = singleCandidateChoice({ digits, speech }, contact, row.id);
  } else if (candidateIds.length > 0) {
    const candidates = candidateIds.map((id) => byId.get(id));
    if (candidates.some((c) => c === undefined)) return unknownContact(context);
    choice = selectionChoice(digits, candidates as ContactForCall[], row.id);
  } else {
    logger.warn("confirm_query_without_contact", context);
    return twimlResponse(goodbyeNotFound(settings));
  }

  const attemptId = query.get("attemptId");
  if (attemptId) {
    await updateResolutionAttemptResponse(attemptId, choice.response);
  } else {
    logger.warn("confirm_query_without_attempt", context);
  }
  logger.info("confirm_response", {
    ...context,
    input_kind: digits !== "" ? "digits" : speech !== "" ? "speech" : "none",
    caller_response: choice.response.callerResponse,
    selected_position: choice.response.selectedPosition,
  });

  if (choice.kind === "reprompt") {
    if (row.status !== "identifying") {
      logger.warn("confirm_not_identifying", context);
      return twimlResponse(notIdentifyingResponse(row));
    }
    return twimlResponse(await repromptAfterFailure(row, attempt, contacts));
  }

  const claimed = await claimDialing(row.id, {
    contactId: choice.contact.id,
    contactName: choice.contact.name,
    destinationNumber: choice.contact.phone,
  });
  if (!claimed) {
    logger.warn("dial_claim_lost", context);
    return twimlResponse(alreadyConnecting(settings));
  }

  logger.info("dial_claimed", callLogContext(claimed, attempt));
  return twimlResponse(
    dial({
      settings,
      to: choice.contact.phone,
      callerId: twilioPhoneNumber(),
      actionUrl: callbackUrl(DIAL_STATUS_PATH, { callId: row.id }),
      recordingStatusCallbackUrl: callbackUrl(RECORDING_PATH, {
        callId: row.id,
      }),
      amdStatusCallbackUrl: callbackUrl(AMD_STATUS_PATH, { callId: row.id }),
    })
  );
});

/**
 * bindCall proved ownership, so a contact missing from the list was
 * deleted between prompts. Goodbye rather than dialing a stale number.
 */
function unknownContact(context: CallLogContext): Response {
  logger.warn("confirm_contact_missing", context);
  return twimlResponse(goodbyeNotFound(voiceSettings()));
}
