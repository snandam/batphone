import { describe, expect, it } from "vitest";

import {
  ALLOWED_TRANSITIONS,
  CALL_STATUSES,
  callerSpoke,
  canTransition,
  isAutomatedAnswer,
  isPossiblySent,
  isRetryable,
  isStale,
  isStuck,
  statusBadge,
  type CallStatus,
  type StateRow,
  type StoredTranscript,
} from "./state";

function transcript(
  utterances: StoredTranscript["utterances"]
): StoredTranscript {
  return {
    model: "nova-3",
    requestId: "req-1",
    channelConfidence: [0.9, 0.9],
    identicalChannels: false,
    utterances,
  };
}

describe("callerSpoke", () => {
  it("is true when any utterance on the caller channel carries text", () => {
    expect(
      callerSpoke(
        transcript([
          {
            channel: 1,
            start: 0,
            end: 1,
            text: "Leave a message.",
            confidence: 0.9,
          },
          {
            channel: 0,
            start: 2,
            end: 3,
            text: "Hi, call me back.",
            confidence: 0.9,
          },
        ])
      )
    ).toBe(true);
  });

  it("is false when the caller channel is silent or blank", () => {
    expect(callerSpoke(transcript([]))).toBe(false);
    expect(
      callerSpoke(
        transcript([
          {
            channel: 1,
            start: 0,
            end: 1,
            text: "Leave a message.",
            confidence: 0.9,
          },
          { channel: 0, start: 2, end: 3, text: "   ", confidence: 0.1 },
        ])
      )
    ).toBe(false);
  });
});

describe("isAutomatedAnswer", () => {
  it("is true only for the machine results", () => {
    for (const value of [
      "machine_start",
      "machine_end_beep",
      "machine_end_silence",
      "machine_end_other",
    ]) {
      expect(isAutomatedAnswer(value)).toBe(true);
    }
    for (const value of ["human", "unknown", "fax", null, undefined, ""]) {
      expect(isAutomatedAnswer(value)).toBe(false);
    }
  });
});

/** Every edge in the plan's state diagram, in the order it is drawn there. */
const DIAGRAM_EDGES: [CallStatus, CallStatus][] = [
  ["identifying", "abandoned"],
  ["identifying", "identifying"],
  ["identifying", "not_found"],
  ["identifying", "dialing"],
  ["dialing", "busy"],
  ["dialing", "no_answer"],
  ["dialing", "dial_failed"],
  ["dialing", "awaiting_recording"],
  ["dialing", "no_recording"],
  ["dialing", "transcribing"],
  ["awaiting_recording", "no_recording"],
  ["no_recording", "awaiting_recording"],
  ["awaiting_recording", "transcribing"],
  ["transcribing", "transcription_failed"],
  ["transcribing", "transcribed"],
  ["transcribed", "emailing"],
  ["emailing", "email_failed"],
  ["emailing", "emailed"],
  ["transcription_failed", "transcribing"],
  ["email_failed", "emailing"],
];

const NOW = new Date("2026-09-11T12:00:00Z");
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000);

function row(overrides: Partial<StateRow> = {}): StateRow {
  return {
    status: "identifying",
    claimedAt: null,
    emailClaimedAt: null,
    recordingDurationSec: null,
    inboundAt: minutesAgo(1),
    endedAt: null,
    metadataEmailSentAt: null,
    ...overrides,
  };
}

describe("canTransition", () => {
  it.each(DIAGRAM_EDGES)("allows %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  const isEdge = (from: CallStatus, to: CallStatus) =>
    DIAGRAM_EDGES.some(([f, t]) => f === from && t === to);

  // The retry edges are drawn in both directions on purpose, so their
  // reverse is itself an edge and is excluded here.
  it.each(
    DIAGRAM_EDGES.filter(([from, to]) => from !== to && !isEdge(to, from))
  )("rejects the reverse %s <- %s", (from, to) => {
    expect(canTransition(to, from)).toBe(false);
  });

  it("allows the retry edges in both directions", () => {
    expect(canTransition("transcribing", "transcription_failed")).toBe(true);
    expect(canTransition("transcription_failed", "transcribing")).toBe(true);
    expect(canTransition("emailing", "email_failed")).toBe(true);
    expect(canTransition("email_failed", "emailing")).toBe(true);
  });

  it("lists exactly the diagram edges in ALLOWED_TRANSITIONS", () => {
    const listed = CALL_STATUSES.flatMap((from) =>
      [...ALLOWED_TRANSITIONS[from]].map((to) => `${from}->${to}`)
    ).sort();
    const drawn = DIAGRAM_EDGES.map(([from, to]) => `${from}->${to}`).sort();
    expect(listed).toEqual(drawn);
  });

  it("treats terminal statuses as having no exits", () => {
    for (const status of [
      "abandoned",
      "not_found",
      "busy",
      "no_answer",
      "dial_failed",
      "emailed",
    ] as const) {
      expect(ALLOWED_TRANSITIONS[status].size).toBe(0);
    }
  });
});

describe("isRetryable", () => {
  it("lets a persisted transcript resume email after a process interruption", () => {
    expect(isRetryable(row({ status: "transcribed" }), NOW)).toBe(true);
  });

  it("is true for transcription_failed", () => {
    expect(isRetryable(row({ status: "transcription_failed" }), NOW)).toBe(
      true
    );
  });

  it("is true for email_failed", () => {
    expect(isRetryable(row({ status: "email_failed" }), NOW)).toBe(true);
  });

  it("is false for emailed", () => {
    expect(isRetryable(row({ status: "emailed" }), NOW)).toBe(false);
  });

  it("is false for busy", () => {
    expect(isRetryable(row({ status: "busy" }), NOW)).toBe(false);
  });

  it("stays true for transcription_failed after the metadata email was sent", () => {
    expect(
      isRetryable(
        row({
          status: "transcription_failed",
          metadataEmailSentAt: minutesAgo(5),
        }),
        NOW
      )
    ).toBe(true);
  });

  it("is true for a stale transcribing claim", () => {
    expect(
      isRetryable(
        row({
          status: "transcribing",
          claimedAt: minutesAgo(13),
          recordingDurationSec: 60,
        }),
        NOW
      )
    ).toBe(true);
  });

  it("is false for a fresh transcribing claim", () => {
    expect(
      isRetryable(
        row({
          status: "transcribing",
          claimedAt: minutesAgo(1),
          recordingDurationSec: 60,
        }),
        NOW
      )
    ).toBe(false);
  });
});

describe("isStale", () => {
  // Allowance is ten minutes plus two seconds per recorded second, so a
  // one-minute recording gets twelve minutes.
  it("marks transcribing stale at thirteen minutes with a one-minute recording", () => {
    expect(
      isStale(
        row({
          status: "transcribing",
          claimedAt: minutesAgo(13),
          recordingDurationSec: 60,
        }),
        NOW
      )
    ).toBe(true);
  });

  it("keeps transcribing fresh at eleven minutes with a one-minute recording", () => {
    expect(
      isStale(
        row({
          status: "transcribing",
          claimedAt: minutesAgo(11),
          recordingDurationSec: 60,
        }),
        NOW
      )
    ).toBe(false);
  });

  it("marks transcribing stale at eleven minutes with a twenty-second recording", () => {
    expect(
      isStale(
        row({
          status: "transcribing",
          claimedAt: minutesAgo(11),
          recordingDurationSec: 20,
        }),
        NOW
      )
    ).toBe(true);
  });

  it("marks transcribing stale at eleven minutes with no recording duration", () => {
    expect(
      isStale(
        row({
          status: "transcribing",
          claimedAt: minutesAgo(11),
          recordingDurationSec: null,
        }),
        NOW
      )
    ).toBe(true);
  });

  it("keeps transcribing fresh at eleven minutes with a 30-minute recording", () => {
    expect(
      isStale(
        row({
          status: "transcribing",
          claimedAt: minutesAgo(11),
          recordingDurationSec: 30 * 60,
        }),
        NOW
      )
    ).toBe(false);
  });

  it("marks emailing stale at eleven minutes", () => {
    expect(
      isStale(row({ status: "emailing", emailClaimedAt: minutesAgo(11) }), NOW)
    ).toBe(true);
  });

  it("keeps emailing fresh at nine minutes", () => {
    expect(
      isStale(row({ status: "emailing", emailClaimedAt: minutesAgo(9) }), NOW)
    ).toBe(false);
  });

  it("is never stale for a status that holds no claim", () => {
    expect(
      isStale(row({ status: "transcribed", claimedAt: minutesAgo(60) }), NOW)
    ).toBe(false);
  });
});

describe("isPossiblySent", () => {
  it("is true for a stale emailing claim", () => {
    expect(
      isPossiblySent(
        row({ status: "emailing", emailClaimedAt: minutesAgo(11) }),
        NOW
      )
    ).toBe(true);
  });

  it("is false for a fresh emailing claim", () => {
    expect(
      isPossiblySent(
        row({ status: "emailing", emailClaimedAt: minutesAgo(2) }),
        NOW
      )
    ).toBe(false);
  });

  it("is false for email_failed", () => {
    expect(
      isPossiblySent(
        row({ status: "email_failed", emailClaimedAt: minutesAgo(30) }),
        NOW
      )
    ).toBe(false);
  });
});

describe("isStuck", () => {
  it("flags dialing with ended_at eleven minutes ago", () => {
    expect(
      isStuck(
        row({
          status: "dialing",
          inboundAt: minutesAgo(15),
          endedAt: minutesAgo(11),
        }),
        NOW
      )
    ).toBe(true);
  });

  it("does not flag a live call: ended_at null and inbound twelve minutes ago", () => {
    expect(
      isStuck(
        row({ status: "dialing", inboundAt: minutesAgo(12), endedAt: null }),
        NOW
      )
    ).toBe(false);
  });

  it("flags ended_at null and inbound 50 minutes ago", () => {
    expect(
      isStuck(
        row({ status: "dialing", inboundAt: minutesAgo(50), endedAt: null }),
        NOW
      )
    ).toBe(true);
  });

  it("applies the same rules to awaiting_recording", () => {
    expect(
      isStuck(
        row({
          status: "awaiting_recording",
          inboundAt: minutesAgo(20),
          endedAt: minutesAgo(11),
        }),
        NOW
      )
    ).toBe(true);
    expect(
      isStuck(
        row({
          status: "awaiting_recording",
          inboundAt: minutesAgo(20),
          endedAt: minutesAgo(2),
        }),
        NOW
      )
    ).toBe(false);
  });

  it("never flags a status outside dialing and awaiting_recording", () => {
    expect(
      isStuck(
        row({
          status: "transcribing",
          inboundAt: minutesAgo(90),
          endedAt: minutesAgo(80),
        }),
        NOW
      )
    ).toBe(false);
  });
});

describe("statusBadge", () => {
  it.each(CALL_STATUSES)("has a non-empty label for %s", (status) => {
    const label = statusBadge(status);
    expect(typeof label).toBe("string");
    expect(label.trim().length).toBeGreaterThan(0);
  });

  it("covers all fifteen statuses", () => {
    expect(CALL_STATUSES).toHaveLength(15);
  });

  it("uses plain language for not_found", () => {
    expect(statusBadge("not_found")).toBe("Couldn't find a contact");
  });
});
