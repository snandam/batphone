// @vitest-environment node
/**
 * The actions are asserted at the SQL level with a drizzle pg-proxy
 * database, as calls-repo.test.ts does, so ownership scoping, ordering,
 * and the projected columns are checked in the statements themselves.
 * The pipeline is mocked: retry and resync must not reach it for a call
 * the session user does not own.
 */
import { getTableColumns } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { call, resolutionAttempt, type Call } from "@/db/schema";

type Captured = { sql: string; params: unknown[]; method: string };

const proxy = vi.hoisted(() => ({
  statements: [] as { sql: string; params: unknown[]; method: string }[],
  responses: [] as unknown[][][],
}));

const {
  mockGetSession,
  mockRevalidatePath,
  mockPipelineRetry,
  mockPipelineResync,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockPipelineRetry: vi.fn(),
  mockPipelineResync: vi.fn(),
}));

vi.mock("@/lib/batphone/require-profile", () => ({
  requireCompletedOnboarding: vi
    .fn()
    .mockResolvedValue({ firstName: "Sanjeev", lastName: "" }),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: mockGetSession } },
}));
vi.mock("@/lib/batphone/pipeline", () => ({
  retryCall: mockPipelineRetry,
  resyncCall: mockPipelineResync,
}));

vi.mock("@/db", async () => {
  const { drizzle: make } = await import("drizzle-orm/pg-proxy");
  const db = make(async (sql, params, method) => {
    proxy.statements.push({ sql, params, method });
    const rows = proxy.responses.shift() ?? [];
    return { rows };
  });
  return { db };
});

import { getCall, listCalls, resyncCall, retryCall } from "./index";

const CALL_COLUMNS = Object.entries(getTableColumns(call));
const ATTEMPT_COLUMNS = Object.entries(getTableColumns(resolutionAttempt));
const NOW = new Date("2026-09-11T14:05:00.000Z");
const USER_ID = "user-1";
const CALL_ID = "call-1";
const TIMEZONE = "America/Los_Angeles";

const session = {
  user: { id: USER_ID, email: "a@example.com", name: "Sanjeev" },
};

/** A call row as pg-proxy returns it: values in the table's column order. */
function callRowArray(overrides: Partial<Call> = {}): unknown[] {
  const base: Partial<Call> = {
    id: CALL_ID,
    userId: USER_ID,
    fromNumber: "+15551234567",
    twilioCallSid: "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    contactNameSnapshot: "Mike Anderson",
    destinationNumberSnapshot: "+15559876543",
    status: "emailed",
    transcribeAttempts: 1,
    emailAttempts: 1,
    inboundAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
  return CALL_COLUMNS.map(
    ([key]) => (base as Record<string, unknown>)[key] ?? null
  );
}

function attemptRowArray(overrides: Record<string, unknown> = {}): unknown[] {
  const base: Record<string, unknown> = {
    id: "a1",
    callId: CALL_ID,
    attemptNumber: 1,
    inputKind: "speech",
    heardText: "call Jonathan",
    confidence: 0.41,
    normalizedQuery: "jonathan",
    candidates: [],
    decision: "none",
    callerResponse: "retried",
    createdAt: NOW,
    ...overrides,
  };
  return ATTEMPT_COLUMNS.map(([key]) => base[key] ?? null);
}

/** History projection order, as `listCalls` selects it. */
function summaryRowArray(overrides: Record<string, unknown> = {}): unknown[] {
  const base: Record<string, unknown> = {
    id: CALL_ID,
    contactName: "Mike Anderson",
    destinationNumber: "+15559876543",
    status: "emailed",
    inboundAt: NOW,
    recordingStartedAt: null,
    recordingDurationSec: 42,
    dialDurationSec: 45,
    lastHeardText: null,
    hasTranscript: true,
    hasRecording: true,
    transcriptEmailSentAt: NOW,
    metadataEmailSentAt: null,
    ...overrides,
  };
  return [
    base.id,
    base.contactName,
    base.destinationNumber,
    base.status,
    base.inboundAt,
    base.recordingStartedAt,
    base.recordingDurationSec,
    base.dialDurationSec,
    base.lastHeardText,
    base.hasTranscript,
    base.hasRecording,
    base.transcriptEmailSentAt,
    base.metadataEmailSentAt,
  ];
}

function respondWith(...rowsPerStatement: unknown[][][]) {
  proxy.responses.push(...rowsPerStatement);
}

function statement(index = 0): Captured {
  const captured = proxy.statements[index];
  if (!captured) throw new Error(`no statement ${index}`);
  return captured;
}

beforeEach(() => {
  vi.clearAllMocks();
  proxy.statements.length = 0;
  proxy.responses.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockGetSession.mockResolvedValue(session);
  mockPipelineRetry.mockResolvedValue("emailed");
  mockPipelineResync.mockResolvedValue("resumed");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listCalls", () => {
  it("returns unauthenticated without a session", async () => {
    mockGetSession.mockResolvedValue(null);
    const result = await listCalls();
    expect(result).toEqual({ ok: false, reason: "unauthenticated" });
    expect(proxy.statements).toHaveLength(0);
  });

  it("selects only the session user's rows, newest first, without the transcript columns", async () => {
    const METADATA_AT = new Date("2026-09-11T14:00:00.000Z");
    respondWith(
      [
        summaryRowArray(),
        summaryRowArray({
          id: "call-2",
          status: "transcription_failed",
          hasTranscript: false,
          transcriptEmailSentAt: null,
          metadataEmailSentAt: METADATA_AT,
        }),
        summaryRowArray({
          id: "call-3",
          status: "not_found",
          contactName: null,
          destinationNumber: null,
          lastHeardText: "call Jonathan",
          hasTranscript: false,
          hasRecording: false,
          transcriptEmailSentAt: null,
        }),
      ],
      [[TIMEZONE]]
    );

    const result = await listCalls();

    const { sql, params } = statement(0);
    expect(sql).toMatch(/^select /);
    expect(sql).toContain('from "call"');
    expect(sql).toMatch(/where "call"\."user_id" = \$\d+/);
    expect(sql).toContain('order by "call"."inbound_at" desc');
    expect(sql).not.toContain('"transcript"');
    // Presence only: the text column is tested in SQL, never projected.
    expect(sql).toContain('"transcript_text" is not null');
    expect(sql).not.toMatch(/"transcript_text"(?! is not null)/);
    expect(sql).toContain('"recording_sid" is not null');
    expect(sql).toContain('"transcript_email_sent_at"');
    expect(sql).toContain('"metadata_email_sent_at"');
    expect(sql).toContain('"heard_text"');
    expect(sql).toContain('order by "attempt_number" desc limit 1');
    expect(params).toContain(USER_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.timeZone).toBe(TIMEZONE);
    expect(result.data.calls.map((c) => c.id)).toEqual([
      CALL_ID,
      "call-2",
      "call-3",
    ]);
    expect(result.data.calls[0]).toMatchObject({
      hasTranscript: true,
      hasRecording: true,
      emailSentAt: NOW,
      emailKind: "transcript",
    });
    expect(result.data.calls[1]).toMatchObject({
      status: "transcription_failed",
      hasTranscript: false,
      hasRecording: true,
      emailSentAt: METADATA_AT,
      emailKind: "metadata",
    });
    expect(result.data.calls[2]).toMatchObject({
      status: "not_found",
      lastHeardText: "call Jonathan",
      hasTranscript: false,
      hasRecording: false,
      emailSentAt: null,
      emailKind: null,
    });
    for (const row of result.data.calls) {
      expect(row).not.toHaveProperty("transcript");
      expect(row).not.toHaveProperty("transcriptText");
      expect(row).not.toHaveProperty("transcriptEmailSentAt");
      expect(row).not.toHaveProperty("metadataEmailSentAt");
    }
  });

  it("falls back to UTC when the profile has no row", async () => {
    respondWith([], []);
    const result = await listCalls();
    expect(result).toEqual({
      ok: true,
      data: { calls: [], timeZone: "UTC" },
    });
  });
});

describe("getCall", () => {
  it("loads the row scoped to the session user, then the attempts in order", async () => {
    respondWith(
      [callRowArray()],
      [[TIMEZONE]],
      [attemptRowArray(), attemptRowArray({ id: "a2", attemptNumber: 2 })]
    );

    const result = await getCall(CALL_ID);

    const first = statement(0);
    expect(first.sql).toMatch(
      /where \("call"\."id" = \$\d+ and "call"\."user_id" = \$\d+\)/
    );
    expect(first.params).toEqual(expect.arrayContaining([CALL_ID, USER_ID]));
    const attempts = statement(2);
    expect(attempts.sql).toContain('from "resolution_attempt"');
    expect(attempts.sql).toMatch(/"resolution_attempt"\."call_id" = \$\d+/);
    expect(attempts.sql).toContain(
      'order by "resolution_attempt"."attempt_number" asc'
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.call.id).toBe(CALL_ID);
    expect(result.data.callerName).toBe("Sanjeev");
    expect(result.data.timeZone).toBe(TIMEZONE);
    expect(result.data.attempts.map((a) => a.attemptNumber)).toEqual([1, 2]);
  });

  it("returns not_found for another user's call and reads nothing else", async () => {
    respondWith([]);
    const result = await getCall(CALL_ID);
    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(proxy.statements).toHaveLength(1);
  });

  it("returns not_found for a malformed id without a query", async () => {
    const result = await getCall("");
    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(proxy.statements).toHaveLength(0);
  });
});

describe("retryCall", () => {
  it("returns not_found for another user's call without touching the pipeline", async () => {
    respondWith([]);
    const result = await retryCall(CALL_ID);
    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(proxy.statements).toHaveLength(1);
    expect(statement(0).sql).toMatch(/"call"\."user_id" = \$\d+/);
    expect(mockPipelineRetry).not.toHaveBeenCalled();
  });

  it("returns unauthenticated without a session", async () => {
    mockGetSession.mockResolvedValue(null);
    const result = await retryCall(CALL_ID);
    expect(result).toEqual({ ok: false, reason: "unauthenticated" });
    expect(mockPipelineRetry).not.toHaveBeenCalled();
  });

  it("hands an owned call to the pipeline retry with the confirm flag and revalidates the pages", async () => {
    respondWith([callRowArray({ status: "transcription_failed" })]);
    mockPipelineRetry.mockResolvedValue("emailed");

    const result = await retryCall(CALL_ID, { confirmDuplicate: true });

    expect(mockPipelineRetry).toHaveBeenCalledWith(CALL_ID, {
      confirmDuplicate: true,
    });
    expect(result).toEqual({ ok: true, data: { outcome: "emailed" } });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/calls");
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/calls/${CALL_ID}`);
  });

  it("surfaces nothing_to_retry and confirm_required from the pipeline as failures", async () => {
    respondWith([callRowArray({ status: "emailed" })]);
    mockPipelineRetry.mockResolvedValue("nothing_to_retry");
    expect(await retryCall(CALL_ID)).toEqual({
      ok: false,
      reason: "nothing_to_retry",
    });

    respondWith([callRowArray({ status: "emailing" })]);
    mockPipelineRetry.mockResolvedValue("confirm_required");
    expect(await retryCall(CALL_ID)).toEqual({
      ok: false,
      reason: "confirm_required",
    });
  });

  it("reports a thrown pipeline error as failed", async () => {
    respondWith([callRowArray({ status: "transcription_failed" })]);
    mockPipelineRetry.mockRejectedValue(new Error("deepgram down"));
    expect(await retryCall(CALL_ID)).toEqual({ ok: false, reason: "failed" });
  });
});

describe("resyncCall", () => {
  it("returns not_found for another user's call without calling Twilio", async () => {
    respondWith([]);
    const result = await resyncCall(CALL_ID);
    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(mockPipelineResync).not.toHaveBeenCalled();
  });

  it("hands an owned stuck call to the pipeline resync", async () => {
    respondWith([callRowArray({ status: "awaiting_recording" })]);
    mockPipelineResync.mockResolvedValue("resumed");

    const result = await resyncCall(CALL_ID);

    expect(mockPipelineResync).toHaveBeenCalledWith(CALL_ID);
    expect(result).toEqual({ ok: true, data: { outcome: "resumed" } });
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/calls/${CALL_ID}`);
  });

  it("surfaces not_stuck from the pipeline", async () => {
    respondWith([callRowArray({ status: "dialing" })]);
    mockPipelineResync.mockResolvedValue("not_stuck");
    expect(await resyncCall(CALL_ID)).toEqual({
      ok: false,
      reason: "not_stuck",
    });
  });
});
