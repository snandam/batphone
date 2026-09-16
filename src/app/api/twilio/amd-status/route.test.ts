// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import amdStatus from "@/test/fixtures/twilio/amd-status.json";
import dialAction from "@/test/fixtures/twilio/dial-action.json";
import {
  signedTwilioRequest,
  TEST_AUTH_TOKEN,
  TEST_PUBLIC_BASE_URL,
} from "@/test/twilio";

const { mockInsertEvent, mockGetCallById, mockWriteAnsweredBy } = vi.hoisted(
  () => ({
    mockInsertEvent: vi.fn(),
    mockGetCallById: vi.fn(),
    mockWriteAnsweredBy: vi.fn(),
  })
);

vi.mock("@/lib/batphone/calls-repo", () => ({
  insertEvent: mockInsertEvent,
  getCallById: mockGetCallById,
  writeAnsweredBy: mockWriteAnsweredBy,
}));

import { POST } from "./route";

const PATH = "/api/twilio/amd-status";
const NOW = new Date("2026-09-11T14:03:00.000Z");
const CONTACT_NUMBER = "+15559876543";
const CONTACT_NAME = "Mike Anderson";

function callRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "call-1",
    userId: "user-1",
    twilioCallSid: dialAction.CallSid,
    dialCallSid: null,
    fromNumber: dialAction.From,
    contactNameSnapshot: CONTACT_NAME,
    destinationNumberSnapshot: CONTACT_NUMBER,
    status: "dialing",
    inboundAt: NOW,
    answeredBy: null,
    machineDetectionDurationMs: null,
    ...overrides,
  };
}

function amdRequest(params: Record<string, string> = amdStatus) {
  return signedTwilioRequest({ path: PATH, params, query: "?callId=call-1" });
}

async function post(request: Request) {
  const response = await POST(request);
  return { response, body: await response.text() };
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
  mockWriteAnsweredBy.mockImplementation(async (_id, input) =>
    callRow({
      answeredBy: input.answeredBy,
      machineDetectionDurationMs: input.machineDetectionDurationMs,
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/twilio/amd-status request contract", () => {
  it("rejects an unsigned request with 403 and records nothing", async () => {
    const response = await POST(
      signedTwilioRequest({
        path: PATH,
        params: amdStatus,
        query: "?callId=call-1",
        omitSignature: true,
      })
    );
    expect(response.status).toBe(403);
    expect(mockInsertEvent).not.toHaveBeenCalled();
    expect(mockWriteAnsweredBy).not.toHaveBeenCalled();
  });

  it("rejects a request signed with the wrong token", async () => {
    const response = await POST(
      signedTwilioRequest({
        path: PATH,
        params: amdStatus,
        query: "?callId=call-1",
        authToken: "some-other-token",
      })
    );
    expect(response.status).toBe(403);
    expect(mockWriteAnsweredBy).not.toHaveBeenCalled();
  });

  it("records the event as amd-status before writing", async () => {
    await post(amdRequest());
    expect(mockInsertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        callSid: amdStatus.CallSid,
        eventKind: "amd-status",
      })
    );
    const eventOrder = mockInsertEvent.mock.invocationCallOrder[0] as number;
    const writeOrder = mockWriteAnsweredBy.mock
      .invocationCallOrder[0] as number;
    expect(eventOrder).toBeLessThan(writeOrder);
  });

  it("an unknown call id stores the event, warns, returns 200, and writes nothing", async () => {
    mockGetCallById.mockResolvedValue(null);

    const { response, body } = await post(amdRequest());

    expect(response.status).toBe(200);
    expect(body).toBe("");
    expect(mockInsertEvent).toHaveBeenCalledTimes(1);
    expect(mockWriteAnsweredBy).not.toHaveBeenCalled();
    const warnings = vi
      .mocked(console.warn)
      .mock.calls.map((c) => String(c[0]));
    expect(warnings.some((line) => line.includes("amd_call_missing"))).toBe(
      true
    );
  });

  it("a missing callId query is treated like an unknown call", async () => {
    const { response } = await post(
      signedTwilioRequest({ path: PATH, params: amdStatus })
    );
    expect(response.status).toBe(200);
    expect(mockWriteAnsweredBy).not.toHaveBeenCalled();
  });

  it("a CallSid that matches neither the parent nor the stored child leg writes nothing", async () => {
    mockGetCallById.mockResolvedValue(
      callRow({ dialCallSid: "CAchildchildchildchildchildchildch" })
    );
    const { response } = await post(amdRequest());
    expect(response.status).toBe(200);
    expect(mockWriteAnsweredBy).not.toHaveBeenCalled();
  });

  it("accepts the parent CallSid too", async () => {
    await post(amdRequest({ ...amdStatus, CallSid: dialAction.CallSid }));
    expect(mockWriteAnsweredBy).toHaveBeenCalledTimes(1);
  });

  it("a call older than a day is ignored", async () => {
    mockGetCallById.mockResolvedValue(
      callRow({ inboundAt: new Date("2026-09-09T14:03:00.000Z") })
    );
    const { response } = await post(amdRequest());
    expect(response.status).toBe(200);
    expect(mockWriteAnsweredBy).not.toHaveBeenCalled();
  });

  it("a thrown error is logged and returns 500", async () => {
    mockWriteAnsweredBy.mockRejectedValue(new Error("db down"));
    const { response } = await post(amdRequest());
    expect(response.status).toBe(500);
  });
});

describe("POST /api/twilio/amd-status results", () => {
  it("human is stored with the detection duration", async () => {
    const { response, body } = await post(
      amdRequest({
        ...amdStatus,
        AnsweredBy: "human",
        MachineDetectionDuration: "1300",
      })
    );
    expect(response.status).toBe(200);
    expect(body).toBe("");
    expect(mockWriteAnsweredBy).toHaveBeenCalledWith("call-1", {
      answeredBy: "human",
      machineDetectionDurationMs: 1300,
    });
    const lines = loggedLines();
    expect(
      lines.some(
        (line) =>
          line.includes("amd_result") && line.includes('"answered_by":"human"')
      )
    ).toBe(true);
  });

  it("machine_end_beep is stored as-is", async () => {
    await post(amdRequest());
    expect(mockWriteAnsweredBy).toHaveBeenCalledWith("call-1", {
      answeredBy: "machine_end_beep",
      machineDetectionDurationMs: 4210,
    });
  });

  it("a missing AnsweredBy is stored as unknown and a bad duration as null", async () => {
    const params: Record<string, string> = { ...amdStatus };
    delete params.AnsweredBy;
    params.MachineDetectionDuration = "abc";
    await post(amdRequest(params));
    expect(mockWriteAnsweredBy).toHaveBeenCalledWith("call-1", {
      answeredBy: "unknown",
      machineDetectionDurationMs: null,
    });
  });

  it("logs the call context only, never numbers or names", async () => {
    await post(amdRequest());
    for (const line of loggedLines()) {
      expect(line).not.toContain(CONTACT_NUMBER);
      expect(line).not.toContain(dialAction.From);
      expect(line).not.toContain(CONTACT_NAME);
    }
  });
});
