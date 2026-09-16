/**
 * TwiML builders
 *
 * Every response the bat phone speaks is built here with the Twilio
 * response builder, never with string templates. Contact names and the
 * caller's recognised speech are untrusted input that reaches Say text and
 * the Gather hints attribute; the builder escapes both. Pure module: no
 * Next.js or database imports. The voice and speech model come in through
 * `VoiceSettings` so the routes can read them from configuration.
 */

import twilio from "twilio";

import type * as VoiceResponseTypes from "twilio/lib/twiml/VoiceResponse";

type VoiceResponse = InstanceType<typeof twilio.twiml.VoiceResponse>;
type GatherVerb = ReturnType<VoiceResponse["gather"]>;
type SayVoice = NonNullable<VoiceResponseTypes.SayAttributes["voice"]>;

export interface VoiceSettings {
  /** Say voice name, for example "Polly.Joanna-Neural". */
  voice: string;
  /** Gather speechModel, for example "deepgram_nova-3". */
  speechModel: string;
}

const LANGUAGE = "en-US";
/**
 * Seconds of silence after speech before the gather ends. Twilio's Gather
 * reference requires a positive integer here whenever `speechModel` is set
 * and says not to use "auto". Two seconds absorbs the pause between a first
 * and last name without making the caller wait long after a short answer.
 */
const SPEECH_TIMEOUT = "2";
/** Seconds to wait for the first key press or word. */
const DTMF_TIMEOUT = 5;
/** Outbound leg cap in seconds (R9). */
const DIAL_TIME_LIMIT_SEC = 1800;
const MAX_DISAMBIGUATION_OPTIONS = 4;
/** Twilio caps Gather hints at 500 phrases of 100 characters. */
const MAX_HINTS = 500;
const MAX_HINT_LENGTH = 100;

const WHO_TO_CALL = "Who would you like to call?";
const KEYPAD_TIP = "You can also press their speed dial, then pound.";
const BYE = "Bye for now.";

function response(): VoiceResponse {
  return new twilio.twiml.VoiceResponse();
}

function say(
  target: VoiceResponse | GatherVerb,
  settings: VoiceSettings,
  message: string
): void {
  // The SDK types the voice as a closed union of names; the value comes
  // from configuration and Twilio validates it at playback.
  target.say({ voice: settings.voice as SayVoice }, message);
}

/** Speak a message and end the call. */
function sayAndHangup(settings: VoiceSettings, message: string): string {
  const twiml = response();
  say(twiml, settings, message);
  twiml.hangup();
  return twiml.toString();
}

/** One hint phrase: commas dropped, whitespace collapsed, length capped. */
function cleanHint(phrase: string): string {
  return phrase
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_HINT_LENGTH)
    .trim();
}

/**
 * Hints are comma-separated, so a comma inside a name would split it into
 * two hints. Commas are dropped and whitespace collapsed; escaping of the
 * attribute value is done by the builder.
 */
function hintsAttribute(phrases: string[]): string {
  return phrases
    .map(cleanHint)
    .filter((phrase) => phrase.length > 0)
    .join(", ");
}

/**
 * Recognition hints for a contact list: every full name, then every first
 * name, then "call" followed by each of those. Callers say "call Mike" as
 * often as "Mike Anderson", and a hint that matches the whole utterance
 * steers the recogniser more than one that matches part of it. Grouped by
 * kind rather than by contact so the 500-phrase cap drops the least
 * useful variants first. Duplicates are removed after cleaning.
 */
export function contactHints(contacts: readonly { name: string }[]): string[] {
  const fullNames = contacts
    .map((contact) => cleanHint(contact.name))
    .filter((name) => name.length > 0);
  const firstNames = fullNames.map((name) => name.split(" ")[0] ?? "");
  const seen = new Set<string>();
  const hints: string[] = [];
  const add = (phrase: string) => {
    const clean = cleanHint(phrase);
    if (seen.has(clean)) return;
    seen.add(clean);
    hints.push(clean);
  };
  for (const name of fullNames) add(name);
  for (const name of firstNames) add(name);
  for (const name of fullNames) add(`call ${name}`);
  for (const name of firstNames) add(`call ${name}`);
  return hints.slice(0, MAX_HINTS);
}

export function notRegistered(settings: VoiceSettings): string {
  return sayAndHangup(
    settings,
    `This number isn't set up with Bat Phone yet. Add it in the app, then call again. ${BYE}`
  );
}

export function noContacts(settings: VoiceSettings): string {
  return sayAndHangup(
    settings,
    `You don't have any contacts yet. Add one in the app, then call again. ${BYE}`
  );
}

export interface GatherPromptOptions {
  settings: VoiceSettings;
  actionUrl: string;
  /** Recognition hints, usually from `contactHints`. */
  hints: string[];
  /** Greets the caller by name on the first prompt of a call. */
  callerFirstName?: string;
  /** What Twilio recognised on the previous attempt when it did not match. */
  heard?: string;
  /** The previous attempt produced no speech and no digits. */
  noSpeech?: boolean;
}

/**
 * The "who would you like to call" prompt: one Gather that accepts speech
 * and keypad digits (R7). `actionOnEmptyResult` makes Twilio call the
 * action URL even on silence so the handler counts the attempt.
 *
 * The first prompt is a short greeting with no keypad hint, so the caller
 * can start talking sooner and less prompt audio leaks back through the
 * phone's microphone. The keypad is mentioned only after a miss.
 */
export function gatherPrompt(options: GatherPromptOptions): string {
  const twiml = response();
  const gather = twiml.gather({
    input: ["speech", "dtmf"],
    action: options.actionUrl,
    method: "POST",
    language: LANGUAGE,
    speechModel: options.settings.speechModel,
    speechTimeout: SPEECH_TIMEOUT,
    timeout: DTMF_TIMEOUT,
    actionOnEmptyResult: true,
    finishOnKey: "#",
    hints: hintsAttribute(options.hints),
  });
  say(gather, options.settings, gatherPromptText(options));
  return twiml.toString();
}

function gatherPromptText(options: GatherPromptOptions): string {
  if (options.heard) {
    return `I heard ${options.heard}, and I don't have that contact. Say the name again, or press their speed dial, then pound.`;
  }
  if (options.noSpeech) {
    return `Sorry, I didn't catch that. ${WHO_TO_CALL} ${KEYPAD_TIP}`;
  }
  if (options.callerFirstName !== undefined) {
    const greeting = options.callerFirstName
      ? `Hi ${options.callerFirstName}.`
      : "Hi.";
    return `${greeting} ${WHO_TO_CALL}`;
  }
  return `No problem. ${WHO_TO_CALL} ${KEYPAD_TIP}`;
}

export interface ConfirmPromptOptions {
  settings: VoiceSettings;
  actionUrl: string;
  contactName: string;
}

/**
 * Confirmation before dialing: one key or one word. Timeout counts as
 * "try again"; the handler treats anything but a clear yes the same way.
 */
export function confirmPrompt(options: ConfirmPromptOptions): string {
  const twiml = response();
  const gather = twiml.gather({
    input: ["speech", "dtmf"],
    action: options.actionUrl,
    method: "POST",
    language: LANGUAGE,
    speechModel: options.settings.speechModel,
    speechTimeout: SPEECH_TIMEOUT,
    hints: "yes, no, one, two",
    numDigits: 1,
    timeout: DTMF_TIMEOUT,
    actionOnEmptyResult: true,
  });
  say(
    gather,
    options.settings,
    `${options.contactName}. Press 1 or say yes to call, or 2 to try again.`
  );
  return twiml.toString();
}

export interface DisambiguationPromptOptions {
  settings: VoiceSettings;
  actionUrl: string;
  /** Candidates in rank order; only the first four are read out. */
  candidates: { name: string }[];
}

/** Numbered options when several contacts match closely. */
export function disambiguationPrompt(
  options: DisambiguationPromptOptions
): string {
  const twiml = response();
  const gather = twiml.gather({
    input: ["dtmf"],
    action: options.actionUrl,
    method: "POST",
    numDigits: 1,
    timeout: DTMF_TIMEOUT,
    actionOnEmptyResult: true,
  });
  const choices = options.candidates
    .slice(0, MAX_DISAMBIGUATION_OPTIONS)
    .map((candidate, index) => `${index + 1} for ${candidate.name}`)
    .join(", ");
  say(
    gather,
    options.settings,
    `I found a few. Press ${choices}. Press any other key to try again.`
  );
  return twiml.toString();
}

export interface KeypadFallbackPromptOptions {
  settings: VoiceSettings;
  actionUrl: string;
}

/** Keypad-only prompt for the speed-dial code. */
export function keypadFallbackPrompt(
  options: KeypadFallbackPromptOptions
): string {
  const twiml = response();
  const gather = twiml.gather({
    input: ["dtmf"],
    action: options.actionUrl,
    method: "POST",
    timeout: DTMF_TIMEOUT,
    finishOnKey: "#",
    actionOnEmptyResult: true,
  });
  say(
    gather,
    options.settings,
    "Let's try the keypad. Press their speed dial, then pound."
  );
  return twiml.toString();
}

/**
 * Returned to a duplicate confirmation that lost the compare-and-set race.
 * No hangup: the winning request's Dial is what the call is executing.
 */
export function alreadyConnecting(settings: VoiceSettings): string {
  const twiml = response();
  say(twiml, settings, "Your call is already connecting.");
  return twiml.toString();
}

export interface DialOptions {
  settings: VoiceSettings;
  /** Destination in E.164. */
  to: string;
  /** The bat phone number, shown to the contact. */
  callerId: string;
  /** Receives the dial outcome when the outbound leg ends. */
  actionUrl: string;
  /** Receives the recording status callback. */
  recordingStatusCallbackUrl: string;
  /** Receives the answering machine detection result for the outbound leg. */
  amdStatusCallbackUrl: string;
}

/**
 * Say "Connecting you now" and place the outbound call, recorded
 * dual-channel from answer (R9), with answering machine detection on the
 * outbound leg. DetectMessageEnd lets Twilio tell a greeting from a human;
 * the async status callback means the callee is bridged at once and the
 * verdict arrives on its own.
 */
export function dial(options: DialOptions): string {
  const twiml = response();
  say(twiml, options.settings, "Connecting you now.");
  const verb = twiml.dial({
    action: options.actionUrl,
    method: "POST",
    callerId: options.callerId,
    record: "record-from-answer-dual",
    timeLimit: DIAL_TIME_LIMIT_SEC,
    recordingStatusCallback: options.recordingStatusCallbackUrl,
    recordingStatusCallbackMethod: "POST",
    recordingStatusCallbackEvent: ["completed", "absent"],
  });
  verb.number(
    {
      machineDetection: "DetectMessageEnd",
      amdStatusCallback: options.amdStatusCallbackUrl,
      amdStatusCallbackMethod: "POST",
    },
    options.to
  );
  return twiml.toString();
}

export type PostDialOutcome = "busy" | "no-answer" | "failed" | "completed";

export interface PostDialOutcomeOptions {
  settings: VoiceSettings;
  /** The contact that was dialed, as snapshotted on the call row. */
  contactName: string;
}

function outcomeMessage(kind: PostDialOutcome, name: string): string {
  switch (kind) {
    case "busy":
      return `${name} is busy right now. Try again later. ${BYE}`;
    case "no-answer":
      return `${name} didn't pick up. Try again later. ${BYE}`;
    case "failed":
      return `I couldn't connect that call. ${BYE}`;
    case "completed":
      return BYE;
  }
}

/** Spoken after the outbound leg ends (R10), then hang up. */
export function postDialOutcome(
  kind: PostDialOutcome,
  options: PostDialOutcomeOptions
): string {
  return sayAndHangup(
    options.settings,
    outcomeMessage(kind, options.contactName)
  );
}

/** After three failed attempts, or when a callback cannot be bound to its call. */
export function goodbyeNotFound(settings: VoiceSettings): string {
  return sayAndHangup(
    settings,
    `I still couldn't find that contact. Check the name in the app and call again. ${BYE}`
  );
}

/**
 * Static TwiML for the number's voice fallback URL. Twilio requests that URL
 * when the primary voice webhook fails, for example while the codespace is
 * stopped, so this must not depend on the app being reachable.
 */
export function unavailable(settings: VoiceSettings): string {
  return sayAndHangup(
    settings,
    `Bat Phone is unavailable right now. Please try again later. ${BYE}`
  );
}

/** Spoken when a handler throws; a 5xx would make Twilio play "application error". */
export function apology(settings: VoiceSettings): string {
  return sayAndHangup(
    settings,
    `Sorry, something went wrong. Please try again later. ${BYE}`
  );
}
