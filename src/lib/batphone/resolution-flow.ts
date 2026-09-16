/**
 * Contact resolution flow shared by the gather and confirm handlers
 *
 * The prompt that follows a failed attempt depends only on the attempt
 * number (R8): a reprompt after the first, the keypad fallback after the
 * second, goodbye with the row closed as not_found after the third. Both
 * handlers reach it, so it lives here rather than in either route.
 */

import type { Call } from "@/db/schema";

import { markNotFound, type ContactForCall } from "./calls-repo";
import { callbackUrl, voiceSettings } from "./config";
import {
  alreadyConnecting,
  contactHints,
  gatherPrompt,
  goodbyeNotFound,
  keypadFallbackPrompt,
} from "./twiml";

import type { ResolveResult } from "./matcher";
import type { CallStatus, ResolutionCandidate } from "./state";

export const GATHER_PATH = "/api/twilio/gather";
export const CONFIRM_PATH = "/api/twilio/confirm";
export const DIAL_STATUS_PATH = "/api/twilio/dial-status";
export const RECORDING_PATH = "/api/twilio/recording";
export const AMD_STATUS_PATH = "/api/twilio/amd-status";

/** Failed attempts before the call ends with goodbye (R8). */
export const MAX_ATTEMPTS = 3;

export interface RepromptOptions {
  /** What was recognised on the failed attempt, spoken back to the caller (R26). */
  heard?: string;
  /** The failed attempt carried no speech and no digits. */
  noSpeech?: boolean;
}

/**
 * TwiML after attempt `attempt` failed to pick a contact. On the third
 * failure the row moves to not_found (conditionally, so a duplicate
 * callback writes nothing) and the caller hears goodbye.
 */
export async function repromptAfterFailure(
  row: Pick<Call, "id">,
  attempt: number,
  contacts: readonly ContactForCall[],
  options: RepromptOptions = {}
): Promise<string> {
  const settings = voiceSettings();
  if (attempt >= MAX_ATTEMPTS) {
    await markNotFound(row.id);
    return goodbyeNotFound(settings);
  }
  const next = attempt + 1;
  const actionUrl = callbackUrl(GATHER_PATH, { callId: row.id, attempt: next });
  if (attempt >= MAX_ATTEMPTS - 1) {
    return keypadFallbackPrompt({ settings, actionUrl });
  }
  return gatherPrompt({
    settings,
    actionUrl,
    hints: contactHints(contacts),
    heard: options.heard,
    noSpeech: options.noSpeech,
  });
}

/** Statuses in which the caller already gave up or was given up on. */
const CLOSED_BEFORE_DIAL: ReadonlySet<CallStatus> = new Set([
  "abandoned",
  "not_found",
]);

/**
 * Response for a resolution callback whose row is no longer identifying:
 * goodbye when the call closed before a dial, otherwise "already
 * connecting" because a Dial has been issued.
 */
export function notIdentifyingResponse(row: Pick<Call, "status">): string {
  const settings = voiceSettings();
  return CLOSED_BEFORE_DIAL.has(row.status)
    ? goodbyeNotFound(settings)
    : alreadyConnecting(settings);
}

/** The candidate shape stored on the attempt: no phone number snapshot. */
export function storedCandidates(
  result: ResolveResult<ContactForCall>
): ResolutionCandidate[] {
  return result.candidates.map(({ contactId, name, score }) => ({
    contactId,
    name,
    score,
  }));
}
