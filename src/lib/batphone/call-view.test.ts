import { describe, expect, it } from "vitest";

import type { ResolutionAttempt } from "@/db/schema";

import {
  attemptLine,
  callActionVisibility,
  callHeader,
  callOutcome,
  isDryRunMessageId,
  outcomeBadgeVariant,
  processingNote,
} from "./call-view";

import type { CallStatus, StateRow } from "./state";

const NOW = new Date("2026-09-11T14:05:00.000Z");
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000);

function stateRow(overrides: Partial<StateRow> = {}): StateRow {
  return {
    status: "emailed",
    claimedAt: null,
    emailClaimedAt: null,
    recordingDurationSec: 60,
    inboundAt: minutesAgo(30),
    endedAt: minutesAgo(25),
    metadataEmailSentAt: null,
    ...overrides,
  };
}

function attempt(
  overrides: Partial<ResolutionAttempt> = {}
): ResolutionAttempt {
  return {
    id: "a1",
    callId: "call-1",
    attemptNumber: 1,
    inputKind: "speech",
    heardText: "my canderson",
    confidence: 0.55,
    normalizedQuery: "my canderson",
    candidates: [
      { contactId: "c-mike", name: "Mike Anderson", score: 0.71 },
      { contactId: "c-sarah", name: "Sarah Chen", score: 0.2 },
    ],
    decision: "match",
    chosenContactId: "c-mike",
    callerResponse: "retried",
    selectedPosition: null,
    createdAt: NOW,
    respondedAt: NOW,
    ...overrides,
  };
}

describe("callActionVisibility", () => {
  it("shows retry only for retryable states", () => {
    expect(
      callActionVisibility(stateRow({ status: "transcription_failed" }), NOW)
    ).toEqual({ retry: true, duplicateWarning: false, resync: false });
    expect(
      callActionVisibility(stateRow({ status: "email_failed" }), NOW).retry
    ).toBe(true);
    expect(callActionVisibility(stateRow({ status: "emailed" }), NOW)).toEqual({
      retry: false,
      duplicateWarning: false,
      resync: false,
    });
    expect(callActionVisibility(stateRow({ status: "busy" }), NOW).retry).toBe(
      false
    );
  });

  it("shows retry with the duplicate warning only for a stale emailing claim", () => {
    const stale = stateRow({
      status: "emailing",
      emailClaimedAt: minutesAgo(11),
    });
    expect(callActionVisibility(stale, NOW)).toEqual({
      retry: true,
      duplicateWarning: true,
      resync: false,
    });

    const fresh = stateRow({
      status: "emailing",
      emailClaimedAt: minutesAgo(2),
    });
    expect(callActionVisibility(fresh, NOW)).toEqual({
      retry: false,
      duplicateWarning: false,
      resync: false,
    });
  });

  it("shows resync only for stuck rows, never for a live call", () => {
    const stuck = stateRow({
      status: "awaiting_recording",
      endedAt: minutesAgo(11),
    });
    expect(callActionVisibility(stuck, NOW)).toEqual({
      retry: false,
      duplicateWarning: false,
      resync: true,
    });

    const live = stateRow({
      status: "dialing",
      endedAt: null,
      inboundAt: minutesAgo(12),
    });
    expect(callActionVisibility(live, NOW).resync).toBe(false);
  });
});

describe("attemptLine", () => {
  it("describes a speech attempt with its confidence, best match, and a retry", () => {
    expect(attemptLine(attempt())).toBe(
      'Attempt 1: you said "my canderson" (confidence 55%). Best match Mike Anderson. You pressed 2 to try again.'
    );
  });

  it("describes a digits attempt that matched and was confirmed", () => {
    expect(
      attemptLine(
        attempt({
          attemptNumber: 2,
          inputKind: "digits",
          heardText: "3",
          confidence: null,
          candidates: [{ contactId: "c-sarah", name: "Sarah Chen", score: 1 }],
          decision: "match",
          chosenContactId: "c-sarah",
          callerResponse: "confirmed",
        })
      )
    ).toBe("Attempt 2: you pressed 3. Matched Sarah Chen. You confirmed.");
  });

  it("describes a hung_up attempt", () => {
    expect(
      attemptLine(
        attempt({
          decision: "none",
          candidates: [],
          chosenContactId: null,
          callerResponse: "hung_up",
        })
      )
    ).toBe(
      'Attempt 1: you said "my canderson" (confidence 55%). No contact matched. You hung up.'
    );
  });

  it("describes an ambiguous attempt resolved by selection", () => {
    expect(
      attemptLine(
        attempt({
          decision: "ambiguous",
          chosenContactId: null,
          callerResponse: "selected",
          selectedPosition: 2,
        })
      )
    ).toBe(
      'Attempt 1: you said "my canderson" (confidence 55%). Close matches: Mike Anderson, Sarah Chen. You pressed 2 for Sarah Chen.'
    );
  });

  it("describes a timeout and an attempt still waiting", () => {
    expect(attemptLine(attempt({ callerResponse: "timeout" }))).toContain(
      "No key was pressed."
    );
    expect(attemptLine(attempt({ callerResponse: null }))).toContain(
      "No response yet."
    );
  });

  it("omits the confidence when Twilio did not report one", () => {
    expect(attemptLine(attempt({ confidence: null }))).toBe(
      'Attempt 1: you said "my canderson". Best match Mike Anderson. You pressed 2 to try again.'
    );
  });
});

describe("callOutcome", () => {
  const outcome = (
    status: CallStatus,
    answeredBy: string | null = null,
    callerSpoke: boolean | null = null
  ) => callOutcome({ status, answeredBy, callerSpoke });

  it("names the ends that never connected", () => {
    expect(outcome("not_found")).toEqual({
      label: "No contact found",
      tone: "red",
    });
    expect(outcome("abandoned")).toEqual({
      label: "Hung up early",
      tone: "muted",
    });
    expect(outcome("busy")).toEqual({ label: "Busy", tone: "red" });
    expect(outcome("no_answer")).toEqual({ label: "No answer", tone: "red" });
    expect(outcome("dial_failed")).toEqual({
      label: "Call failed",
      tone: "red",
    });
  });

  it("is in progress before the far side has answered", () => {
    for (const status of [
      "identifying",
      "dialing",
      "awaiting_recording",
    ] as const) {
      expect(outcome(status)).toEqual({
        label: "In progress",
        tone: "neutral",
      });
    }
    expect(outcome("identifying", "human")).toEqual({
      label: "In progress",
      tone: "neutral",
    });
  });

  it.each([true, false, null])(
    "does not infer voicemail or a saved message from callerSpoke=%s",
    (callerSpoke) => {
      for (const answeredBy of [
        "machine_start",
        "machine_end_beep",
        "machine_end_silence",
        "machine_end_other",
      ]) {
        for (const status of [
          "emailed",
          "no_recording",
          "transcription_failed",
          "dialing",
        ] as const) {
          expect(outcome(status, answeredBy, callerSpoke)).toEqual({
            label: "Automated answer",
            tone: "neutral",
          });
        }
      }
    }
  );

  it("is answered when the dial completed and no machine was detected", () => {
    for (const answeredBy of ["human", "unknown", null, "fax"]) {
      expect(outcome("emailed", answeredBy, true)).toEqual({
        label: "Answered",
        tone: "green",
      });
    }
    for (const status of [
      "transcribing",
      "transcribed",
      "emailing",
      "email_failed",
      "transcription_failed",
      "no_recording",
    ] as const) {
      expect(outcome(status, "human")).toEqual({
        label: "Answered",
        tone: "green",
      });
    }
    expect(outcome("awaiting_recording", "human")).toEqual({
      label: "Answered",
      tone: "green",
    });
  });

  it("maps every tone to a badge variant", () => {
    expect(outcomeBadgeVariant("green")).toBe("default");
    expect(outcomeBadgeVariant("neutral")).toBe("secondary");
    expect(outcomeBadgeVariant("red")).toBe("destructive");
    expect(outcomeBadgeVariant("muted")).toBe("outline");
  });
});

describe("processingNote", () => {
  it("names the pipeline step that is running or failed, and nothing otherwise", () => {
    expect(processingNote("transcribing")).toBe("Transcribing");
    expect(processingNote("transcription_failed")).toBe("Transcription failed");
    expect(processingNote("emailing")).toBe("Sending email");
    expect(processingNote("email_failed")).toBe("Email failed");
    for (const status of [
      "identifying",
      "dialing",
      "awaiting_recording",
      "transcribed",
      "emailed",
      "no_recording",
      "busy",
      "not_found",
    ] as const) {
      expect(processingNote(status)).toBeNull();
    }
  });
});

describe("callHeader", () => {
  it("produces the same rows as the email header", () => {
    const rows = callHeader({
      callerName: "Sanjeev",
      contactName: "Mike Anderson",
      destinationNumber: "+14155552671",
      startedAt: new Date("2026-09-11T21:42:00.000Z"),
      durationSec: 42,
      outcome: "Completed",
      timeZone: "America/Los_Angeles",
    });
    expect(rows).toEqual([
      ["Caller", "Sanjeev"],
      ["Destination", "Mike Anderson"],
      ["Phone Number", "+1 415 555 2671"],
      ["Call Start Time", "Sep 11, 2026, 2:42 PM"],
      ["Call Duration", "0:42"],
      ["Outcome", "Completed"],
    ]);
  });

  it("renders an unknown duration as a dash", () => {
    const rows = callHeader({
      callerName: "Sanjeev",
      contactName: "Mike Anderson",
      destinationNumber: "+14155552671",
      startedAt: NOW,
      durationSec: null,
      outcome: "Busy",
      timeZone: "UTC",
    });
    expect(rows[4]).toEqual(["Call Duration", "-"]);
  });
});

describe("isDryRunMessageId", () => {
  it("recognises the dry-run mailer's ids", () => {
    expect(isDryRunMessageId("dry-run-1757600000000")).toBe(true);
    expect(isDryRunMessageId("op-123")).toBe(false);
    expect(isDryRunMessageId(null)).toBe(false);
  });
});
