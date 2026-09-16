// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import confirmSpeechFixture from "@/test/fixtures/twilio/confirm-speech.json";
import confirmFixture from "@/test/fixtures/twilio/confirm.json";
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

const PATH = "/api/twilio/confirm";
const GATHER_URL = `${TEST_PUBLIC_BASE_URL}/api/twilio/gather`;
const DIAL_STATUS_URL = `${TEST_PUBLIC_BASE_URL}/api/twilio/dial-status`;
const RECORDING_URL = `${TEST_PUBLIC_BASE_URL}/api/twilio/recording`;
const AMD_STATUS_URL = `${TEST_PUBLIC_BASE_URL}/api/twilio/amd-status`;
const BAT_PHONE_NUMBER = "+15005550006";
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
const CONTACTS = [MIKE_ANDERSON, SARAH_CHEN, MIKE_BROWN];

function callRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "call-1",
    userId: "user-1",
    twilioCallSid: confirmFixture.CallSid,
    fromNumber: confirmFixture.From,
    status: "identifying",
    inboundAt: NOW,
    ...overrides,
  };
}

const SINGLE = {
  callId: "call-1",
  attempt: "1",
  attemptId: "attempt-1",
  contactId: "c1",
};
const SELECTION = {
  callId: "call-1",
  attempt: "1",
  attemptId: "attempt-1",
  candidates: "c1,c3",
};

function query(values: Record<string, string>): string {
  return `?${new URLSearchParams(values).toString()}`;
}

/** Digits null sends a timeout: no Digits field at all. */
function withDigits(digits: string | null): Record<string, string> {
  const params: Record<string, string> = { ...confirmFixture };
  delete params.Digits;
  if (digits !== null) params.Digits = digits;
  return params;
}

/** A spoken answer: the speech fixture (no Digits) with this SpeechResult. */
function withSpeech(speech: string): Record<string, string> {
  return { ...confirmSpeechFixture, SpeechResult: speech };
}

function confirmRequest(
  queryValues: Record<string, string>,
  params: Record<string, string> = confirmFixture
) {
  return signedTwilioRequest({ path: PATH, params, query: query(queryValues) });
}

async function post(request: Request) {
  const response = await POST(request);
  return { response, xml: await response.text() };
}

function noWrites() {
  expect(mockUpdateResolutionAttemptResponse).not.toHaveBeenCalled();
  expect(mockClaimDialing).not.toHaveBeenCalled();
  expect(mockMarkNotFound).not.toHaveBeenCalled();
  expect(mockInsertResolutionAttempt).not.toHaveBeenCalled();
}

function expectUpdatedBeforeClaim() {
  const updateOrder =
    mockUpdateResolutionAttemptResponse.mock.invocationCallOrder[0];
  const claimOrder = mockClaimDialing.mock.invocationCallOrder[0];
  expect(updateOrder).toBeDefined();
  expect(claimOrder).toBeDefined();
  expect(updateOrder as number).toBeLessThan(claimOrder as number);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  vi.stubEnv("PUBLIC_BASE_URL", TEST_PUBLIC_BASE_URL);
  vi.stubEnv("TWILIO_AUTH_TOKEN", TEST_AUTH_TOKEN);
  vi.stubEnv("TWILIO_PHONE_NUMBER", BAT_PHONE_NUMBER);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockInsertEvent.mockResolvedValue(undefined);
  mockGetCallById.mockResolvedValue(callRow());
  mockListContactsForUser.mockResolvedValue(CONTACTS);
  mockUpdateResolutionAttemptResponse.mockResolvedValue(true);
  mockClaimDialing.mockImplementation(async (_callId, claim) =>
    callRow({
      status: "dialing",
      contactId: claim.contactId,
      contactNameSnapshot: claim.contactName,
      destinationNumberSnapshot: claim.destinationNumber,
    })
  );
  mockMarkNotFound.mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/twilio/confirm request contract", () => {
  it("rejects an unsigned request with 403 and records nothing", async () => {
    const response = await POST(
      signedTwilioRequest({
        path: PATH,
        params: confirmFixture,
        query: query(SINGLE),
        omitSignature: true,
      })
    );
    expect(response.status).toBe(403);
    expect(mockInsertEvent).not.toHaveBeenCalled();
    noWrites();
  });

  it("records the event as confirm", async () => {
    await post(confirmRequest(SINGLE));
    expect(mockInsertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        callSid: confirmFixture.CallSid,
        eventKind: "confirm",
      })
    );
  });

  it("an unknown call id returns the apology with no writes", async () => {
    mockGetCallById.mockResolvedValue(null);
    const { xml } = await post(confirmRequest(SINGLE));
    expect(xml).toContain("Sorry, something went wrong");
    expect(xml).toContain("<Hangup/>");
    noWrites();
  });

  it("a CallSid that does not match the row returns goodbye and writes nothing", async () => {
    const { xml } = await post(
      confirmRequest(SINGLE, { ...confirmFixture, CallSid: "CAother" })
    );
    expect(xml).toContain("couldn't find that contact");
    expect(xml).not.toContain("<Dial");
    noWrites();
  });

  it("a contact id not owned by the caller returns goodbye and writes nothing", async () => {
    const { xml } = await post(
      confirmRequest({ ...SINGLE, contactId: "c-someone-else" })
    );
    expect(xml).toContain("couldn't find that contact");
    expect(xml).not.toContain("<Dial");
    noWrites();
  });

  it("a query naming neither a contact nor candidates returns goodbye and writes nothing", async () => {
    const { xml } = await post(
      confirmRequest({ callId: "call-1", attempt: "1", attemptId: "attempt-1" })
    );
    expect(xml).toContain("couldn't find that contact");
    noWrites();
  });

  it("a thrown error returns the apology TwiML", async () => {
    mockClaimDialing.mockRejectedValue(new Error("db down"));
    const { response, xml } = await post(confirmRequest(SINGLE));
    expect(response.status).toBe(200);
    expect(xml).toContain("Sorry, something went wrong");
  });
});

describe("POST /api/twilio/confirm single-candidate mode", () => {
  it("Digits 1 records confirmed, claims the dial, and returns the Dial verb", async () => {
    const { xml } = await post(confirmRequest(SINGLE));

    expect(mockUpdateResolutionAttemptResponse).toHaveBeenCalledWith(
      "attempt-1",
      { callId: "call-1", callerResponse: "confirmed" }
    );
    expect(mockClaimDialing).toHaveBeenCalledWith("call-1", {
      contactId: MIKE_ANDERSON.id,
      contactName: MIKE_ANDERSON.name,
      destinationNumber: MIKE_ANDERSON.phone,
    });
    expectUpdatedBeforeClaim();

    expect(xml).toContain("<Dial");
    expect(xml).toContain(`>${MIKE_ANDERSON.phone}</Number>`);
    expect(xml).toContain(`callerId="${BAT_PHONE_NUMBER}"`);
    expect(xml).toContain('record="record-from-answer-dual"');
    expect(xml).toContain('timeLimit="1800"');
    expect(xml).toContain(`action="${DIAL_STATUS_URL}?callId=call-1"`);
    expect(xml).toContain(
      `recordingStatusCallback="${RECORDING_URL}?callId=call-1"`
    );
    expect(xml).toContain('machineDetection="DetectMessageEnd"');
    expect(xml).toContain(
      `amdStatusCallback="${AMD_STATUS_URL}?callId=call-1"`
    );
    expect(xml).not.toContain("<Gather");
    expect(mockMarkNotFound).not.toHaveBeenCalled();
  });

  it("AE12: Digits 2 records retried and reprompts for attempt 2 without dialing", async () => {
    const { xml } = await post(confirmRequest(SINGLE, withDigits("2")));

    expect(mockUpdateResolutionAttemptResponse).toHaveBeenCalledWith(
      "attempt-1",
      { callId: "call-1", callerResponse: "retried" }
    );
    expect(mockClaimDialing).not.toHaveBeenCalled();
    expect(xml).not.toContain("<Dial");
    expect(xml).toContain(
      "No problem. Who would you like to call? You can also press their speed dial, then pound."
    );
    expect(xml).not.toContain("I heard");
    expect(xml).toContain(
      'hints="Mike Anderson, Sarah Chen, Mike Brown, Mike, Sarah, call Mike Anderson, call Sarah Chen, call Mike Brown, call Mike, call Sarah"'
    );
    expect(xml).toContain(`action="${GATHER_URL}?callId=call-1&amp;attempt=2"`);
  });

  it("a Dial response says 'Connecting you now' once before the Dial verb", async () => {
    const { xml } = await post(confirmRequest(SINGLE));
    expect(xml.match(/<Say[^>]*>/g)).toHaveLength(1);
    expect(xml).toContain(
      '<Say voice="Polly.Joanna-Neural">Connecting you now.</Say><Dial'
    );
  });

  it.each(["yes", "Yes.", "yeah", "yep", "yup", "one", "1", "yes please"])(
    "saying %s records confirmed and dials",
    async (speech) => {
      const { xml } = await post(confirmRequest(SINGLE, withSpeech(speech)));
      expect(mockUpdateResolutionAttemptResponse).toHaveBeenCalledWith(
        "attempt-1",
        { callId: "call-1", callerResponse: "confirmed" }
      );
      expect(mockClaimDialing).toHaveBeenCalledTimes(1);
      expect(xml).toContain("<Dial");
    }
  );

  it.each(["no", "No.", "nope", "two", "2", "no thanks"])(
    "saying %s records retried and reprompts without dialing",
    async (speech) => {
      const { xml } = await post(confirmRequest(SINGLE, withSpeech(speech)));
      expect(mockUpdateResolutionAttemptResponse).toHaveBeenCalledWith(
        "attempt-1",
        { callId: "call-1", callerResponse: "retried" }
      );
      expect(mockClaimDialing).not.toHaveBeenCalled();
      expect(xml).not.toContain("<Dial");
      expect(xml).toContain(
        `action="${GATHER_URL}?callId=call-1&amp;attempt=2"`
      );
    }
  );

  it.each(["maybe", "yesterday was fine", "call Sarah", "Mike Anderson"])(
    "unclear speech %s is never consent: recorded as retried, no dial",
    async (speech) => {
      const { xml } = await post(confirmRequest(SINGLE, withSpeech(speech)));
      expect(mockUpdateResolutionAttemptResponse).toHaveBeenCalledWith(
        "attempt-1",
        { callId: "call-1", callerResponse: "retried" }
      );
      expect(mockClaimDialing).not.toHaveBeenCalled();
      expect(xml).not.toContain("<Dial");
    }
  );

  it("a key press wins over a stray speech result", async () => {
    const { xml } = await post(
      confirmRequest(SINGLE, { ...withSpeech("yes"), Digits: "2" })
    );
    expect(mockUpdateResolutionAttemptResponse).toHaveBeenCalledWith(
      "attempt-1",
      { callId: "call-1", callerResponse: "retried" }
    );
    expect(xml).not.toContain("<Dial");
  });

  it("an empty speech result with no digits is a timeout", async () => {
    await post(confirmRequest(SINGLE, withSpeech("")));
    expect(mockUpdateResolutionAttemptResponse).toHaveBeenCalledWith(
      "attempt-1",
      { callId: "call-1", callerResponse: "timeout" }
    );
    expect(mockClaimDialing).not.toHaveBeenCalled();
  });

  it("any digit other than 1 counts as retried", async () => {
    const { xml } = await post(confirmRequest(SINGLE, withDigits("7")));
    expect(mockUpdateResolutionAttemptResponse).toHaveBeenCalledWith(
      "attempt-1",
      { callId: "call-1", callerResponse: "retried" }
    );
    expect(xml).not.toContain("<Dial");
  });

  it("no digits records timeout and reprompts; a timeout is never consent", async () => {
    const { xml } = await post(confirmRequest(SINGLE, withDigits(null)));

    expect(mockUpdateResolutionAttemptResponse).toHaveBeenCalledWith(
      "attempt-1",
      { callId: "call-1", callerResponse: "timeout" }
    );
    expect(mockClaimDialing).not.toHaveBeenCalled();
    expect(xml).not.toContain("<Dial");
    expect(xml).toContain(`action="${GATHER_URL}?callId=call-1&amp;attempt=2"`);
  });

  it("a retry after attempt 2 returns the keypad fallback for attempt 3", async () => {
    const { xml } = await post(
      confirmRequest({ ...SINGLE, attempt: "2" }, withDigits("2"))
    );
    expect(xml).toContain("Let's try the keypad.");
    expect(xml).toContain(`action="${GATHER_URL}?callId=call-1&amp;attempt=3"`);
    expect(mockMarkNotFound).not.toHaveBeenCalled();
  });

  it("a retry after attempt 3 marks the row not_found and says goodbye", async () => {
    const { xml } = await post(
      confirmRequest({ ...SINGLE, attempt: "3" }, withDigits("2"))
    );
    expect(xml).toContain("couldn't find that contact");
    expect(xml).toContain("<Hangup/>");
    expect(mockMarkNotFound).toHaveBeenCalledWith("call-1");
    expect(mockUpdateResolutionAttemptResponse).toHaveBeenCalledWith(
      "attempt-1",
      { callId: "call-1", callerResponse: "retried" }
    );
  });

  it("AE9: a confirm delivered when the row is already dialing returns already-connecting with no Dial and only the attempt response written", async () => {
    mockGetCallById.mockResolvedValue(callRow({ status: "dialing" }));
    mockClaimDialing.mockResolvedValue(null);

    const { xml } = await post(confirmRequest(SINGLE));

    expect(xml).toContain("already connecting");
    expect(xml).not.toContain("<Dial");
    expect(xml).not.toContain("<Gather");
    expect(mockUpdateResolutionAttemptResponse).toHaveBeenCalledTimes(1);
    expect(mockClaimDialing).toHaveBeenCalledTimes(1);
    expect(mockMarkNotFound).not.toHaveBeenCalled();
    expect(mockInsertResolutionAttempt).not.toHaveBeenCalled();
  });

  it.each(["abandoned", "emailed"])(
    "a confirm after the row is %s returns already-connecting with no Dial",
    async (status) => {
      mockGetCallById.mockResolvedValue(callRow({ status }));
      mockClaimDialing.mockResolvedValue(null);

      const { xml } = await post(confirmRequest(SINGLE));

      expect(xml).toContain("already connecting");
      expect(xml).not.toContain("<Dial");
      expect(mockMarkNotFound).not.toHaveBeenCalled();
    }
  );

  it("a retry on a row that is no longer identifying does not reprompt", async () => {
    mockGetCallById.mockResolvedValue(callRow({ status: "dialing" }));
    const { xml } = await post(confirmRequest(SINGLE, withDigits("2")));
    expect(xml).toContain("already connecting");
    expect(xml).not.toContain("<Gather");
    expect(mockMarkNotFound).not.toHaveBeenCalled();
  });

  it("the attempt response is written even when the compare-and-set to dialing loses", async () => {
    mockClaimDialing.mockResolvedValue(null);

    const { xml } = await post(confirmRequest(SINGLE));

    expect(mockUpdateResolutionAttemptResponse).toHaveBeenCalledWith(
      "attempt-1",
      { callId: "call-1", callerResponse: "confirmed" }
    );
    expectUpdatedBeforeClaim();
    expect(xml).toContain("already connecting");
    expect(xml).not.toContain("<Dial");
  });

  it("a claim that loses is logged without any number or name", async () => {
    mockClaimDialing.mockResolvedValue(null);
    const warn = vi.mocked(console.warn);

    await post(confirmRequest(SINGLE));

    const lines = warn.mock.calls.map((call) => String(call[0]));
    expect(lines.some((line) => line.includes("dial_claim_lost"))).toBe(true);
    for (const line of lines) {
      expect(line).not.toContain(MIKE_ANDERSON.phone);
      expect(line).not.toContain(MIKE_ANDERSON.name);
    }
  });
});

describe("POST /api/twilio/confirm selection mode", () => {
  it("Digits 2 records selected with position 2 and dials the second candidate directly", async () => {
    const { xml } = await post(confirmRequest(SELECTION, withDigits("2")));

    expect(mockUpdateResolutionAttemptResponse).toHaveBeenCalledWith(
      "attempt-1",
      { callId: "call-1", callerResponse: "selected", selectedPosition: 2 }
    );
    expect(mockClaimDialing).toHaveBeenCalledWith("call-1", {
      contactId: MIKE_BROWN.id,
      contactName: MIKE_BROWN.name,
      destinationNumber: MIKE_BROWN.phone,
    });
    expectUpdatedBeforeClaim();
    expect(xml).toContain("<Dial");
    expect(xml).toContain(`>${MIKE_BROWN.phone}</Number>`);
    expect(xml).not.toContain("say yes to call");
  });

  it("Digits 1 dials the first candidate", async () => {
    const { xml } = await post(confirmRequest(SELECTION, withDigits("1")));
    expect(mockClaimDialing).toHaveBeenCalledWith(
      "call-1",
      expect.objectContaining({ contactId: MIKE_ANDERSON.id })
    );
    expect(xml).toContain(`>${MIKE_ANDERSON.phone}</Number>`);
  });

  it.each(["3", "0", "*"])(
    "an out-of-range digit %s records retried and reprompts",
    async (digit) => {
      const { xml } = await post(confirmRequest(SELECTION, withDigits(digit)));

      expect(mockUpdateResolutionAttemptResponse).toHaveBeenCalledWith(
        "attempt-1",
        { callId: "call-1", callerResponse: "retried" }
      );
      expect(mockClaimDialing).not.toHaveBeenCalled();
      expect(xml).not.toContain("<Dial");
      expect(xml).toContain(
        `action="${GATHER_URL}?callId=call-1&amp;attempt=2"`
      );
    }
  );

  it("no digits records timeout and reprompts", async () => {
    const { xml } = await post(confirmRequest(SELECTION, withDigits(null)));
    expect(mockUpdateResolutionAttemptResponse).toHaveBeenCalledWith(
      "attempt-1",
      { callId: "call-1", callerResponse: "timeout" }
    );
    expect(xml).not.toContain("<Dial");
    expect(xml).toContain("No problem. Who would you like to call?");
  });

  it("a candidate id not owned by the caller returns goodbye and writes nothing", async () => {
    const { xml } = await post(
      confirmRequest(
        { ...SELECTION, candidates: "c1,c-foreign" },
        withDigits("2")
      )
    );
    expect(xml).toContain("couldn't find that contact");
    expect(xml).not.toContain("<Dial");
    noWrites();
  });

  it("a selection whose claim loses still records the response and returns already-connecting", async () => {
    mockClaimDialing.mockResolvedValue(null);

    const { xml } = await post(confirmRequest(SELECTION, withDigits("2")));

    expect(mockUpdateResolutionAttemptResponse).toHaveBeenCalledWith(
      "attempt-1",
      { callId: "call-1", callerResponse: "selected", selectedPosition: 2 }
    );
    expectUpdatedBeforeClaim();
    expect(xml).toContain("already connecting");
    expect(xml).not.toContain("<Dial");
  });
});
