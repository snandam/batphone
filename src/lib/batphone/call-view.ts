/**
 * Call page view helpers
 *
 * Pure functions behind the history and detail pages: which actions a row
 * exposes, the plain-language line for each resolution attempt, the badge
 * tone per status, and the header rows shared with the emails. Keeping
 * these out of the components means the decisions are unit tested without
 * a DOM and the pages only lay them out.
 */

import type { ResolutionAttempt } from "@/db/schema";

import { emailHeaderRows, type CallEmailInput } from "./email-templates";
import {
  isPossiblySent,
  isRetryable,
  isStuck,
  isAutomatedAnswer,
  type CallStatus,
  type StateRow,
} from "./state";

export interface CallActionVisibility {
  /** Show the retry button (R20). */
  retry: boolean;
  /** The emailing claim is stale, so a retry may send a second email. */
  duplicateWarning: boolean;
  /** Show the resync button (R20): the row is stuck after the call ended. */
  resync: boolean;
}

export function callActionVisibility(
  row: StateRow,
  now: Date
): CallActionVisibility {
  return {
    retry: isRetryable(row, now),
    duplicateWarning: isPossiblySent(row, now),
    resync: isStuck(row, now),
  };
}

export type OutcomeTone = "green" | "neutral" | "red" | "muted";

export interface CallOutcome {
  label: string;
  tone: OutcomeTone;
}

export interface CallOutcomeInput {
  status: CallStatus;
  /** Raw Twilio AnsweredBy, null until the AMD callback arrives. */
  answeredBy: string | null;
  /** Null until the transcript is stored. */
  callerSpoke: boolean | null;
}

const NEVER_CONNECTED: Partial<Record<CallStatus, CallOutcome>> = {
  not_found: { label: "No contact found", tone: "red" },
  abandoned: { label: "Hung up early", tone: "muted" },
  busy: { label: "Busy", tone: "red" },
  no_answer: { label: "No answer", tone: "red" },
  dial_failed: { label: "Call failed", tone: "red" },
};

const IN_PROGRESS: CallOutcome = { label: "In progress", tone: "neutral" };

/** Statuses reached before the far side has answered. */
const PRE_ANSWER_STATUSES: ReadonlySet<CallStatus> = new Set<CallStatus>([
  "identifying",
  "dialing",
  "awaiting_recording",
]);

/**
 * What happened on the call, in the user's words, for the history badge,
 * the detail header, and the email's Outcome row. Ends that never
 * connected keep their own label; a live call is "In progress" until the
 * answering machine verdict arrives; a connected call is "Answered" or
 * "Automated answer". Machine detection cannot distinguish voicemail from
 * an IVR or automated agent, and caller speech does not prove a message was
 * left. Pipeline progress is a separate line, see
 * `processingNote`.
 */
export function callOutcome(input: CallOutcomeInput): CallOutcome {
  const never = NEVER_CONNECTED[input.status];
  if (never) return never;
  if (input.status === "identifying") return IN_PROGRESS;
  if (PRE_ANSWER_STATUSES.has(input.status) && input.answeredBy === null) {
    return IN_PROGRESS;
  }
  if (isAutomatedAnswer(input.answeredBy)) {
    return { label: "Automated answer", tone: "neutral" };
  }
  return { label: "Answered", tone: "green" };
}

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

const TONE_VARIANTS: Record<OutcomeTone, BadgeVariant> = {
  green: "default",
  neutral: "secondary",
  red: "destructive",
  muted: "outline",
};

/** The shadcn badge variant that renders an outcome tone. */
export function outcomeBadgeVariant(tone: OutcomeTone): BadgeVariant {
  return TONE_VARIANTS[tone];
}

const PROCESSING_NOTES: Partial<Record<CallStatus, string>> = {
  transcribing: "Transcribing",
  transcription_failed: "Transcription failed",
  emailing: "Sending email",
  email_failed: "Email failed",
};

/**
 * The pipeline step running or failed after the call, shown as a small
 * line under the outcome. Null when there is no processing update to show.
 */
export function processingNote(status: CallStatus): string | null {
  return PROCESSING_NOTES[status] ?? null;
}

export type CallHeaderInput = Omit<CallEmailInput, "callPageUrl">;

/** The metadata rows, identical to the email header. */
export function callHeader(input: CallHeaderInput): Array<[string, string]> {
  return emailHeaderRows(input);
}

/** The dry-run mailer records ids prefixed "dry-run-" instead of sending. */
export function isDryRunMessageId(messageId: string | null): boolean {
  return messageId !== null && messageId.startsWith("dry-run-");
}

type AttemptView = Pick<
  ResolutionAttempt,
  | "attemptNumber"
  | "inputKind"
  | "heardText"
  | "confidence"
  | "candidates"
  | "decision"
  | "chosenContactId"
  | "callerResponse"
  | "selectedPosition"
>;

function heardSentence(attempt: AttemptView): string {
  if (attempt.inputKind === "digits") {
    return `you pressed ${attempt.heardText}`;
  }
  const confidence =
    attempt.confidence === null
      ? ""
      : ` (confidence ${String(Math.round(attempt.confidence * 100))}%)`;
  return `you said "${attempt.heardText}"${confidence}`;
}

function decisionSentence(attempt: AttemptView): string {
  switch (attempt.decision) {
    case "match": {
      const chosen =
        attempt.candidates.find((c) => c.contactId === attempt.chosenContactId)
          ?.name ??
        attempt.candidates[0]?.name ??
        "a contact";
      return attempt.inputKind === "digits"
        ? `Matched ${chosen}.`
        : `Best match ${chosen}.`;
    }
    case "ambiguous":
      return `Close matches: ${attempt.candidates.map((c) => c.name).join(", ")}.`;
    case "none":
      return attempt.inputKind === "digits"
        ? "No contact has that code."
        : "No contact matched.";
  }
}

function responseSentence(attempt: AttemptView): string {
  switch (attempt.callerResponse) {
    case "confirmed":
      return "You confirmed.";
    case "retried":
      // After a single match the prompt offers 2 to try again; after no
      // match or a list the caller just pressed something else.
      return attempt.decision === "match" && attempt.inputKind === "speech"
        ? "You pressed 2 to try again."
        : "You pressed a key to try again.";
    case "selected": {
      const position = attempt.selectedPosition ?? 0;
      const picked = attempt.candidates[position - 1]?.name;
      return picked
        ? `You pressed ${String(position)} for ${picked}.`
        : `You pressed ${String(position)}.`;
    }
    case "timeout":
      return "No key was pressed.";
    case "hung_up":
      return "You hung up.";
    case null:
      return "No response yet.";
  }
}

/**
 * One plain-language line per attempt (R26), for example:
 * Attempt 1: you said "my canderson" (confidence 55%). Best match Mike
 * Anderson. You pressed 2 to try again.
 */
export function attemptLine(attempt: AttemptView): string {
  return `Attempt ${String(attempt.attemptNumber)}: ${heardSentence(attempt)}. ${decisionSentence(attempt)} ${responseSentence(attempt)}`;
}
