// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import completed from "@/test/fixtures/twilio/call-status-completed.json";
import {
  signedTwilioRequest,
  TEST_AUTH_TOKEN,
  TEST_PUBLIC_BASE_URL,
} from "@/test/twilio";

const {
  mockInsertEvent,
  mockSetEndedAt,
  mockMarkAbandonedIfIdentifying,
  mockMarkOpenAttemptsHungUp,
  mockGetCallBySid,
} = vi.hoisted(() => ({
  mockInsertEvent: vi.fn(),
  mockSetEndedAt: vi.fn(),
  mockMarkAbandonedIfIdentifying: vi.fn(),
  mockMarkOpenAttemptsHungUp: vi.fn(),
  mockGetCallBySid: vi.fn(),
}));

vi.mock("@/lib/batphone/calls-repo", () => ({
  insertEvent: mockInsertEvent,
  setEndedAt: mockSetEndedAt,
  markAbandonedIfIdentifying: mockMarkAbandonedIfIdentifying,
  markOpenAttemptsHungUp: mockMarkOpenAttemptsHungUp,
  getCallBySid: mockGetCallBySid,
}));

import { POST } from "./route";

const PATH = "/api/twilio/call-status";
const ENDED = new Date("2026-09-11T14:03:27.000Z");

function statusRequest(params: Record<string, string> = completed) {
  return signedTwilioRequest({ path: PATH, params });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PUBLIC_BASE_URL", TEST_PUBLIC_BASE_URL);
  vi.stubEnv("TWILIO_AUTH_TOKEN", TEST_AUTH_TOKEN);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockInsertEvent.mockResolvedValue(undefined);
  mockSetEndedAt.mockResolvedValue(true);
  mockMarkAbandonedIfIdentifying.mockResolvedValue(false);
  mockMarkOpenAttemptsHungUp.mockResolvedValue(0);
  mockGetCallBySid.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/twilio/call-status", () => {
  it("rejects an unsigned request with 403 and records nothing", async () => {
    const response = await POST(
      signedTwilioRequest({
        path: PATH,
        params: completed,
        omitSignature: true,
      })
    );
    expect(response.status).toBe(403);
    expect(mockInsertEvent).not.toHaveBeenCalled();
  });

  it("records the event, closes an identifying row as abandoned, sets ended_at, and marks open attempts hung up", async () => {
    mockMarkAbandonedIfIdentifying.mockResolvedValue(true);
    mockGetCallBySid.mockResolvedValue({
      id: "call-1",
      twilioCallSid: completed.CallSid,
      status: "abandoned",
    });

    const response = await POST(statusRequest());

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("content-type")).not.toBe("text/xml");
    expect(mockInsertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        callSid: completed.CallSid,
        eventKind: "call-status",
        payload: expect.objectContaining({ CallStatus: "completed" }),
      })
    );
    expect(mockSetEndedAt).toHaveBeenCalledWith(completed.CallSid, ENDED);
    expect(mockMarkAbandonedIfIdentifying).toHaveBeenCalledWith(
      completed.CallSid,
      ENDED
    );
    expect(mockMarkOpenAttemptsHungUp).toHaveBeenCalledWith("call-1");
  });

  it("for a transcribing row only sets ended_at", async () => {
    mockGetCallBySid.mockResolvedValue({
      id: "call-2",
      twilioCallSid: completed.CallSid,
      status: "transcribing",
    });

    const response = await POST(statusRequest());

    expect(response.status).toBe(204);
    expect(mockSetEndedAt).toHaveBeenCalledWith(completed.CallSid, ENDED);
    // The abandon update is conditional on status and is a no-op here.
    expect(mockMarkAbandonedIfIdentifying).toHaveBeenCalledWith(
      completed.CallSid,
      ENDED
    );
    expect(mockMarkOpenAttemptsHungUp).not.toHaveBeenCalled();
  });

  it.each(["failed", "busy", "no-answer", "canceled"])(
    "treats CallStatus %s as an end of call",
    async (status) => {
      const response = await POST(
        statusRequest({ ...completed, CallStatus: status })
      );
      expect(response.status).toBe(204);
      expect(mockSetEndedAt).toHaveBeenCalledTimes(1);
    }
  );

  it("is a no-op for a non-terminal status", async () => {
    const response = await POST(
      statusRequest({ ...completed, CallStatus: "in-progress" })
    );

    expect(response.status).toBe(204);
    expect(mockInsertEvent).toHaveBeenCalledTimes(1);
    expect(mockSetEndedAt).not.toHaveBeenCalled();
    expect(mockMarkAbandonedIfIdentifying).not.toHaveBeenCalled();
  });

  it("falls back to the current time when Timestamp is missing or malformed", async () => {
    const now = new Date("2026-09-11T15:00:00.000Z");
    vi.useFakeTimers({ now, toFake: ["Date"] });
    try {
      await POST(statusRequest({ ...completed, Timestamp: "not a date" }));
      expect(mockSetEndedAt).toHaveBeenCalledWith(completed.CallSid, now);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns 500 with an empty body, never TwiML, when the repo throws", async () => {
    mockSetEndedAt.mockRejectedValue(new Error("db down"));

    const response = await POST(statusRequest());

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
  });
});
