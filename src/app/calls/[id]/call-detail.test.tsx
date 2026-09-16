import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CallDetailData } from "@/actions/calls";
import type { Call, ResolutionAttempt } from "@/db/schema";

vi.mock("@/actions/calls", () => ({
  retryCall: vi.fn(),
  resyncCall: vi.fn(),
}));

import { CallDetail } from "./call-detail";

const NOW = new Date("2026-09-11T14:05:00.000Z");
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000);
const TIMEZONE = "America/Los_Angeles";

function callRow(overrides: Partial<Call> = {}): Call {
  return {
    id: "call-1",
    userId: "user-1",
    contactId: "c-mike",
    contactNameSnapshot: "Mike Anderson",
    destinationNumberSnapshot: "+14155552671",
    fromNumber: "+15551234567",
    twilioCallSid: "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    dialCallSid: null,
    recordingSid: "REcccccccccccccccccccccccccccccccc",
    recordingStatus: "completed",
    status: "emailed",
    claimToken: null,
    claimedAt: null,
    lastError: null,
    transcribeAttempts: 1,
    inboundAt: minutesAgo(40),
    endedAt: minutesAgo(38),
    recordingStartedAt: new Date("2026-09-11T21:42:00.000Z"),
    recordingDurationSec: 42,
    dialDurationSec: 45,
    transcript: {
      model: "nova-3",
      requestId: "req-1",
      channelConfidence: [0.98, 0.97],
      identicalChannels: false,
      channels: 2,
      empty: false,
      utterances: [
        {
          channel: 0,
          start: 0.1,
          end: 1.2,
          text: "Hi Mike.",
          confidence: 0.99,
        },
        {
          channel: 1,
          start: 1.5,
          end: 2.8,
          text: "Hey, what's up?",
          confidence: 0.97,
        },
      ],
    },
    transcriptText: "You: Hi Mike.\nMike Anderson: Hey, what's up?",
    emailAttempts: 1,
    emailClaimedAt: null,
    lastEmailError: null,
    metadataEmailSentAt: null,
    transcriptEmailSentAt: minutesAgo(30),
    emailMessageId: "op-123",
    emailedTo: "sanjeev@example.com",
    answeredBy: "human",
    machineDetectionDurationMs: 1300,
    callerSpoke: true,
    createdAt: minutesAgo(40),
    updatedAt: minutesAgo(30),
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

function detail(
  callOverrides: Partial<Call> = {},
  attempts: ResolutionAttempt[] = []
): CallDetailData {
  return {
    call: callRow(callOverrides),
    attempts,
    timeZone: TIMEZONE,
    callerName: "Sanjeev",
  };
}

function renderDetail(
  callOverrides: Partial<Call> = {},
  attempts: ResolutionAttempt[] = []
) {
  return render(
    <CallDetail detail={detail(callOverrides, attempts)} now={NOW} />
  );
}

describe("CallDetail header and transcript", () => {
  it("renders the same header rows as the email, in the stored zone", () => {
    renderDetail();
    expect(screen.getByText("Caller")).toBeInTheDocument();
    expect(screen.getByText("Sanjeev")).toBeInTheDocument();
    expect(screen.getByText("Destination")).toBeInTheDocument();
    expect(screen.getByText("Phone Number")).toBeInTheDocument();
    expect(screen.getByText("+1 415 555 2671")).toBeInTheDocument();
    expect(screen.getByText("Call Start Time")).toBeInTheDocument();
    // Once in the page subtitle, once in the header rows.
    expect(screen.getAllByText("Sep 11, 2026, 2:42 PM")).toHaveLength(2);
    expect(screen.getByText("Call Duration")).toBeInTheDocument();
    expect(screen.getByText("0:42")).toBeInTheDocument();
    expect(screen.getByText("Outcome")).toBeInTheDocument();
    // Once as the header badge, once in the Outcome row.
    expect(screen.getAllByText("Answered")).toHaveLength(2);
  });

  it("shows the automated answer outcome and labels the far side Automated system when a machine answered", () => {
    renderDetail({ answeredBy: "machine_end_beep", callerSpoke: true });
    expect(screen.getAllByText("Automated answer")).toHaveLength(2);
    expect(screen.getByText("Automated system")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    // The contact name stays in the title and the Destination row only.
    expect(screen.getAllByText("Mike Anderson")).toHaveLength(2);
  });

  it("shows the processing note beside the outcome while the pipeline is running", () => {
    renderDetail({ status: "transcribing", transcript: null, claimedAt: NOW });
    expect(screen.getAllByText("Answered")).toHaveLength(2);
    expect(screen.getAllByText("Transcribing").length).toBeGreaterThanOrEqual(
      1
    );
  });

  it("labels the transcript with You and the contact's name", () => {
    renderDetail();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("Hi Mike.")).toBeInTheDocument();
    expect(screen.getByText("Hey, what's up?")).toBeInTheDocument();
    const contactLabels = screen.getAllByText("Mike Anderson");
    expect(contactLabels.length).toBeGreaterThanOrEqual(2);
  });

  it("drops the speaker labels when the channels could not be separated", () => {
    renderDetail({
      transcript: {
        model: "nova-3",
        requestId: "req-1",
        channelConfidence: [0.9],
        identicalChannels: true,
        channels: 2,
        utterances: [
          { channel: 0, start: 0, end: 1, text: "Hi Mike.", confidence: 0.9 },
        ],
      },
    });
    expect(
      screen.getByText("Speakers could not be separated on this recording.")
    ).toBeInTheDocument();
    expect(screen.queryByText("You")).not.toBeInTheDocument();
  });

  it("renders an audio element pointing at the recording route when a recording exists", () => {
    const { container } = renderDetail();
    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(audio?.getAttribute("src")).toBe("/api/calls/call-1/recording.mp3");
    expect(audio?.hasAttribute("controls")).toBe(true);
    expect(audio?.getAttribute("preload")).toBe("metadata");
  });

  it("renders no audio element without a recording", () => {
    const { container } = renderDetail({
      recordingSid: null,
      recordingStatus: "absent",
      status: "no_recording",
      transcript: null,
    });
    expect(container.querySelector("audio")).toBeNull();
  });

  it("puts a helpful status above the recording and keeps technical errors collapsed", () => {
    renderDetail({
      status: "transcription_failed",
      lastError: "Deepgram HTTP 503",
      transcript: null,
      emailMessageId: "dry-run-1757600000000",
      metadataEmailSentAt: minutesAgo(1),
    });
    const error = screen.getByText("Deepgram HTTP 503");
    expect(error.closest("details")).not.toHaveAttribute("open");
    expect(
      screen.getByRole("region", { name: "Call status" })
    ).toHaveTextContent("We couldn’t finish the transcript");
    const status = screen.getByRole("region", { name: "Call status" });
    const recording = screen.getByRole("heading", { name: "Recording" });
    expect(
      status.compareDocumentPosition(recording) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getByText(/logged instead of sent/i)).toBeInTheDocument();
  });

  it("shows no dry-run marker for a real message id", () => {
    renderDetail();
    expect(
      screen.queryByText(/logged instead of sent/i)
    ).not.toBeInTheDocument();
  });
});

describe("CallDetail actions", () => {
  it("renders retry only for retryable states", () => {
    renderDetail({ status: "transcription_failed", transcript: null });
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /resync/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/might already have been sent/i)).toBeNull();
  });

  it("renders no actions for an emailed call", () => {
    renderDetail();
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /resync/i })).toBeNull();
  });

  it("renders the duplicate warning only for a possibly-sent row", () => {
    renderDetail({ status: "emailing", emailClaimedAt: minutesAgo(11) });
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(
      screen.getByText(/might already have been sent/i)
    ).toBeInTheDocument();
  });

  it("renders resync only for stuck rows and never for a live call", () => {
    renderDetail({
      status: "awaiting_recording",
      transcript: null,
      recordingSid: null,
      endedAt: minutesAgo(11),
    });
    expect(screen.getByRole("button", { name: /resync/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("never renders resync for a live call", () => {
    renderDetail({
      status: "dialing",
      transcript: null,
      recordingSid: null,
      endedAt: null,
      inboundAt: minutesAgo(12),
    });
    expect(screen.queryByRole("button", { name: /resync/i })).toBeNull();
  });
});

describe("CallDetail resolution attempts", () => {
  it("lists one plain-language line per attempt, including hung_up and digits attempts", () => {
    renderDetail(
      { status: "not_found", transcript: null, recordingSid: null },
      [
        attempt(),
        attempt({
          id: "a2",
          attemptNumber: 2,
          inputKind: "digits",
          heardText: "9",
          confidence: null,
          normalizedQuery: "9",
          candidates: [],
          decision: "none",
          chosenContactId: null,
          callerResponse: "retried",
        }),
        attempt({
          id: "a3",
          attemptNumber: 3,
          heardText: "jonathan",
          confidence: 0.4,
          candidates: [],
          decision: "none",
          chosenContactId: null,
          callerResponse: "hung_up",
        }),
      ]
    );

    expect(
      screen.getByText("How the bat phone understood you")
    ).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      'Attempt 1: you said "my canderson" (confidence 55%). Best match Mike Anderson. You pressed 2 to try again.',
      "Attempt 2: you pressed 9. No contact has that code. You pressed a key to try again.",
      'Attempt 3: you said "jonathan" (confidence 40%). No contact matched. You hung up.',
    ]);
  });

  it("shows no attempts section for a call with no attempts", () => {
    renderDetail();
    expect(screen.queryByText("How the bat phone understood you")).toBeNull();
  });
});
