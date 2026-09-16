// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import recordingAbsent from "@/test/fixtures/twilio/recording-absent.json";
import recordingCompleted from "@/test/fixtures/twilio/recording-completed.json";
import {
  signedTwilioRequest,
  TEST_AUTH_TOKEN,
  TEST_PUBLIC_BASE_URL,
} from "@/test/twilio";

const {
  mockInsertEvent,
  mockGetCallById,
  mockListContactsForUser,
  mockWriteRecording,
  mockMarkRecordingAbsent,
  mockSchedule,
} = vi.hoisted(() => ({
  mockInsertEvent: vi.fn(),
  mockGetCallById: vi.fn(),
  mockListContactsForUser: vi.fn(),
  mockWriteRecording: vi.fn(),
  mockMarkRecordingAbsent: vi.fn(),
  mockSchedule: vi.fn(),
}));

vi.mock("@/lib/batphone/calls-repo", () => ({
  insertEvent: mockInsertEvent,
  getCallById: mockGetCallById,
  listContactsForUser: mockListContactsForUser,
  writeRecording: mockWriteRecording,
  markRecordingAbsent: mockMarkRecordingAbsent,
}));

vi.mock("@/lib/batphone/after", () => ({
  scheduleBackgroundJob: mockSchedule,
}));

import { POST } from "./route";

const PATH = "/api/twilio/recording";
const NOW = new Date("2026-09-11T14:03:00.000Z");
const RECORDING_STARTED_AT = new Date("2026-09-11T14:02:15.000Z");
const CONTACT_NUMBER = "+15559876543";
const CONTACT_NAME = "Mike Anderson";
const CALLER_NUMBER = "+15551234567";

function callRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "call-1",
    userId: "user-1",
    twilioCallSid: recordingCompleted.CallSid,
    fromNumber: CALLER_NUMBER,
    contactNameSnapshot: CONTACT_NAME,
    destinationNumberSnapshot: CONTACT_NUMBER,
    status: "awaiting_recording",
    recordingSid: null,
    recordingStatus: null,
    inboundAt: NOW,
    ...overrides,
  };
}

function recordingRequest(params: Record<string, string> = recordingCompleted) {
  return signedTwilioRequest({ path: PATH, params, query: "?callId=call-1" });
}

async function post(request: Request) {
  const response = await POST(request);
  return { response, body: await response.text() };
}

/** Assert the serializable job accepted by the scheduling adapter. */
async function runScheduled(kind = "process-recording") {
  expect(mockSchedule).toHaveBeenCalledTimes(1);
  expect(mockSchedule).toHaveBeenCalledWith({
    version: 1,
    kind,
    callId: "call-1",
    ...(kind === "metadata-email" ? { reason: "no_recording" } : {}),
  });
}

function loggedLines(): string[] {
  const spies = [
    console.info,
    console.warn,
    console.error,
  ] as unknown as ReturnType<typeof vi.fn>[];
  return spies.flatMap((spy) => spy.mock.calls.map((call) => String(call[0])));
}

function noWrites() {
  expect(mockWriteRecording).not.toHaveBeenCalled();
  expect(mockMarkRecordingAbsent).not.toHaveBeenCalled();
  expect(mockSchedule).not.toHaveBeenCalled();
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
  mockWriteRecording.mockResolvedValue("stored");
  mockMarkRecordingAbsent.mockResolvedValue({
    row: callRow({ status: "no_recording", recordingStatus: "absent" }),
    transitioned: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/twilio/recording request contract", () => {
  it("rejects an unsigned request with 403 and records nothing", async () => {
    const response = await POST(
      signedTwilioRequest({
        path: PATH,
        params: recordingCompleted,
        query: "?callId=call-1",
        omitSignature: true,
      })
    );
    expect(response.status).toBe(403);
    expect(mockInsertEvent).not.toHaveBeenCalled();
    noWrites();
  });

  it("records the event as recording with the recording SID before acting", async () => {
    await post(recordingRequest());
    expect(mockInsertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        callSid: recordingCompleted.CallSid,
        recordingSid: recordingCompleted.RecordingSid,
        eventKind: "recording",
      })
    );
    const eventOrder = mockInsertEvent.mock.invocationCallOrder[0] as number;
    const writeOrder = mockWriteRecording.mock.invocationCallOrder[0] as number;
    expect(eventOrder).toBeLessThan(writeOrder);
  });

  it("an unknown call id stores the event, warns with the SID only, returns 200, and creates no row", async () => {
    mockGetCallById.mockResolvedValue(null);

    const { response, body } = await post(recordingRequest());

    expect(response.status).toBe(200);
    expect(body).toBe("");
    expect(mockInsertEvent).toHaveBeenCalledTimes(1);
    noWrites();
    const warnings = vi
      .mocked(console.warn)
      .mock.calls.map((c) => String(c[0]));
    expect(
      warnings.some(
        (line) =>
          line.includes("twilio_bind_rejected") &&
          line.includes(recordingCompleted.CallSid)
      )
    ).toBe(true);
    for (const line of loggedLines()) {
      expect(line).not.toContain(CALLER_NUMBER);
      expect(line).not.toContain(CONTACT_NUMBER);
    }
  });

  it("a CallSid that does not match the row returns 200 and writes nothing", async () => {
    const { response } = await post(
      recordingRequest({ ...recordingCompleted, CallSid: "CAother" })
    );
    expect(response.status).toBe(200);
    noWrites();
  });

  it("a thrown error is logged and returns 500 so the failure is visible", async () => {
    mockWriteRecording.mockRejectedValue(new Error("db down"));
    const { response } = await post(recordingRequest());
    expect(response.status).toBe(500);
    expect(mockSchedule).not.toHaveBeenCalled();
  });
});

describe("POST /api/twilio/recording completed", () => {
  it("accepts a late completed recording after a previous absent result and starts processing", async () => {
    mockGetCallById.mockResolvedValue(
      callRow({ status: "no_recording", recordingStatus: "absent" })
    );
    expect((await post(recordingRequest())).response.status).toBe(200);
    expect(mockWriteRecording).toHaveBeenCalledWith(
      "call-1",
      expect.objectContaining({ recordingSid: recordingCompleted.RecordingSid })
    );
    await runScheduled();
  });

  it("stores the recording fields and schedules processing exactly once after responding", async () => {
    const { response, body } = await post(recordingRequest());

    expect(response.status).toBe(200);
    expect(body).toBe("");
    expect(mockWriteRecording).toHaveBeenCalledWith("call-1", {
      recordingSid: recordingCompleted.RecordingSid,
      startedAt: RECORDING_STARTED_AT,
      durationSec: 42,
    });
    await runScheduled();
  });

  it("a replayed completed callback resumes scheduling after an interrupted process", async () => {
    mockGetCallById.mockResolvedValue(
      callRow({
        status: "awaiting_recording",
        recordingSid: recordingCompleted.RecordingSid,
        recordingStatus: "completed",
      })
    );
    mockWriteRecording.mockResolvedValue("duplicate");

    const { response } = await post(recordingRequest());

    expect(response.status).toBe(200);
    expect(mockInsertEvent).toHaveBeenCalledTimes(1);
    await runScheduled();
    expect(mockMarkRecordingAbsent).not.toHaveBeenCalled();
  });

  it("a callback with a different recording SID stores nothing on the row and logs a warning", async () => {
    mockGetCallById.mockResolvedValue(
      callRow({ status: "transcribed", recordingSid: "REother" })
    );
    mockWriteRecording.mockResolvedValue("different_sid");

    const { response } = await post(recordingRequest());

    expect(response.status).toBe(200);
    expect(mockInsertEvent).toHaveBeenCalledTimes(1);
    expect(mockSchedule).not.toHaveBeenCalled();
    const warnings = vi
      .mocked(console.warn)
      .mock.calls.map((c) => String(c[0]));
    expect(
      warnings.some(
        (line) =>
          line.includes("recording_sid_conflict") &&
          line.includes(recordingCompleted.RecordingSid)
      )
    ).toBe(true);
  });

  it("AE6: a recording that arrives while the row is still dialing is stored and processed", async () => {
    mockGetCallById.mockResolvedValue(callRow({ status: "dialing" }));

    await post(recordingRequest());

    expect(mockWriteRecording).toHaveBeenCalledTimes(1);
    await runScheduled();
  });

  it("a missing RecordingSid is logged and stores nothing", async () => {
    const params: Record<string, string> = { ...recordingCompleted };
    delete params.RecordingSid;

    const { response } = await post(recordingRequest(params));

    expect(response.status).toBe(200);
    noWrites();
  });

  it("an unparseable start time or duration is stored as null", async () => {
    await post(
      recordingRequest({
        ...recordingCompleted,
        RecordingStartTime: "not a date",
        RecordingDuration: "soon",
      })
    );
    expect(mockWriteRecording).toHaveBeenCalledWith("call-1", {
      recordingSid: recordingCompleted.RecordingSid,
      startedAt: null,
      durationSec: null,
    });
  });

  it("logs the call context only, never numbers or names", async () => {
    await post(recordingRequest());
    const lines = loggedLines();
    expect(lines.some((line) => line.includes("recording_stored"))).toBe(true);
    for (const line of lines) {
      expect(line).not.toContain(CALLER_NUMBER);
      expect(line).not.toContain(CONTACT_NUMBER);
      expect(line).not.toContain(CONTACT_NAME);
    }
  });
});

describe("POST /api/twilio/recording absent", () => {
  it("from awaiting_recording moves to no_recording and schedules the metadata-only email once", async () => {
    const { response } = await post(recordingRequest(recordingAbsent));

    expect(response.status).toBe(200);
    expect(mockMarkRecordingAbsent).toHaveBeenCalledWith("call-1");
    expect(mockWriteRecording).not.toHaveBeenCalled();
    await runScheduled("metadata-email");
  });

  it("while the row is busy only sets recording_status and sends no email", async () => {
    mockGetCallById.mockResolvedValue(callRow({ status: "busy" }));
    mockMarkRecordingAbsent.mockResolvedValue({
      row: callRow({ status: "busy", recordingStatus: "absent" }),
      transitioned: false,
    });

    const { response } = await post(recordingRequest(recordingAbsent));

    expect(response.status).toBe(200);
    expect(mockMarkRecordingAbsent).toHaveBeenCalledWith("call-1");
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it("while the row is still dialing leaves the dial action to decide and sends no email", async () => {
    mockGetCallById.mockResolvedValue(callRow({ status: "dialing" }));
    mockMarkRecordingAbsent.mockResolvedValue({
      row: callRow({ status: "dialing", recordingStatus: "absent" }),
      transitioned: false,
    });

    await post(recordingRequest(recordingAbsent));

    expect(mockMarkRecordingAbsent).toHaveBeenCalledWith("call-1");
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it("a second absent callback requeues recovery under the pipeline email claim", async () => {
    mockGetCallById.mockResolvedValue(
      callRow({ status: "no_recording", recordingStatus: "absent" })
    );
    mockMarkRecordingAbsent.mockResolvedValue({
      row: callRow({ status: "no_recording", recordingStatus: "absent" }),
      transitioned: false,
    });

    await post(recordingRequest(recordingAbsent));

    await runScheduled("metadata-email");
  });
});

describe("POST /api/twilio/recording other statuses", () => {
  it("an in-progress status is acknowledged with no writes", async () => {
    const { response } = await post(
      recordingRequest({
        ...recordingCompleted,
        RecordingStatus: "in-progress",
      })
    );
    expect(response.status).toBe(200);
    noWrites();
  });
});

it("returns 500 when enqueue fails and accepts the duplicate replay", async () => {
  mockSchedule.mockRejectedValueOnce(new Error("queue unavailable"));
  expect((await post(recordingRequest())).response.status).toBe(500);
  mockWriteRecording.mockResolvedValue("duplicate");
  expect((await post(recordingRequest())).response.status).toBe(200);
  expect(mockSchedule).toHaveBeenCalledTimes(2);
});

it("requeues an absent callback after the first enqueue failed", async () => {
  mockSchedule.mockRejectedValueOnce(new Error("queue unavailable"));
  expect((await post(recordingRequest(recordingAbsent))).response.status).toBe(
    500
  );
  mockMarkRecordingAbsent.mockResolvedValue({
    row: callRow({ status: "no_recording" }),
    transitioned: false,
  });
  expect((await post(recordingRequest(recordingAbsent))).response.status).toBe(
    200
  );
  expect(mockSchedule).toHaveBeenCalledTimes(2);
});
