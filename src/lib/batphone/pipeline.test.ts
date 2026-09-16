// @vitest-environment node
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import type { Call } from "@/db/schema";
import { TEST_PUBLIC_BASE_URL } from "@/test/twilio";

const {
  mockClaim,
  mockComplete,
  mockFail,
  mockGetCallForPipeline,
  mockGetCallById,
  mockListEventsForCall,
  mockWriteDialOutcome,
  mockWriteRecording,
  mockMarkRecordingAbsent,
} = vi.hoisted(() => ({
  mockClaim: vi.fn(),
  mockComplete: vi.fn(),
  mockFail: vi.fn(),
  mockGetCallForPipeline: vi.fn(),
  mockGetCallById: vi.fn(),
  mockListEventsForCall: vi.fn(),
  mockWriteDialOutcome: vi.fn(),
  mockWriteRecording: vi.fn(),
  mockMarkRecordingAbsent: vi.fn(),
}));

vi.mock("@/lib/batphone/calls-repo", () => ({
  claim: mockClaim,
  complete: mockComplete,
  fail: mockFail,
  getCallForPipeline: mockGetCallForPipeline,
  getCallById: mockGetCallById,
  listEventsForCall: mockListEventsForCall,
  writeDialOutcome: mockWriteDialOutcome,
  writeRecording: mockWriteRecording,
  markRecordingAbsent: mockMarkRecordingAbsent,
}));

import { formatInZone } from "./format";
import {
  callPageUrl,
  createTwilioRest,
  processRecording,
  resyncCall,
  retryCall,
  sendMetadataOnlyEmail,
  sendTranscriptEmail,
  type PipelineDeps,
  type TwilioRest,
} from "./pipeline";
import { EMPTY_TRANSCRIPT_TEXT, TranscriptionError } from "./transcription";

import type { Mailer, MailMessage } from "./mailer";
import type { StoredTranscript } from "./state";
import type { MergedTranscript, TranscriptionInput } from "./transcription";
import type { RecordingMedia } from "./twilio-media";

const NOW = new Date("2026-09-11T14:05:00.000Z");
const RECORDING_STARTED_AT = new Date("2026-09-11T14:02:15.000Z");
const INBOUND_AT = new Date("2026-09-11T14:01:00.000Z");
const CALL_ID = "call-1";
const CALL_SID = "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const RECORDING_SID = "REcccccccccccccccccccccccccccccccc";
const TRANSCRIBE_TOKEN = "token-transcribe";
const EMAIL_TOKEN = "token-email";
const CONTACT_NAME = "Mike Anderson";
const CONTACT_NUMBER = "+15559876543";
const CALLER_NUMBER = "+15551234567";
const USER = {
  email: "sanjeev@example.com",
  name: "Sanjeev",
  timezone: "America/Los_Angeles",
};
const WAV = new Uint8Array([82, 73, 70, 70]);

const STORED_TRANSCRIPT: StoredTranscript = {
  model: "nova-3",
  requestId: "req-1",
  channelConfidence: [0.98, 0.97],
  identicalChannels: false,
  channels: 2,
  empty: false,
  utterances: [
    { channel: 0, start: 0.1, end: 1.2, text: "Hi Mike.", confidence: 0.99 },
    {
      channel: 1,
      start: 1.5,
      end: 2.8,
      text: "Hey, what's up?",
      confidence: 0.97,
    },
  ],
};

function callRow(overrides: Partial<Call> = {}): Call {
  return {
    id: CALL_ID,
    userId: "user-1",
    twilioCallSid: CALL_SID,
    fromNumber: CALLER_NUMBER,
    contactId: "c1",
    contactNameSnapshot: CONTACT_NAME,
    destinationNumberSnapshot: CONTACT_NUMBER,
    status: "transcribing",
    claimToken: TRANSCRIBE_TOKEN,
    recordingSid: RECORDING_SID,
    recordingStatus: "completed",
    recordingStartedAt: RECORDING_STARTED_AT,
    recordingDurationSec: 42,
    dialDurationSec: 45,
    inboundAt: INBOUND_AT,
    transcript: STORED_TRANSCRIPT,
    transcriptText: `You: Hi Mike.\n${CONTACT_NAME}: Hey, what's up?`,
    transcribeAttempts: 1,
    emailAttempts: 0,
    ...overrides,
  } as Call;
}

function merged(overrides: Partial<MergedTranscript> = {}): MergedTranscript {
  return {
    ...STORED_TRANSCRIPT,
    channels: 2,
    empty: false,
    contactName: CONTACT_NAME,
    ...overrides,
  };
}

function mailerStub(): Mailer & { send: ReturnType<typeof vi.fn> } {
  return {
    name: "twilio",
    send: vi.fn(async () => ({ ok: true as const, messageId: "op-123" })),
  };
}

let mailer: ReturnType<typeof mailerStub>;
let fetchRecording: Mock<(recordingSid: string) => Promise<RecordingMedia>>;
let transcribe: Mock<
  (buffer: Uint8Array, input: TranscriptionInput) => Promise<MergedTranscript>
>;

function deps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    fetchRecording,
    transcribe,
    mailer,
    now: () => NOW,
    ...overrides,
  };
}

function sentMessage(index = 0): MailMessage {
  return mailer.send.mock.calls[index]?.[0] as MailMessage;
}

function loggedLines(): string[] {
  const spies = [
    console.info,
    console.warn,
    console.error,
  ] as unknown as ReturnType<typeof vi.fn>[];
  return spies.flatMap((spy) => spy.mock.calls.map((call) => String(call[0])));
}

function expectNoSensitiveLogs() {
  for (const line of loggedLines()) {
    expect(line).not.toContain(CONTACT_NUMBER);
    expect(line).not.toContain(CALLER_NUMBER);
    expect(line).not.toContain(CONTACT_NAME);
    expect(line).not.toContain(USER.email);
    expect(line).not.toContain("Hi Mike");
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PUBLIC_BASE_URL", TEST_PUBLIC_BASE_URL);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  mailer = mailerStub();
  fetchRecording = vi.fn(async () => ({
    buffer: WAV,
    channels: 2 as const,
    contentType: "audio/x-wav",
  }));
  transcribe = vi.fn(async () => merged());

  mockClaim.mockImplementation(
    async (_callId: string, options: { step: string }) => {
      if (options.step === "transcribing") {
        return callRow({
          status: "transcribing",
          claimToken: TRANSCRIBE_TOKEN,
        });
      }
      if (options.step === "emailing") {
        return callRow({
          status: "emailing",
          claimToken: EMAIL_TOKEN,
          emailAttempts: 1,
        });
      }
      return callRow({
        status: "transcription_failed",
        claimToken: EMAIL_TOKEN,
        emailAttempts: 1,
      });
    }
  );
  mockComplete.mockResolvedValue(true);
  mockFail.mockResolvedValue(true);
  mockGetCallForPipeline.mockImplementation(async () => ({
    call: callRow({ status: "emailing", claimToken: EMAIL_TOKEN }),
    user: USER,
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("callPageUrl", () => {
  it("links to the app's call page under the public base URL, never Twilio", () => {
    expect(callPageUrl(CALL_ID)).toBe(
      `${TEST_PUBLIC_BASE_URL}/calls/${CALL_ID}`
    );
  });
});

describe("processRecording happy path", () => {
  it("claims transcribing from awaiting_recording or dialing, transcribes, stores under the token, then emails", async () => {
    const result = await processRecording(CALL_ID, deps());

    expect(result).toBe("emailed");
    expect(mockClaim).toHaveBeenNthCalledWith(1, CALL_ID, {
      step: "transcribing",
      fromStatuses: ["awaiting_recording", "dialing"],
    });
    expect(fetchRecording).toHaveBeenCalledWith(RECORDING_SID);
    expect(transcribe).toHaveBeenCalledWith(WAV, {
      contactName: CONTACT_NAME,
      channels: 2,
    });

    const transcribedPatch = mockComplete.mock.calls[0];
    expect(transcribedPatch?.[0]).toBe(CALL_ID);
    expect(transcribedPatch?.[1]).toBe(TRANSCRIBE_TOKEN);
    expect(transcribedPatch?.[2]).toEqual({
      status: "transcribed",
      transcript: STORED_TRANSCRIPT,
      transcriptText: `You: Hi Mike.\n${CONTACT_NAME}: Hey, what's up?`,
      recordingStatus: "completed",
      callerSpoke: true,
    });
    expect(transcribedPatch?.[2].transcript).not.toHaveProperty("contactName");

    expect(mockClaim).toHaveBeenNthCalledWith(2, CALL_ID, {
      step: "emailing",
      fromStatuses: ["transcribed"],
    });
    expect(mailer.send).toHaveBeenCalledTimes(1);
    const message = sentMessage();
    expect(message.to).toBe(USER.email);
    expect(message.kind).toBe("transcript");
    expect(message.callId).toBe(CALL_ID);
    expect(message.subject).toContain(CONTACT_NAME);
    expect(message.text).toContain(`${TEST_PUBLIC_BASE_URL}/calls/${CALL_ID}`);
    expect(message.text).toContain("Hey, what's up?");
    expect(message.html).toContain("Hey, what&#39;s up?");

    expect(mockComplete).toHaveBeenNthCalledWith(2, CALL_ID, EMAIL_TOKEN, {
      status: "emailed",
      transcriptEmailSentAt: NOW,
      emailMessageId: "op-123",
      emailedTo: USER.email,
    });
    expect(mockFail).not.toHaveBeenCalled();
  });

  it("uses the recording start time and duration in the user's zone, with the dial values as fallback", async () => {
    await processRecording(CALL_ID, deps());
    const withRecording = sentMessage(0);
    expect(withRecording.text).toContain(
      `Call Start Time: ${formatInZone(RECORDING_STARTED_AT, USER.timezone)}`
    );
    expect(withRecording.text).toContain("Call Duration: 0:42");

    mockGetCallForPipeline.mockResolvedValue({
      call: callRow({
        status: "emailing",
        claimToken: EMAIL_TOKEN,
        recordingStartedAt: null,
        recordingDurationSec: null,
      }),
      user: USER,
    });
    await sendTranscriptEmail(CALL_ID, deps());
    const fallback = sentMessage(1);
    expect(fallback.text).toContain(
      `Call Start Time: ${formatInZone(INBOUND_AT, USER.timezone)}`
    );
    expect(fallback.text).toContain("Call Duration: 0:45");
  });

  it("stores the no-speech marker for an empty transcript and still moves to transcribed", async () => {
    transcribe.mockResolvedValue(merged({ empty: true, utterances: [] }));

    await processRecording(CALL_ID, deps());

    expect(mockComplete).toHaveBeenNthCalledWith(
      1,
      CALL_ID,
      TRANSCRIBE_TOKEN,
      expect.objectContaining({
        status: "transcribed",
        transcriptText: EMPTY_TRANSCRIPT_TEXT,
        transcript: expect.objectContaining({ empty: true, utterances: [] }),
        callerSpoke: false,
      })
    );
  });

  it("emails the automated answer outcome and labels the far side Automated system when a machine answered", async () => {
    mockGetCallForPipeline.mockResolvedValue({
      call: callRow({
        status: "emailing",
        claimToken: EMAIL_TOKEN,
        answeredBy: "machine_end_beep",
        callerSpoke: true,
      }),
      user: USER,
    });

    await processRecording(CALL_ID, deps());

    const message = sentMessage();
    expect(message.text).toContain("Outcome: Automated answer");
    expect(message.text).toContain("Automated system: Hey, what's up?");
    expect(message.text).not.toContain(`${CONTACT_NAME}: Hey`);
  });

  it("emails Answered as the outcome when a human answered", async () => {
    mockGetCallForPipeline.mockResolvedValue({
      call: callRow({
        status: "emailing",
        claimToken: EMAIL_TOKEN,
        answeredBy: "human",
        callerSpoke: true,
      }),
      user: USER,
    });

    await processRecording(CALL_ID, deps());

    expect(sentMessage().text).toContain("Outcome: Answered");
    expect(sentMessage().text).toContain(`${CONTACT_NAME}: Hey, what's up?`);
  });

  it("never logs numbers, names, addresses, or transcript text", async () => {
    await processRecording(CALL_ID, deps());
    expect(loggedLines().length).toBeGreaterThan(0);
    expectNoSensitiveLogs();
  });
});

describe("processRecording claims", () => {
  it("is a no-op when the row is already emailed (claim returns null)", async () => {
    mockClaim.mockResolvedValue(null);

    const result = await processRecording(CALL_ID, deps());

    expect(result).toBe("not_claimed");
    expect(fetchRecording).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
    expect(mockComplete).not.toHaveBeenCalled();
    expect(mockFail).not.toHaveBeenCalled();
  });

  it("with two concurrent invocations only the one that won the claim does any work", async () => {
    mockClaim
      .mockResolvedValueOnce(callRow({ status: "transcribing" }))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        callRow({ status: "emailing", claimToken: EMAIL_TOKEN })
      );

    const results = await Promise.all([
      processRecording(CALL_ID, deps()),
      processRecording(CALL_ID, deps()),
    ]);

    expect(results.sort()).toEqual(["emailed", "not_claimed"]);
    expect(fetchRecording).toHaveBeenCalledTimes(1);
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(mailer.send).toHaveBeenCalledTimes(1);
  });

  it("a completion write with a stale claim token updates zero rows, logs, and stops before any email", async () => {
    mockComplete.mockResolvedValueOnce(false);

    const result = await processRecording(CALL_ID, deps());

    expect(result).toBe("claim_lost");
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(mockClaim).toHaveBeenCalledTimes(1);
    expect(mailer.send).not.toHaveBeenCalled();
    expect(mockFail).not.toHaveBeenCalled();
    const warnings = vi
      .mocked(console.warn)
      .mock.calls.map((c) => String(c[0]));
    expect(warnings.some((line) => line.includes("claim_lost"))).toBe(true);
  });

  it("a claimed row without a recording SID fails the step and sends the metadata email", async () => {
    mockClaim.mockResolvedValueOnce(callRow({ recordingSid: null }));

    const result = await processRecording(CALL_ID, deps());

    expect(result).toBe("transcription_failed");
    expect(fetchRecording).not.toHaveBeenCalled();
    expect(mockFail).toHaveBeenCalledWith(CALL_ID, TRANSCRIBE_TOKEN, {
      status: "transcription_failed",
      lastError: expect.stringContaining("recording"),
    });
    expect(sentMessage().kind).toBe("metadata_only");
  });
});

describe("processRecording transcription failure (AE7)", () => {
  const deepgramDown = new TranscriptionError(
    "Deepgram request failed with HTTP 503: Service Unavailable",
    503,
    undefined
  );

  it("marks transcription_failed with the error under the token and sends the metadata-only email once", async () => {
    transcribe.mockRejectedValue(deepgramDown);

    const result = await processRecording(CALL_ID, deps());

    expect(result).toBe("transcription_failed");
    expect(mockFail).toHaveBeenCalledWith(CALL_ID, TRANSCRIBE_TOKEN, {
      status: "transcription_failed",
      lastError: "Deepgram request failed with HTTP 503: Service Unavailable",
    });
    expect(mockComplete).toHaveBeenCalledTimes(1);

    expect(mockClaim).toHaveBeenNthCalledWith(2, CALL_ID, {
      step: "metadata_email",
      fromStatuses: ["transcription_failed", "no_recording"],
    });
    expect(mailer.send).toHaveBeenCalledTimes(1);
    const message = sentMessage();
    expect(message.kind).toBe("metadata_only");
    expect(message.to).toBe(USER.email);
    expect(message.text).toContain("transcription failed");
    expect(message.text).toContain("Outcome: Answered");
    expect(message.text).not.toContain("Transcript\n");
    expect(message.text).toContain(`${TEST_PUBLIC_BASE_URL}/calls/${CALL_ID}`);

    expect(mockComplete).toHaveBeenCalledWith(CALL_ID, EMAIL_TOKEN, {
      metadataEmailSentAt: NOW,
      emailMessageId: "op-123",
      emailedTo: USER.email,
    });
    const metadataPatch = mockComplete.mock.calls[0]?.[2];
    expect(metadataPatch).not.toHaveProperty("status");
  });

  it("the attempt counter comes from the claim, and a second metadata claim on the same row sends nothing", async () => {
    transcribe.mockRejectedValue(deepgramDown);
    await processRecording(CALL_ID, deps());
    const infoLines = vi
      .mocked(console.info)
      .mock.calls.map((c) => String(c[0]));
    expect(
      infoLines.some(
        (line) =>
          line.includes("transcribe_claimed") && line.includes('"attempt":1')
      )
    ).toBe(true);

    mockClaim.mockResolvedValueOnce(null);
    const second = await sendMetadataOnlyEmail(
      CALL_ID,
      "transcription_failed",
      deps()
    );

    expect(second).toBe("not_claimed");
    expect(mailer.send).toHaveBeenCalledTimes(1);
  });

  it("a media fetch failure is also a transcription failure with its message stored", async () => {
    fetchRecording.mockRejectedValue(
      new Error("recording RE fetch failed: HTTP 404")
    );

    const result = await processRecording(CALL_ID, deps());

    expect(result).toBe("transcription_failed");
    expect(transcribe).not.toHaveBeenCalled();
    expect(mockFail).toHaveBeenCalledWith(CALL_ID, TRANSCRIBE_TOKEN, {
      status: "transcription_failed",
      lastError: "recording RE fetch failed: HTTP 404",
    });
  });

  it("a failure write that lost its claim stops without a metadata email", async () => {
    transcribe.mockRejectedValue(deepgramDown);
    mockFail.mockResolvedValueOnce(false);

    const result = await processRecording(CALL_ID, deps());

    expect(result).toBe("claim_lost");
    expect(mockClaim).toHaveBeenCalledTimes(1);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it("never logs numbers, names, or addresses on the failure path", async () => {
    transcribe.mockRejectedValue(deepgramDown);
    await processRecording(CALL_ID, deps());
    expectNoSensitiveLogs();
  });
});

describe("sendTranscriptEmail", () => {
  it("a rejected send sets email_failed with the joined message under the token", async () => {
    mailer.send.mockResolvedValue({
      ok: false,
      error: 'HTTP 400: {"errors":[{"message":"invalid address"}]}',
    });

    const result = await sendTranscriptEmail(CALL_ID, deps());

    expect(result).toBe("email_failed");
    expect(mockFail).toHaveBeenCalledWith(CALL_ID, EMAIL_TOKEN, {
      status: "email_failed",
      lastEmailError: 'HTTP 400: {"errors":[{"message":"invalid address"}]}',
    });
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("a mailer that throws is recorded the same way", async () => {
    mailer.send.mockRejectedValue(new Error("socket hang up"));

    const result = await sendTranscriptEmail(CALL_ID, deps());

    expect(result).toBe("email_failed");
    expect(mockFail).toHaveBeenCalledWith(CALL_ID, EMAIL_TOKEN, {
      status: "email_failed",
      lastEmailError: "socket hang up",
    });
  });

  it("a claim that returns null sends nothing", async () => {
    mockClaim.mockResolvedValue(null);

    const result = await sendTranscriptEmail(CALL_ID, deps());

    expect(result).toBe("not_claimed");
    expect(mailer.send).not.toHaveBeenCalled();
    expect(mockGetCallForPipeline).not.toHaveBeenCalled();
  });

  it("a completion after the claim was taken over updates zero rows and is logged", async () => {
    mockComplete.mockResolvedValue(false);

    const result = await sendTranscriptEmail(CALL_ID, deps());

    expect(result).toBe("claim_lost");
    expect(mailer.send).toHaveBeenCalledTimes(1);
    const warnings = vi
      .mocked(console.warn)
      .mock.calls.map((c) => String(c[0]));
    expect(warnings.some((line) => line.includes("claim_lost"))).toBe(true);
  });

  it("a row that vanished between claim and load fails the step rather than sending", async () => {
    mockGetCallForPipeline.mockResolvedValue(null);

    const result = await sendTranscriptEmail(CALL_ID, deps());

    expect(result).toBe("email_failed");
    expect(mailer.send).not.toHaveBeenCalled();
    expect(mockFail).toHaveBeenCalledWith(CALL_ID, EMAIL_TOKEN, {
      status: "email_failed",
      lastEmailError: expect.any(String),
    });
  });
});

describe("sendMetadataOnlyEmail", () => {
  it("for no_recording names the reason and leaves the status alone", async () => {
    mockClaim.mockResolvedValue(
      callRow({
        status: "no_recording",
        claimToken: EMAIL_TOKEN,
        recordingSid: null,
      })
    );
    mockGetCallForPipeline.mockResolvedValue({
      call: callRow({
        status: "no_recording",
        claimToken: EMAIL_TOKEN,
        recordingSid: null,
      }),
      user: USER,
    });

    const result = await sendMetadataOnlyEmail(CALL_ID, "no_recording", deps());

    expect(result).toBe("sent");
    expect(mockClaim).toHaveBeenCalledWith(CALL_ID, {
      step: "metadata_email",
      fromStatuses: ["transcription_failed", "no_recording"],
    });
    expect(sentMessage().text).toContain("no recording");
    expect(mockComplete).toHaveBeenCalledWith(CALL_ID, EMAIL_TOKEN, {
      metadataEmailSentAt: NOW,
      emailMessageId: "op-123",
      emailedTo: USER.email,
    });
  });

  it("a rejected send stores the error without changing the status", async () => {
    mailer.send.mockResolvedValue({ ok: false, error: "HTTP 500: upstream" });

    const result = await sendMetadataOnlyEmail(
      CALL_ID,
      "transcription_failed",
      deps()
    );

    expect(result).toBe("failed");
    expect(mockFail).toHaveBeenCalledWith(CALL_ID, EMAIL_TOKEN, {
      lastEmailError: "HTTP 500: upstream",
    });
  });

  it("a send after the claim token was taken over is skipped at the write", async () => {
    mockComplete.mockResolvedValue(false);

    const result = await sendMetadataOnlyEmail(
      CALL_ID,
      "transcription_failed",
      deps()
    );

    expect(result).toBe("claim_lost");
  });
});

// ---------------------------------------------------------------------------
// Retry and resync (U11)
// ---------------------------------------------------------------------------

const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000);

function claimSteps(): Array<{ step: string; fromStatuses: string[] }> {
  return mockClaim.mock.calls.map(
    ([, options]) => options as { step: string; fromStatuses: string[] }
  );
}

describe("retryCall", () => {
  it("transcription_failed: claims transcribing from that status and runs transcription and the email under the new token", async () => {
    mockGetCallById.mockResolvedValue(
      callRow({ status: "transcription_failed", claimToken: "old-token" })
    );

    const result = await retryCall(CALL_ID, {}, deps());

    expect(result).toBe("emailed");
    expect(claimSteps()[0]).toEqual({
      step: "transcribing",
      fromStatuses: ["transcription_failed"],
    });
    expect(fetchRecording).toHaveBeenCalledWith(RECORDING_SID);
    expect(mockComplete).toHaveBeenCalledWith(
      CALL_ID,
      TRANSCRIBE_TOKEN,
      expect.objectContaining({ status: "transcribed" })
    );
    expect(mockComplete).not.toHaveBeenCalledWith(
      CALL_ID,
      "old-token",
      expect.anything()
    );
    expect(sentMessage().kind).toBe("transcript");
    expectNoSensitiveLogs();
  });

  it("stale transcribing: claims transcribing from transcribing", async () => {
    mockGetCallById.mockResolvedValue(
      callRow({
        status: "transcribing",
        claimedAt: minutesAgo(13),
        recordingDurationSec: 60,
      })
    );

    await retryCall(CALL_ID, {}, deps());

    expect(claimSteps()[0]).toEqual({
      step: "transcribing",
      fromStatuses: ["transcribing"],
    });
  });

  it("transcribed: resumes email without fetching or transcribing the recording again", async () => {
    mockGetCallById.mockResolvedValue(callRow({ status: "transcribed" }));
    expect(await retryCall(CALL_ID, {}, deps())).toBe("emailed");
    expect(claimSteps()).toEqual([
      { step: "emailing", fromStatuses: ["transcribed"] },
    ]);
    expect(fetchRecording).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
    expect(sentMessage().kind).toBe("transcript");
  });

  it("email_failed: claims emailing from email_failed and resends the transcript email", async () => {
    mockGetCallById.mockResolvedValue(callRow({ status: "email_failed" }));

    const result = await retryCall(CALL_ID, {}, deps());

    expect(result).toBe("emailed");
    expect(claimSteps()).toEqual([
      { step: "emailing", fromStatuses: ["email_failed"] },
    ]);
    expect(fetchRecording).not.toHaveBeenCalled();
    expect(sentMessage().kind).toBe("transcript");
  });

  it("emailed: nothing to retry and no claim", async () => {
    mockGetCallById.mockResolvedValue(callRow({ status: "emailed" }));
    expect(await retryCall(CALL_ID, {}, deps())).toBe("nothing_to_retry");
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it("a fresh emailing claim is not retryable", async () => {
    mockGetCallById.mockResolvedValue(
      callRow({ status: "emailing", emailClaimedAt: minutesAgo(2) })
    );
    expect(await retryCall(CALL_ID, {}, deps())).toBe("nothing_to_retry");
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it("stale emailing: requires the confirm flag, then claims emailing from emailing", async () => {
    mockGetCallById.mockResolvedValue(
      callRow({ status: "emailing", emailClaimedAt: minutesAgo(11) })
    );

    expect(await retryCall(CALL_ID, {}, deps())).toBe("confirm_required");
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();

    const result = await retryCall(CALL_ID, { confirmDuplicate: true }, deps());

    expect(result).toBe("emailed");
    expect(claimSteps()).toEqual([
      { step: "emailing", fromStatuses: ["emailing"] },
    ]);
    expect(sentMessage().kind).toBe("transcript");
  });

  it("missing row: not_found", async () => {
    mockGetCallById.mockResolvedValue(null);
    expect(await retryCall(CALL_ID, {}, deps())).toBe("not_found");
  });
});

describe("resyncCall", () => {
  const CHILD_SID = "CAbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  let twilio: {
    getCall: Mock<TwilioRest["getCall"]>;
    listChildCalls: Mock<TwilioRest["listChildCalls"]>;
    listRecordings: Mock<TwilioRest["listRecordings"]>;
  };

  function parentCall(status = "completed") {
    return {
      sid: CALL_SID,
      status,
      duration: "60",
      end_time: "Fri, 11 Sep 2026 14:03:00 +0000",
      parent_call_sid: null,
    };
  }

  function childCall(status: string) {
    return {
      sid: CHILD_SID,
      status,
      duration: status === "completed" ? "45" : "0",
      end_time: "Fri, 11 Sep 2026 14:03:00 +0000",
      parent_call_sid: CALL_SID,
    };
  }

  function recording(status = "completed") {
    return {
      sid: RECORDING_SID,
      status,
      duration: "42",
      start_time: "Fri, 11 Sep 2026 14:02:15 +0000",
      call_sid: CALL_SID,
    };
  }

  beforeEach(() => {
    twilio = {
      getCall: vi.fn(async (sid: string) =>
        sid === CALL_SID
          ? parentCall()
          : sid === CHILD_SID
            ? childCall("completed")
            : null
      ),
      listChildCalls: vi.fn(async () => []),
      listRecordings: vi.fn(async () => []),
    };
    mockListEventsForCall.mockResolvedValue([]);
    mockWriteRecording.mockResolvedValue("stored");
    mockWriteDialOutcome.mockImplementation(
      async (_id: string, input: { outcome: string }) => ({
        row: callRow({
          status: input.outcome === "completed" ? "awaiting_recording" : "busy",
        }),
        transitioned: true,
      })
    );
    mockMarkRecordingAbsent.mockResolvedValue({
      row: callRow({ status: "no_recording", recordingStatus: "absent" }),
      transitioned: true,
    });
  });

  it("stuck awaiting_recording with a recording at Twilio: stores it and resumes the pipeline", async () => {
    mockGetCallById.mockResolvedValue(
      callRow({
        status: "awaiting_recording",
        recordingSid: null,
        recordingStatus: null,
        dialCallSid: CHILD_SID,
        endedAt: minutesAgo(11),
      })
    );
    twilio.listRecordings.mockResolvedValue([recording()]);

    const result = await resyncCall(CALL_ID, deps({ twilio }));

    expect(result).toBe("resumed");
    expect(mockListEventsForCall).toHaveBeenCalledWith(CALL_SID);
    expect(twilio.listRecordings).toHaveBeenCalledWith(CALL_SID);
    expect(mockWriteRecording).toHaveBeenCalledWith(CALL_ID, {
      recordingSid: RECORDING_SID,
      startedAt: RECORDING_STARTED_AT,
      durationSec: 42,
    });
    expect(claimSteps()[0]).toEqual({
      step: "transcribing",
      fromStatuses: ["awaiting_recording", "dialing"],
    });
    expect(sentMessage().kind).toBe("transcript");
    expect(mockMarkRecordingAbsent).not.toHaveBeenCalled();
    expectNoSensitiveLogs();
  });

  it("stuck dialing with the child call reported busy: marks busy without a claim", async () => {
    mockGetCallById.mockResolvedValue(
      callRow({
        status: "dialing",
        recordingSid: null,
        recordingStatus: null,
        dialCallSid: CHILD_SID,
        endedAt: minutesAgo(11),
      })
    );
    twilio.getCall.mockImplementation(async (sid: string) =>
      sid === CHILD_SID ? childCall("busy") : parentCall()
    );

    const result = await resyncCall(CALL_ID, deps({ twilio }));

    expect(result).toBe("dial_outcome");
    expect(twilio.getCall).toHaveBeenCalledWith(CHILD_SID);
    expect(mockWriteDialOutcome).toHaveBeenCalledWith(
      CALL_ID,
      expect.objectContaining({ dialCallSid: CHILD_SID, outcome: "busy" })
    );
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it("stuck dialing with no known child SID finds the child by parent and uses its outcome", async () => {
    mockGetCallById.mockResolvedValue(
      callRow({
        status: "dialing",
        recordingSid: null,
        dialCallSid: null,
        endedAt: minutesAgo(11),
      })
    );
    twilio.listChildCalls.mockResolvedValue([childCall("no-answer")]);

    const result = await resyncCall(CALL_ID, deps({ twilio }));

    expect(result).toBe("dial_outcome");
    expect(twilio.listChildCalls).toHaveBeenCalledWith(CALL_SID);
    expect(mockWriteDialOutcome).toHaveBeenCalledWith(
      CALL_ID,
      expect.objectContaining({ dialCallSid: CHILD_SID, outcome: "no-answer" })
    );
  });

  it("stuck awaiting_recording with nothing at Twilio: marks no_recording and sends the metadata email", async () => {
    mockGetCallById.mockResolvedValue(
      callRow({
        status: "awaiting_recording",
        recordingSid: null,
        recordingStatus: null,
        dialCallSid: CHILD_SID,
        endedAt: minutesAgo(11),
      })
    );
    mockGetCallForPipeline.mockResolvedValue({
      call: callRow({ status: "no_recording", recordingStatus: "absent" }),
      user: USER,
    });

    const result = await resyncCall(CALL_ID, deps({ twilio }));

    expect(result).toBe("no_recording");
    expect(mockWriteRecording).not.toHaveBeenCalled();
    expect(mockMarkRecordingAbsent).toHaveBeenCalledWith(CALL_ID);
    expect(claimSteps()).toEqual([
      {
        step: "metadata_email",
        fromStatuses: ["transcription_failed", "no_recording"],
      },
    ]);
    expect(sentMessage().kind).toBe("metadata_only");
  });

  it.each(["processing", "in-progress", "paused"])(
    "keeps a %s recording recoverable instead of marking it absent",
    async (status) => {
      mockGetCallById.mockResolvedValue(
        callRow({
          status: "awaiting_recording",
          recordingSid: null,
          dialCallSid: CHILD_SID,
          endedAt: minutesAgo(11),
        })
      );
      twilio.listRecordings.mockResolvedValue([recording(status)]);

      expect(await resyncCall(CALL_ID, deps({ twilio }))).toBe(
        "recording_pending"
      );
      expect(mockWriteRecording).not.toHaveBeenCalled();
      expect(mockMarkRecordingAbsent).not.toHaveBeenCalled();
      expect(mockClaim).not.toHaveBeenCalled();
      expect(mailer.send).not.toHaveBeenCalled();
    }
  );

  it("a live call is never resynced", async () => {
    mockGetCallById.mockResolvedValue(
      callRow({ status: "dialing", endedAt: null, inboundAt: minutesAgo(12) })
    );
    expect(await resyncCall(CALL_ID, deps({ twilio }))).toBe("not_stuck");
    expect(twilio.getCall).not.toHaveBeenCalled();
    expect(mockListEventsForCall).not.toHaveBeenCalled();
  });

  it("a terminal row is never resynced", async () => {
    mockGetCallById.mockResolvedValue(
      callRow({ status: "emailed", endedAt: minutesAgo(30) })
    );
    expect(await resyncCall(CALL_ID, deps({ twilio }))).toBe("not_stuck");
    expect(twilio.getCall).not.toHaveBeenCalled();
  });

  it("missing row: not_found", async () => {
    mockGetCallById.mockResolvedValue(null);
    expect(await resyncCall(CALL_ID, deps({ twilio }))).toBe("not_found");
  });
});

describe("createTwilioRest", () => {
  const KEY = {
    accountSid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    keySid: "SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    keySecret: "secret",
  };
  const AUTH = `Basic ${Buffer.from(`${KEY.keySid}:${KEY.keySecret}`).toString("base64")}`;

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  it("reads a call, the children by parent SID, and the recordings with API key auth", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith(`/Calls/${CALL_SID}.json`)) {
        return jsonResponse(200, { sid: CALL_SID, status: "completed" });
      }
      if (url.includes("/Calls.json?ParentCallSid=")) {
        return jsonResponse(200, {
          calls: [{ sid: "CAchild", status: "busy" }],
        });
      }
      if (url.endsWith(`/Calls/${CALL_SID}/Recordings.json`)) {
        return jsonResponse(200, {
          recordings: [{ sid: RECORDING_SID, status: "completed" }],
        });
      }
      return jsonResponse(404, { code: 20404 });
    });
    const rest = createTwilioRest({
      fetch: fetchMock as unknown as typeof fetch,
      apiKey: KEY,
    });

    expect(await rest.getCall(CALL_SID)).toMatchObject({ sid: CALL_SID });
    expect(await rest.listChildCalls(CALL_SID)).toEqual([
      expect.objectContaining({ sid: "CAchild", status: "busy" }),
    ]);
    expect(await rest.listRecordings(CALL_SID)).toEqual([
      expect.objectContaining({ sid: RECORDING_SID }),
    ]);
    expect(await rest.getCall("CAmissing")).toBeNull();

    for (const [url, init] of fetchMock.mock.calls as unknown as Array<
      [string, RequestInit]
    >) {
      expect(
        url.startsWith(
          `https://api.twilio.com/2010-04-01/Accounts/${KEY.accountSid}/`
        )
      ).toBe(true);
      expect(new Headers(init.headers).get("authorization")).toBe(AUTH);
    }
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/${KEY.accountSid}/Calls.json?ParentCallSid=${CALL_SID}`
    );
  });

  it("throws on a non-404 error status without leaking the URL", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(401, {}));
    const rest = createTwilioRest({
      fetch: fetchMock as unknown as typeof fetch,
      apiKey: KEY,
    });
    await expect(rest.getCall(CALL_SID)).rejects.toThrow(/HTTP 401/);
    await expect(rest.getCall(CALL_SID)).rejects.not.toThrow(/secret/);
  });
});
