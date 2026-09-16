// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import dialAction from "@/test/fixtures/twilio/dial-action.json";
import {
  signedTwilioRequest,
  TEST_AUTH_TOKEN,
  TEST_PUBLIC_BASE_URL,
} from "@/test/twilio";

const {
  mockInsertEvent,
  mockGetCallById,
  mockListContactsForUser,
  mockWriteDialOutcome,
} = vi.hoisted(() => ({
  mockInsertEvent: vi.fn(),
  mockGetCallById: vi.fn(),
  mockListContactsForUser: vi.fn(),
  mockWriteDialOutcome: vi.fn(),
}));

vi.mock("@/lib/batphone/calls-repo", () => ({
  insertEvent: mockInsertEvent,
  getCallById: mockGetCallById,
  listContactsForUser: mockListContactsForUser,
  writeDialOutcome: mockWriteDialOutcome,
}));

import { POST } from "./route";

const PATH = "/api/twilio/dial-status";
const NOW = new Date("2026-09-11T14:03:00.000Z");
const CONTACT_NUMBER = "+15559876543";
const CONTACT_NAME = "Mike Anderson";

function callRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "call-1",
    userId: "user-1",
    twilioCallSid: dialAction.CallSid,
    fromNumber: dialAction.From,
    contactNameSnapshot: CONTACT_NAME,
    destinationNumberSnapshot: CONTACT_NUMBER,
    status: "dialing",
    inboundAt: NOW,
    ...overrides,
  };
}

function withStatus(
  dialCallStatus: string | null,
  extra: Record<string, string> = {}
): Record<string, string> {
  const params: Record<string, string> = { ...dialAction, ...extra };
  delete params.DialCallStatus;
  if (dialCallStatus !== null) params.DialCallStatus = dialCallStatus;
  return params;
}

function dialRequest(params: Record<string, string> = dialAction) {
  return signedTwilioRequest({ path: PATH, params, query: "?callId=call-1" });
}

async function post(request: Request) {
  const response = await POST(request);
  return { response, xml: await response.text() };
}

function loggedLines(): string[] {
  const spies = [
    console.info,
    console.warn,
    console.error,
  ] as unknown as ReturnType<typeof vi.fn>[];
  return spies.flatMap((spy) => spy.mock.calls.map((call) => String(call[0])));
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
  mockListContactsForUser.mockResolvedValue([]);
  mockWriteDialOutcome.mockImplementation(async (_id, input) => ({
    row: callRow({
      status:
        input.outcome === "completed"
          ? "awaiting_recording"
          : input.outcome === "busy"
            ? "busy"
            : input.outcome === "no-answer"
              ? "no_answer"
              : "dial_failed",
      dialCallSid: input.dialCallSid,
      dialDurationSec: input.dialDurationSec,
      endedAt: input.endedAt,
    }),
    transitioned: true,
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/twilio/dial-status request contract", () => {
  it("rejects an unsigned request with 403 and records nothing", async () => {
    const response = await POST(
      signedTwilioRequest({
        path: PATH,
        params: dialAction,
        query: "?callId=call-1",
        omitSignature: true,
      })
    );
    expect(response.status).toBe(403);
    expect(mockInsertEvent).not.toHaveBeenCalled();
    expect(mockWriteDialOutcome).not.toHaveBeenCalled();
  });

  it("records the event as dial-status before acting", async () => {
    await post(dialRequest());
    expect(mockInsertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        callSid: dialAction.CallSid,
        eventKind: "dial-status",
      })
    );
    const eventOrder = mockInsertEvent.mock.invocationCallOrder[0] as number;
    const writeOrder = mockWriteDialOutcome.mock
      .invocationCallOrder[0] as number;
    expect(eventOrder).toBeLessThan(writeOrder);
  });

  it("an unknown call id returns the apology with no writes", async () => {
    mockGetCallById.mockResolvedValue(null);
    const { xml } = await post(dialRequest());
    expect(xml).toContain("Sorry, something went wrong");
    expect(mockWriteDialOutcome).not.toHaveBeenCalled();
  });

  it("a CallSid that does not match the row returns goodbye and writes nothing", async () => {
    const { xml } = await post(
      dialRequest({ ...dialAction, CallSid: "CAother" })
    );
    expect(xml).toContain("couldn't find that contact");
    expect(mockWriteDialOutcome).not.toHaveBeenCalled();
  });

  it("a thrown error returns the apology TwiML", async () => {
    mockWriteDialOutcome.mockRejectedValue(new Error("db down"));
    const { response, xml } = await post(dialRequest());
    expect(response.status).toBe(200);
    expect(xml).toContain("Sorry, something went wrong");
  });
});

describe("POST /api/twilio/dial-status outcomes (R10)", () => {
  it.each([
    ["busy", "Mike Anderson is busy right now. Try again later. Bye for now."],
    [
      "no-answer",
      "Mike Anderson didn't pick up. Try again later. Bye for now.",
    ],
    ["failed", "I couldn't connect that call. Bye for now."],
    ["canceled", "I couldn't connect that call. Bye for now."],
  ])(
    "%s writes the outcome with ended_at and speaks it, then hangs up",
    async (dialCallStatus, spoken) => {
      const { response, xml } = await post(
        dialRequest(withStatus(dialCallStatus))
      );

      expect(response.status).toBe(200);
      expect(mockWriteDialOutcome).toHaveBeenCalledTimes(1);
      expect(mockWriteDialOutcome).toHaveBeenCalledWith("call-1", {
        dialCallSid: dialAction.DialCallSid,
        dialDurationSec: 42,
        endedAt: NOW,
        outcome: dialCallStatus,
      });
      expect(xml).toContain(spoken);
      expect(xml).toContain("<Hangup/>");
      expect(xml).not.toContain("<Dial");
    }
  );

  it("completed from dialing moves to awaiting_recording with the dial duration and says goodbye", async () => {
    const { xml } = await post(dialRequest());

    expect(mockWriteDialOutcome).toHaveBeenCalledWith("call-1", {
      dialCallSid: dialAction.DialCallSid,
      dialDurationSec: 42,
      endedAt: NOW,
      outcome: "completed",
    });
    expect(xml).toContain(">Bye for now.</Say>");
    expect(xml).toContain("<Hangup/>");
  });

  it("busy on a row without a contact name snapshot falls back to a neutral name", async () => {
    mockGetCallById.mockResolvedValue(callRow({ contactNameSnapshot: null }));
    const { xml } = await post(dialRequest(withStatus("busy")));
    expect(xml).toContain("Your contact is busy right now.");
  });

  it("completed after the recording callback set absent moves to no_recording and still says goodbye", async () => {
    mockGetCallById.mockResolvedValue(callRow({ recordingStatus: "absent" }));
    mockWriteDialOutcome.mockResolvedValue({
      row: callRow({ status: "no_recording", recordingStatus: "absent" }),
      transitioned: true,
    });

    const { xml } = await post(dialRequest());

    expect(mockWriteDialOutcome).toHaveBeenCalledWith(
      "call-1",
      expect.objectContaining({ outcome: "completed" })
    );
    expect(xml).toContain(">Bye for now.</Say>");
  });

  it("busy after absent leaves the row busy with no email scheduled", async () => {
    mockGetCallById.mockResolvedValue(callRow({ recordingStatus: "absent" }));
    mockWriteDialOutcome.mockResolvedValue({
      row: callRow({ status: "busy", recordingStatus: "absent" }),
      transitioned: true,
    });

    const { xml } = await post(dialRequest(withStatus("busy")));

    expect(xml).toContain("Mike Anderson is busy right now.");
    const lines = loggedLines();
    expect(lines.some((line) => line.includes('"status":"busy"'))).toBe(true);
  });

  it("AE6: completed arriving after the row is already transcribing stores dial fields and leaves the status", async () => {
    mockGetCallById.mockResolvedValue(callRow({ status: "transcribing" }));
    mockWriteDialOutcome.mockResolvedValue({
      row: callRow({
        status: "transcribing",
        dialCallSid: dialAction.DialCallSid,
        dialDurationSec: 42,
      }),
      transitioned: false,
    });

    const { xml } = await post(dialRequest());

    expect(mockWriteDialOutcome).toHaveBeenCalledWith("call-1", {
      dialCallSid: dialAction.DialCallSid,
      dialDurationSec: 42,
      endedAt: NOW,
      outcome: "completed",
    });
    expect(xml).toContain(">Bye for now.</Say>");
    const lines = loggedLines();
    expect(
      lines.some(
        (line) =>
          line.includes("dial_outcome") &&
          line.includes('"transitioned":false') &&
          line.includes('"status":"transcribing"')
      )
    ).toBe(true);
  });

  it("answered counts as completed", async () => {
    await post(dialRequest(withStatus("answered")));
    expect(mockWriteDialOutcome).toHaveBeenCalledWith(
      "call-1",
      expect.objectContaining({ outcome: "completed" })
    );
  });

  it("an unknown DialCallStatus is stored as failed and logged", async () => {
    const { xml } = await post(dialRequest(withStatus("something-new")));
    expect(mockWriteDialOutcome).toHaveBeenCalledWith(
      "call-1",
      expect.objectContaining({ outcome: "failed" })
    );
    expect(xml).toContain("I couldn't connect that call.");
    const warnings = vi
      .mocked(console.warn)
      .mock.calls.map((c) => String(c[0]));
    expect(warnings.some((line) => line.includes("dial_status_unknown"))).toBe(
      true
    );
  });

  it("a missing DialCallDuration or DialCallSid is stored as null", async () => {
    const params = withStatus("failed");
    delete params.DialCallDuration;
    delete params.DialCallSid;
    await post(dialRequest(params));
    expect(mockWriteDialOutcome).toHaveBeenCalledWith("call-1", {
      dialCallSid: null,
      dialDurationSec: null,
      endedAt: NOW,
      outcome: "failed",
    });
  });

  it("logs the call context only, never numbers or names", async () => {
    await post(dialRequest());
    const lines = loggedLines();
    expect(lines.some((line) => line.includes("dial_outcome"))).toBe(true);
    for (const line of lines) {
      expect(line).not.toContain(CONTACT_NUMBER);
      expect(line).not.toContain(dialAction.From);
      expect(line).not.toContain(CONTACT_NAME);
    }
  });
});
