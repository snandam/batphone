import {
  insertResolutionAttempt,
  listContactsForUser,
} from "@/lib/batphone/calls-repo";
import { callbackUrl, voiceSettings } from "@/lib/batphone/config";
import {
  normalizeQuery,
  resolveBySpeedDial,
  resolveContact,
} from "@/lib/batphone/matcher";
import {
  CONFIRM_PATH,
  notIdentifyingResponse,
  repromptAfterFailure,
  storedCandidates,
} from "@/lib/batphone/resolution-flow";
import {
  bindCall,
  callLogContext,
  parseTwilioRequest,
  recordEvent,
  twimlResponse,
  withTwiml,
} from "@/lib/batphone/twilio-request";
import { confirmPrompt, disambiguationPrompt } from "@/lib/batphone/twiml";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Twilio's Confidence is a decimal string; absent on keypad input and silence. */
function parseConfidence(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const confidence = Number(value);
  return Number.isFinite(confidence) ? confidence : null;
}

/**
 * Gather action: the caller named a contact by voice or keypad
 *
 * Resolves the input against the caller's contacts (R7, R8), stores the
 * attempt before replying (R26), then returns the confirmation prompt, the
 * numbered disambiguation, a reprompt that repeats what was heard, the
 * keypad fallback, or goodbye with the row closed as not_found after the
 * third failure.
 */
export const POST = withTwiml(async (request) => {
  const parsed = await parseTwilioRequest(request);
  if (!parsed.ok) return parsed.response;
  const { params, query } = parsed;
  await recordEvent(params, "gather");

  const bound = await bindCall(params, query);
  if (!bound.ok) return bound.response;
  const { row, attempt } = bound;
  const context = callLogContext(row, attempt);

  if (row.status !== "identifying") {
    logger.warn("gather_not_identifying", context);
    return twimlResponse(notIdentifyingResponse(row));
  }

  const contacts = await listContactsForUser(row.userId);
  const digits = params.Digits ?? "";
  const speech = params.SpeechResult ?? "";
  const inputKind = digits !== "" ? "digits" : "speech";
  const heard = inputKind === "digits" ? digits : speech;
  const result =
    inputKind === "digits"
      ? resolveBySpeedDial(digits, contacts)
      : resolveContact(speech, contacts);

  const attemptId = await insertResolutionAttempt({
    callId: row.id,
    attemptNumber: attempt,
    inputKind,
    heardText: heard,
    confidence:
      inputKind === "speech" ? parseConfidence(params.Confidence) : null,
    normalizedQuery:
      inputKind === "digits"
        ? digits.replace(/[#*\s]/g, "")
        : normalizeQuery(speech),
    candidates: storedCandidates(result),
    decision: result.kind,
    chosenContactId: result.kind === "match" ? result.contact.id : null,
  });
  logger.info("resolution_attempt", {
    ...context,
    input_kind: inputKind,
    decision: result.kind,
    candidate_count: result.candidates.length,
  });

  if (result.kind === "match") {
    return twimlResponse(
      confirmPrompt({
        settings: voiceSettings(),
        contactName: result.contact.name,
        actionUrl: callbackUrl(CONFIRM_PATH, {
          callId: row.id,
          attempt,
          attemptId,
          contactId: result.contact.id,
        }),
      })
    );
  }

  if (result.kind === "ambiguous") {
    return twimlResponse(
      disambiguationPrompt({
        settings: voiceSettings(),
        candidates: result.options,
        actionUrl: callbackUrl(CONFIRM_PATH, {
          callId: row.id,
          attempt,
          attemptId,
          candidates: result.options.map((c) => c.contactId).join(","),
        }),
      })
    );
  }

  return twimlResponse(
    await repromptAfterFailure(row, attempt, contacts, {
      heard: heard || undefined,
      noSpeech: heard === "",
    })
  );
});
