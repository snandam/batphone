// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import gatherDigits from "@/test/fixtures/twilio/gather-digits.json";
import gatherSpeech from "@/test/fixtures/twilio/gather-speech.json";
import {
  signedTwilioRequest,
  TEST_AUTH_TOKEN,
  TEST_PUBLIC_BASE_URL,
} from "@/test/twilio";

const {
  mockInsertEvent,
  mockGetCallById,
  mockListContactsForUser,
  mockInsertResolutionAttempt,
  mockMarkNotFound,
  mockClaimDialing,
  mockUpdateResolutionAttemptResponse,
} = vi.hoisted(() => ({
  mockInsertEvent: vi.fn(),
  mockGetCallById: vi.fn(),
  mockListContactsForUser: vi.fn(),
  mockInsertResolutionAttempt: vi.fn(),
  mockMarkNotFound: vi.fn(),
  mockClaimDialing: vi.fn(),
  mockUpdateResolutionAttemptResponse: vi.fn(),
}));

vi.mock("@/lib/batphone/calls-repo", () => ({
  insertEvent: mockInsertEvent,
  getCallById: mockGetCallById,
  listContactsForUser: mockListContactsForUser,
  insertResolutionAttempt: mockInsertResolutionAttempt,
  markNotFound: mockMarkNotFound,
  claimDialing: mockClaimDialing,
  updateResolutionAttemptResponse: mockUpdateResolutionAttemptResponse,
}));

import { POST } from "./route";

const PATH = "/api/twilio/gather";
const CONFIRM_URL = `${TEST_PUBLIC_BASE_URL}/api/twilio/confirm`;
const GATHER_URL = `${TEST_PUBLIC_BASE_URL}/api/twilio/gather`;
const NOW = new Date("2026-09-11T14:00:00.000Z");

const MIKE_ANDERSON = {
  id: "c1",
  name: "Mike Anderson",
  phone: "+15559876543",
  speedDial: 1,
};
const SARAH_CHEN = {
  id: "c2",
  name: "Sarah Chen",
  phone: "+15559876544",
  speedDial: 2,
};
const MIKE_BROWN = {
  id: "c3",
  name: "Mike Brown",
  phone: "+15559876545",
  speedDial: 3,
};
/** Same number as Mike Anderson (R27, AE13). */
const MIKE_WORK = {
  id: "c4",
  name: "Mike (work)",
  phone: MIKE_ANDERSON.phone,
  speedDial: 4,
};
const CONTACTS = [MIKE_ANDERSON, SARAH_CHEN];

function callRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "call-1",
    userId: "user-1",
    twilioCallSid: gatherSpeech.CallSid,
    fromNumber: gatherSpeech.From,
    status: "identifying",
    inboundAt: NOW,
    ...overrides,
  };
}

function query(values: Record<string, string>): string {
  return `?${new URLSearchParams(values).toString()}`;
}

function gatherRequest(
  params: Record<string, string>,
  queryValues: Record<string, string> = { callId: "call-1", attempt: "1" }
) {
  return signedTwilioRequest({ path: PATH, params, query: query(queryValues) });
}

/** The fixture with SpeechResult replaced (and Confidence dropped when empty). */
function speech(
  result: string,
  confidence: string | null = gatherSpeech.Confidence
): Record<string, string> {
  const params: Record<string, string> = { ...gatherSpeech };
  delete params.SpeechResult;
  delete params.Confidence;
  if (result !== "") params.SpeechResult = result;
  if (confidence !== null) params.Confidence = confidence;
  return params;
}

function digits(value: string): Record<string, string> {
  return { ...gatherDigits, Digits: value };
}

async function post(request: Request) {
  const response = await POST(request);
  return { response, xml: await response.text() };
}

function noWrites() {
  expect(mockInsertResolutionAttempt).not.toHaveBeenCalled();
  expect(mockMarkNotFound).not.toHaveBeenCalled();
  expect(mockClaimDialing).not.toHaveBeenCalled();
  expect(mockUpdateResolutionAttemptResponse).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  vi.stubEnv("PUBLIC_BASE_URL", TEST_PUBLIC_BASE_URL);
  vi.stubEnv("TWILIO_AUTH_TOKEN", TEST_AUTH_TOKEN);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockInsertEvent.mockResolvedValue(undefined);
  mockGetCallById.mockResolvedValue(callRow());
  mockListContactsForUser.mockResolvedValue(CONTACTS);
  mockInsertResolutionAttempt.mockResolvedValue("attempt-1");
  mockMarkNotFound.mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/twilio/gather request contract", () => {
  it("rejects an unsigned request with 403 and records nothing", async () => {
    const response = await POST(
      signedTwilioRequest({
        path: PATH,
        params: gatherSpeech,
        query: query({ callId: "call-1", attempt: "1" }),
        omitSignature: true,
      })
    );
    expect(response.status).toBe(403);
    expect(mockInsertEvent).not.toHaveBeenCalled();
    noWrites();
  });

  it("records the event as gather before acting", async () => {
    await post(gatherRequest(gatherSpeech));
    expect(mockInsertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        callSid: gatherSpeech.CallSid,
        eventKind: "gather",
        payload: expect.objectContaining({
          SpeechResult: gatherSpeech.SpeechResult,
        }),
      })
    );
    const order = [
      mockInsertEvent.mock.invocationCallOrder[0] ?? Infinity,
      mockInsertResolutionAttempt.mock.invocationCallOrder[0] ?? -Infinity,
    ];
    expect(order[0]).toBeLessThan(order[1] as number);
  });

  it("an unknown call id returns the apology with no writes", async () => {
    mockGetCallById.mockResolvedValue(null);
    const { response, xml } = await post(gatherRequest(gatherSpeech));
    expect(response.status).toBe(200);
    expect(xml).toContain("Sorry, something went wrong");
    expect(xml).toContain("<Hangup/>");
    noWrites();
  });

  it("a CallSid that does not match the row returns goodbye with no writes", async () => {
    const { xml } = await post(
      gatherRequest({ ...gatherSpeech, CallSid: "CAother" })
    );
    expect(xml).toContain("couldn't find that contact");
    expect(xml).toContain("<Hangup/>");
    noWrites();
    expect(mockListContactsForUser).not.toHaveBeenCalled();
  });

  it("a row already dialing hears already-connecting and nothing is written", async () => {
    mockGetCallById.mockResolvedValue(callRow({ status: "dialing" }));
    const { xml } = await post(gatherRequest(gatherSpeech));
    expect(xml).toContain("already connecting");
    expect(xml).not.toContain("<Gather");
    noWrites();
  });

  it("a row already abandoned hears goodbye and nothing is written", async () => {
    mockGetCallById.mockResolvedValue(callRow({ status: "abandoned" }));
    const { xml } = await post(gatherRequest(gatherSpeech));
    expect(xml).toContain("couldn't find that contact");
    noWrites();
  });

  it("a thrown error returns the apology TwiML", async () => {
    mockListContactsForUser.mockRejectedValue(new Error("db down"));
    const { response, xml } = await post(gatherRequest(gatherSpeech));
    expect(response.status).toBe(200);
    expect(xml).toContain("Sorry, something went wrong");
  });
});

describe("POST /api/twilio/gather speech", () => {
  it("AE2: a confident match returns the confirmation gather naming the contact with the contact id in the confirm URL", async () => {
    const { xml } = await post(gatherRequest(gatherSpeech));

    expect(xml).toContain(
      "Mike Anderson. Press 1 or say yes to call, or 2 to try again."
    );
    expect(xml).toContain('numDigits="1"');
    expect(xml).toContain('input="speech dtmf"');
    expect(xml).toContain(
      `action="${CONFIRM_URL}?callId=call-1&amp;attempt=1&amp;attemptId=attempt-1&amp;contactId=c1"`
    );
    expect(xml).not.toContain("<Dial");
    expect(mockClaimDialing).not.toHaveBeenCalled();
  });

  it("AE12: the attempt is stored before replying with heard text, confidence, ordered candidates with scores, decision match, and the chosen contact", async () => {
    await post(gatherRequest(speech("my canderson", "0.55")));

    expect(mockInsertResolutionAttempt).toHaveBeenCalledTimes(1);
    const stored = mockInsertResolutionAttempt.mock.calls[0]?.[0];
    expect(stored).toMatchObject({
      callId: "call-1",
      attemptNumber: 1,
      inputKind: "speech",
      heardText: "my canderson",
      confidence: 0.55,
      normalizedQuery: "my canderson",
      decision: "match",
      chosenContactId: MIKE_ANDERSON.id,
    });
    expect(
      stored.candidates.map((c: { contactId: string }) => c.contactId)
    ).toEqual([MIKE_ANDERSON.id, SARAH_CHEN.id]);
    for (const candidate of stored.candidates) {
      expect(candidate).toEqual({
        contactId: expect.any(String),
        name: expect.any(String),
        score: expect.any(Number),
      });
    }
    expect(stored.candidates[0].score).toBeGreaterThan(
      stored.candidates[1].score
    );
  });

  it("AE3: an ambiguous first name lists both Mikes with numbers and carries the ordered candidate ids", async () => {
    mockListContactsForUser.mockResolvedValue([
      MIKE_ANDERSON,
      SARAH_CHEN,
      MIKE_BROWN,
    ]);

    const { xml } = await post(gatherRequest(speech("mike")));

    expect(xml).toContain(
      "I found a few. Press 1 for Mike Anderson, 2 for Mike Brown."
    );
    expect(xml).not.toContain("3 for");
    expect(xml).toContain('numDigits="1"');
    expect(xml).toContain(
      `action="${CONFIRM_URL}?callId=call-1&amp;attempt=1&amp;attemptId=attempt-1&amp;candidates=c1%2Cc3"`
    );
    expect(mockInsertResolutionAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "ambiguous",
        chosenContactId: null,
        heardText: "mike",
      })
    );
  });

  it("AE13: two Mikes on the same number skip disambiguation and confirm the higher-scoring one", async () => {
    mockListContactsForUser.mockResolvedValue([
      MIKE_ANDERSON,
      SARAH_CHEN,
      MIKE_WORK,
    ]);

    const { xml } = await post(gatherRequest(speech("mike")));

    expect(xml).toContain("Mike Anderson. Press 1 or say yes to call");
    expect(xml).not.toContain("I found a few");
    expect(xml).toContain("contactId=c1");
    expect(mockInsertResolutionAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "match", chosenContactId: "c1" })
    );
  });

  it("AE13: three Mikes where only two share a number still disambiguate", async () => {
    mockListContactsForUser.mockResolvedValue([
      MIKE_ANDERSON,
      MIKE_BROWN,
      MIKE_WORK,
    ]);

    const { xml } = await post(gatherRequest(speech("mike")));

    expect(xml).toContain(
      "I found a few. Press 1 for Mike Anderson, 2 for Mike Brown, 3 for Mike (work)."
    );
    expect(xml).toContain("candidates=c1%2Cc3%2Cc4");
  });

  it("no match on attempt 1 stores decision none and reprompts with what was heard for attempt 2", async () => {
    const { xml } = await post(gatherRequest(speech("nobody here")));

    expect(xml).toContain(
      "I heard nobody here, and I don't have that contact. Say the name again, or press their speed dial, then pound."
    );
    expect(xml).toContain(
      'hints="Mike Anderson, Sarah Chen, Mike, Sarah, call Mike Anderson, call Sarah Chen, call Mike, call Sarah"'
    );
    expect(xml).toContain(`action="${GATHER_URL}?callId=call-1&amp;attempt=2"`);
    expect(mockInsertResolutionAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "none",
        chosenContactId: null,
        heardText: "nobody here",
        normalizedQuery: "nobody here",
        candidates: expect.any(Array),
      })
    );
    expect(mockMarkNotFound).not.toHaveBeenCalled();
  });

  it("an empty result stores heard text empty, no confidence, and reprompts saying nothing was heard", async () => {
    const { xml } = await post(gatherRequest(speech("", null)));

    expect(xml).toContain(
      "Sorry, I didn't catch that. Who would you like to call? You can also press their speed dial, then pound."
    );
    expect(xml).not.toContain("I heard");
    expect(mockInsertResolutionAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        inputKind: "speech",
        heardText: "",
        confidence: null,
        normalizedQuery: "",
        candidates: [],
        decision: "none",
      })
    );
  });

  it("escapes the recognised speech when it is spoken back", async () => {
    const { xml } = await post(gatherRequest(speech("<script>&")));
    expect(xml).not.toContain("<script>");
    expect(xml).toContain("&lt;script&gt;&amp;");
  });

  it("a failure on attempt 2 returns the keypad fallback for attempt 3", async () => {
    const { xml } = await post(
      gatherRequest(speech("nobody here"), { callId: "call-1", attempt: "2" })
    );

    expect(xml).toContain(
      "Let's try the keypad. Press their speed dial, then pound."
    );
    expect(xml).toContain('input="dtmf"');
    expect(xml).toContain(`action="${GATHER_URL}?callId=call-1&amp;attempt=3"`);
    expect(mockInsertResolutionAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ attemptNumber: 2 })
    );
    expect(mockMarkNotFound).not.toHaveBeenCalled();
  });

  it("a failure on attempt 3 stores the attempt, marks the row not_found, and says goodbye", async () => {
    const { xml } = await post(
      gatherRequest(speech("", null), { callId: "call-1", attempt: "3" })
    );

    expect(xml).toContain("couldn't find that contact");
    expect(xml).toContain("<Hangup/>");
    expect(xml).not.toContain("<Gather");
    expect(mockInsertResolutionAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ attemptNumber: 3, decision: "none" })
    );
    expect(mockMarkNotFound).toHaveBeenCalledWith("call-1");
  });
});

describe("POST /api/twilio/gather digits", () => {
  it("AE4: digits matching a speed-dial code proceed to the confirmation prompt for that contact", async () => {
    const { xml } = await post(gatherRequest(gatherDigits));

    expect(xml).toContain("Sarah Chen. Press 1 or say yes to call");
    expect(xml).toContain(
      `action="${CONFIRM_URL}?callId=call-1&amp;attempt=1&amp;attemptId=attempt-1&amp;contactId=c2"`
    );
  });

  it("a digits gather stores input digits with the code as heard text and no confidence", async () => {
    await post(gatherRequest(gatherDigits));

    expect(mockInsertResolutionAttempt).toHaveBeenCalledWith({
      callId: "call-1",
      attemptNumber: 1,
      inputKind: "digits",
      heardText: "2",
      confidence: null,
      normalizedQuery: "2",
      candidates: [
        { contactId: SARAH_CHEN.id, name: SARAH_CHEN.name, score: 1 },
      ],
      decision: "match",
      chosenContactId: SARAH_CHEN.id,
    });
  });

  it("digits with no matching code store decision none and reprompt", async () => {
    const { xml } = await post(gatherRequest(digits("9")));

    expect(xml).toContain("I heard 9, and I don't have that contact.");
    expect(xml).toContain(`action="${GATHER_URL}?callId=call-1&amp;attempt=2"`);
    expect(mockInsertResolutionAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        inputKind: "digits",
        heardText: "9",
        decision: "none",
        candidates: [],
      })
    );
  });

  it("digits take precedence over a stray speech result", async () => {
    const { xml } = await post(gatherRequest({ ...gatherSpeech, Digits: "1" }));
    expect(xml).toContain("Mike Anderson. Press 1 or say yes to call");
    expect(mockInsertResolutionAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ inputKind: "digits", heardText: "1" })
    );
  });
});
