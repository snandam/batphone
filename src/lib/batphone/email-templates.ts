/**
 * Email templates for the transcript email and the metadata-only email.
 *
 * Pure: no environment, no I/O. Every interpolated value is HTML-escaped
 * because contact names and the contact's speech are untrusted input that
 * lands in the inbox. HTML uses inline styles and no tables so it renders
 * the same in mobile mail clients; the plain-text body carries the same
 * metadata header, then the transcript, then the call page link.
 */

import { formatDuration, formatE164ForDisplay, formatInZone } from "./format";
import {
  isAutomatedAnswer,
  speakersSeparated,
  type StoredTranscript,
  type TranscriptUtterance,
} from "./state";

export type RenderedEmail = {
  subject: string;
  text: string;
  html: string;
};

export type CallEmailInput = {
  callerName: string;
  contactName: string;
  /** E.164; display-formatted by the template. */
  destinationNumber: string;
  startedAt: Date;
  durationSec: number | null;
  outcome: string;
  /** IANA zone stored on the user profile. */
  timeZone: string;
  /** Absolute URL of the call page in the app, never a Twilio media URL. */
  callPageUrl: string;
};

export type TranscriptEmailInput = CallEmailInput & {
  transcript: StoredTranscript;
  /** Raw Twilio AnsweredBy; a machine result relabels the far side "Automated system". */
  answeredBy?: string | null;
};

export type MetadataOnlyReason = "transcription_failed" | "no_recording";

export type MetadataOnlyEmailInput = CallEmailInput & {
  reason: MetadataOnlyReason;
};

const CALLER_CHANNEL = 0;
const CALLER_LABEL = "You";
const AUTOMATED_SYSTEM_LABEL = "Automated system";
const UNKNOWN_DURATION = "-";
const IDENTICAL_CHANNELS_NOTE =
  "Speakers could not be separated on this recording.";
const NO_SPEECH_NOTE = "No speech was detected.";

const REASON_TEXT: Record<MetadataOnlyReason, string> = {
  transcription_failed:
    "The recording was saved but transcription failed, so this email has no transcript. Open the call page to listen to the recording and retry the transcription.",
  no_recording:
    "This call ended with no recording, so there is no transcript. Open the call page to see the call details.",
};

const STYLE = {
  body: "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.5; color: #1a1a1a; margin: 0; padding: 16px;",
  heading: "font-size: 20px; font-weight: 600; margin: 0 0 16px 0;",
  meta: "margin: 0 0 4px 0;",
  section: "margin: 24px 0 8px 0; font-size: 16px; font-weight: 600;",
  note: "margin: 0 0 12px 0; color: #555555; font-style: italic;",
  line: "margin: 0 0 10px 0;",
  link: "margin: 24px 0 0 0;",
} as const;

/** Escapes the five characters that matter in HTML text and attributes. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type Header = {
  caller: string;
  destination: string;
  phoneNumber: string;
  startTime: string;
  duration: string;
  outcome: string;
};

function buildHeader(input: CallEmailInput): Header {
  return {
    caller: input.callerName,
    destination: input.contactName,
    phoneNumber: formatE164ForDisplay(input.destinationNumber),
    startTime: formatInZone(input.startedAt, input.timeZone),
    duration:
      input.durationSec === null
        ? UNKNOWN_DURATION
        : formatDuration(input.durationSec),
    outcome: input.outcome,
  };
}

function headerRows(header: Header): Array<[string, string]> {
  return [
    ["Caller", header.caller],
    ["Destination", header.destination],
    ["Phone Number", header.phoneNumber],
    ["Call Start Time", header.startTime],
    ["Call Duration", header.duration],
    ["Outcome", header.outcome],
  ];
}

/**
 * The metadata rows exactly as the emails print them, so the call detail
 * page can show the same header from the same code.
 */
export function emailHeaderRows(
  input: Omit<CallEmailInput, "callPageUrl">
): Array<[string, string]> {
  return headerRows(buildHeader({ ...input, callPageUrl: "" }));
}

function subjectLine(input: CallEmailInput, header: Header): string {
  return `Call with ${input.contactName}, ${header.duration}, ${header.startTime}`;
}

function headerText(header: Header): string {
  return headerRows(header)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

function headerHtml(header: Header): string {
  return headerRows(header)
    .map(
      ([label, value]) =>
        `<p style="${STYLE.meta}"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`
    )
    .join("\n");
}

/**
 * The label for the far side of the recording: the contact's name, or
 * "Automated system" when answering machine detection said a machine picked up.
 * Shared by the email and the call detail page so the two never disagree.
 */
export function contactSpeakerLabel(
  contactName: string,
  answeredBy: string | null | undefined
): string {
  return isAutomatedAnswer(answeredBy) ? AUTOMATED_SYSTEM_LABEL : contactName;
}

function speakerLabel(
  utterance: TranscriptUtterance,
  farSideLabel: string
): string {
  return utterance.channel === CALLER_CHANNEL ? CALLER_LABEL : farSideLabel;
}

function transcriptText(
  transcript: StoredTranscript,
  farSideLabel: string
): string {
  if (transcript.utterances.length === 0) return NO_SPEECH_NOTE;
  if (!speakersSeparated(transcript)) {
    const lines = transcript.utterances.map((u) => u.text);
    return [IDENTICAL_CHANNELS_NOTE, "", ...lines].join("\n");
  }
  return transcript.utterances
    .map((u) => `${speakerLabel(u, farSideLabel)}: ${u.text}`)
    .join("\n");
}

function transcriptHtml(
  transcript: StoredTranscript,
  farSideLabel: string
): string {
  if (transcript.utterances.length === 0) {
    return `<p style="${STYLE.note}">${escapeHtml(NO_SPEECH_NOTE)}</p>`;
  }
  if (!speakersSeparated(transcript)) {
    const lines = transcript.utterances
      .map((u) => `<p style="${STYLE.line}">${escapeHtml(u.text)}</p>`)
      .join("\n");
    return `<p style="${STYLE.note}">${escapeHtml(IDENTICAL_CHANNELS_NOTE)}</p>\n${lines}`;
  }
  return transcript.utterances
    .map(
      (u) =>
        `<p style="${STYLE.line}"><strong>${escapeHtml(speakerLabel(u, farSideLabel))}:</strong> ${escapeHtml(u.text)}</p>`
    )
    .join("\n");
}

function linkHtml(callPageUrl: string, label: string): string {
  const href = escapeHtml(callPageUrl);
  // clicktracking=off tells the SendGrid engine behind Twilio Email to leave
  // this link alone instead of wrapping it in a ct.sendgrid.net redirect.
  return `<p style="${STYLE.link}"><a clicktracking="off" href="${href}">${escapeHtml(label)}</a></p>`;
}

function wrapHtml(title: string, body: string): string {
  return [
    `<div style="${STYLE.body}">`,
    `<h1 style="${STYLE.heading}">${escapeHtml(title)}</h1>`,
    body,
    "</div>",
  ].join("\n");
}

/** The full email: metadata header, labelled transcript, call page link. */
export function renderTranscriptEmail(
  input: TranscriptEmailInput
): RenderedEmail {
  const header = buildHeader(input);
  const title = "Call Transcript";
  const linkLabel = "Open this call in Bat Phone";
  const farSideLabel = contactSpeakerLabel(input.contactName, input.answeredBy);

  const text = [
    title,
    "",
    headerText(header),
    "",
    "Transcript",
    "",
    transcriptText(input.transcript, farSideLabel),
    "",
    `${linkLabel}: ${input.callPageUrl}`,
  ].join("\n");

  const html = wrapHtml(
    title,
    [
      headerHtml(header),
      `<p style="${STYLE.section}">Transcript</p>`,
      transcriptHtml(input.transcript, farSideLabel),
      linkHtml(input.callPageUrl, linkLabel),
    ].join("\n")
  );

  return { subject: subjectLine(input, header), text, html };
}

/** The fallback email when there is no transcript to send. */
export function renderMetadataOnlyEmail(
  input: MetadataOnlyEmailInput
): RenderedEmail {
  const header = buildHeader(input);
  const title = "Call Summary";
  const reason = REASON_TEXT[input.reason];
  const linkLabel = "Open the call page";

  const text = [
    title,
    "",
    headerText(header),
    "",
    reason,
    "",
    `${linkLabel}: ${input.callPageUrl}`,
  ].join("\n");

  const html = wrapHtml(
    title,
    [
      headerHtml(header),
      `<p style="${STYLE.section}">${escapeHtml(reason)}</p>`,
      linkHtml(input.callPageUrl, linkLabel),
    ].join("\n")
  );

  return { subject: subjectLine(input, header), text, html };
}
