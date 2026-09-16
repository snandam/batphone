// @vitest-environment node
/**
 * The compare-and-set statements are the whole point of the repository, so
 * they are asserted at the SQL level. The db module is replaced with a
 * drizzle pg-proxy database whose callback captures every statement and
 * its parameters and answers with rows the test chooses. No Postgres.
 */
import { getTableColumns } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { call, type Call } from "@/db/schema";

type Captured = { sql: string; params: unknown[]; method: string };

const proxy = vi.hoisted(() => {
  const state = {
    statements: [] as { sql: string; params: unknown[]; method: string }[],
    responses: [] as unknown[][][],
  };
  return state;
});

vi.mock("@/db", async () => {
  const { drizzle: make } = await import("drizzle-orm/pg-proxy");
  const db = make(async (sql, params, method) => {
    proxy.statements.push({ sql, params, method });
    const rows = proxy.responses.shift() ?? [];
    return { rows };
  });
  return { db };
});

import * as repo from "./calls-repo";

const COLUMNS = Object.entries(getTableColumns(call));
const NOW = new Date("2026-09-11T14:05:00.000Z");
const CALL_ID = "call-1";
const TOKEN = "token-1";

/** A row as pg-proxy returns it: values in the table's column order. */
function rowArray(overrides: Partial<Call> = {}): unknown[] {
  const base: Partial<Call> = {
    id: CALL_ID,
    userId: "user-1",
    fromNumber: "+15551234567",
    twilioCallSid: "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    status: "awaiting_recording",
    transcribeAttempts: 0,
    emailAttempts: 0,
    inboundAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
  return COLUMNS.map(([key]) => (base as Record<string, unknown>)[key] ?? null);
}

function respondWith(...rowsPerStatement: unknown[][][]) {
  proxy.responses.push(...rowsPerStatement);
}

function statement(index = 0): Captured {
  const captured = proxy.statements[index];
  if (!captured) throw new Error(`no statement ${index}`);
  return captured;
}

function setClause(sql: string): string {
  return sql.slice(sql.indexOf(" set ") + 5, sql.indexOf(" where "));
}

function whereClause(sql: string): string {
  const start = sql.indexOf(" where ");
  const end = sql.indexOf(" returning");
  return sql.slice(start + 7, end === -1 ? undefined : end);
}

beforeEach(() => {
  proxy.statements.length = 0;
  proxy.responses.length = 0;
  vi.spyOn(crypto, "randomUUID").mockReturnValue(
    "00000000-0000-4000-8000-000000000001"
  );
});

describe("claim", () => {
  it("transcribing: one update guarded by status IN fromStatuses that takes a token, database time, and the attempt counter", async () => {
    respondWith([rowArray({ status: "transcribing", claimToken: "new" })]);

    const row = await repo.claim(CALL_ID, {
      step: "transcribing",
      fromStatuses: ["awaiting_recording", "dialing"],
    });

    expect(proxy.statements).toHaveLength(1);
    const { sql, params } = statement();
    expect(sql).toMatch(/^update "call" set /);
    const set = setClause(sql);
    expect(set).toContain('"status" = $');
    expect(set).toContain('"claim_token" = $');
    expect(set).toContain('"claimed_at" = now()');
    expect(set).toContain(
      '"transcribe_attempts" = "call"."transcribe_attempts" + 1'
    );
    expect(set).toContain('"last_error" = $');
    expect(set).not.toContain('"email_claimed_at"');
    expect(whereClause(sql)).toMatch(
      /\("call"\."id" = \$\d+ and "call"\."status" in \(\$\d+, \$\d+\)\)/
    );
    expect(params).toEqual(
      expect.arrayContaining([
        "transcribing",
        "00000000-0000-4000-8000-000000000001",
        CALL_ID,
        "awaiting_recording",
        "dialing",
        null,
      ])
    );
    expect(sql).toContain(" returning ");
    expect(row?.status).toBe("transcribing");
    expect(row?.claimToken).toBe("new");
  });

  it("returns null when the guard matched no row", async () => {
    respondWith([]);
    const row = await repo.claim(CALL_ID, {
      step: "transcribing",
      fromStatuses: ["awaiting_recording", "dialing"],
    });
    expect(row).toBeNull();
  });

  it("emailing: guarded by status IN fromStatuses and transcript_email_sent_at IS NULL, moves to emailing under email_claimed_at", async () => {
    respondWith([rowArray({ status: "emailing" })]);

    await repo.claim(CALL_ID, {
      step: "emailing",
      fromStatuses: ["transcribed"],
    });

    const { sql, params } = statement();
    const set = setClause(sql);
    expect(set).toContain('"status" = $');
    expect(set).toContain('"email_claimed_at" = now()');
    expect(set).toContain('"email_attempts" = "call"."email_attempts" + 1');
    expect(set).toContain('"last_email_error" = $');
    expect(set).not.toContain('"claimed_at"');
    expect(set).not.toContain('"transcribe_attempts"');
    const where = whereClause(sql);
    expect(where).toContain('"call"."status" in ($');
    expect(where).toContain('"call"."transcript_email_sent_at" is null');
    expect(params).toEqual(
      expect.arrayContaining(["emailing", "transcribed", null])
    );
  });

  it("metadata_email: guarded by metadata_email_sent_at IS NULL and never changes the status", async () => {
    respondWith([rowArray({ status: "transcription_failed" })]);

    await repo.claim(CALL_ID, {
      step: "metadata_email",
      fromStatuses: ["transcription_failed", "no_recording"],
    });

    const { sql, params } = statement();
    const set = setClause(sql);
    expect(set).not.toContain('"status"');
    expect(set).toContain('"claim_token" = $');
    expect(set).toContain('"email_claimed_at" = now()');
    expect(set).toContain('"email_attempts" = "call"."email_attempts" + 1');
    expect(set).toContain('"last_email_error" = $');
    const where = whereClause(sql);
    expect(where).toContain('"call"."metadata_email_sent_at" is null');
    expect(where).toContain('"call"."status" in ($');
    expect(params).toEqual(
      expect.arrayContaining(["transcription_failed", "no_recording", null])
    );
  });
});

describe("complete and fail", () => {
  it("complete writes the patch only where the claim token still matches", async () => {
    respondWith([[CALL_ID]]);

    const ok = await repo.complete(CALL_ID, TOKEN, {
      status: "transcribed",
      transcriptText: "You: hi",
      recordingStatus: "completed",
    });

    expect(ok).toBe(true);
    const { sql, params } = statement();
    expect(sql).toMatch(/^update "call" set /);
    const set = setClause(sql);
    expect(set).toContain('"status" = $');
    expect(set).toContain('"transcript_text" = $');
    expect(set).toContain('"recording_status" = $');
    expect(set).toContain('"updated_at" = $');
    expect(whereClause(sql)).toMatch(
      /\("call"\."id" = \$\d+ and "call"\."claim_token" = \$\d+\)/
    );
    expect(params).toEqual(expect.arrayContaining([CALL_ID, TOKEN]));
  });

  it("complete returns false when the token no longer matches (zero rows)", async () => {
    respondWith([]);
    const ok = await repo.complete(CALL_ID, "stale", { status: "transcribed" });
    expect(ok).toBe(false);
    expect(statement().params).toContain("stale");
  });

  it("fail carries the same token guard and stores the error", async () => {
    respondWith([[CALL_ID]]);

    const ok = await repo.fail(CALL_ID, TOKEN, {
      status: "transcription_failed",
      lastError: "Deepgram request failed with HTTP 503",
    });

    expect(ok).toBe(true);
    const { sql, params } = statement();
    expect(setClause(sql)).toContain('"last_error" = $');
    expect(whereClause(sql)).toContain('"call"."claim_token" = $');
    expect(params).toEqual(
      expect.arrayContaining([
        "transcription_failed",
        "Deepgram request failed with HTTP 503",
        TOKEN,
      ])
    );
  });

  it("an empty patch still needs the token and updates only updated_at", async () => {
    respondWith([[CALL_ID]]);
    await repo.complete(CALL_ID, TOKEN, {});
    const set = setClause(statement().sql);
    expect(set).toBe('"updated_at" = $1');
  });
});

describe("writeDialOutcome", () => {
  const input = {
    dialCallSid: "CAbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    dialDurationSec: 42,
    endedAt: NOW,
  };

  it.each([
    ["busy", "busy"],
    ["no-answer", "no_answer"],
    ["failed", "dial_failed"],
    ["canceled", "dial_failed"],
  ] as const)(
    "%s is one guarded update from dialing to %s with the dial fields",
    async (outcome, status) => {
      respondWith([rowArray({ status })]);

      const result = await repo.writeDialOutcome(CALL_ID, {
        ...input,
        outcome,
      });

      expect(proxy.statements).toHaveLength(1);
      const { sql, params } = statement();
      const set = setClause(sql);
      expect(set).toContain('"status" = $');
      expect(set).toContain('"dial_call_sid" = $');
      expect(set).toContain('"dial_duration_sec" = $');
      expect(set).toContain('"ended_at" = $');
      expect(whereClause(sql)).toMatch(
        /\("call"\."id" = \$\d+ and "call"\."status" = \$\d+\)/
      );
      expect(params).toEqual(
        expect.arrayContaining([status, input.dialCallSid, 42, "dialing"])
      );
      expect(result).toEqual({
        row: expect.objectContaining({ status }),
        transitioned: true,
      });
    }
  );

  it("completed decides between no_recording and awaiting_recording from recording_status inside the statement", async () => {
    respondWith([rowArray({ status: "awaiting_recording" })]);

    const result = await repo.writeDialOutcome(CALL_ID, {
      ...input,
      outcome: "completed",
    });

    const { sql, params } = statement();
    const set = setClause(sql);
    expect(set).toMatch(
      /"status" = \(case when "call"\."recording_status" = \$\d+ then \$\d+ else \$\d+ end\)/
    );
    expect(params).toEqual(
      expect.arrayContaining([
        "absent",
        "no_recording",
        "awaiting_recording",
        "dialing",
      ])
    );
    expect(result?.transitioned).toBe(true);
    expect(result?.row.status).toBe("awaiting_recording");
  });

  it("when the row is no longer dialing only the dial fields are written (AE6)", async () => {
    respondWith([], [rowArray({ status: "transcribing" })]);

    const result = await repo.writeDialOutcome(CALL_ID, {
      ...input,
      outcome: "completed",
    });

    expect(proxy.statements).toHaveLength(2);
    const second = statement(1);
    const set = setClause(second.sql);
    expect(set).not.toContain('"status"');
    expect(set).toContain('"dial_call_sid" = $');
    expect(set).toContain('"dial_duration_sec" = $');
    expect(set).toContain('"ended_at" = $');
    expect(whereClause(second.sql)).toMatch(/^"call"\."id" = \$\d+$/);
    expect(result).toEqual({
      row: expect.objectContaining({ status: "transcribing" }),
      transitioned: false,
    });
  });

  it("returns null when the row does not exist at all", async () => {
    respondWith([], []);
    const result = await repo.writeDialOutcome(CALL_ID, {
      ...input,
      outcome: "busy",
    });
    expect(result).toBeNull();
  });
});

describe("writeAnsweredBy", () => {
  it("writes answered_by and the detection duration by id without touching status", async () => {
    respondWith([rowArray({ status: "dialing", answeredBy: "human" })]);

    const result = await repo.writeAnsweredBy(CALL_ID, {
      answeredBy: "human",
      machineDetectionDurationMs: 1200,
    });

    expect(proxy.statements).toHaveLength(1);
    const { sql, params } = statement();
    const set = setClause(sql);
    expect(set).toContain('"answered_by" = $');
    expect(set).toContain('"machine_detection_duration_ms" = $');
    expect(set).toContain('"updated_at" = $');
    expect(set).not.toContain('"status"');
    expect(whereClause(sql)).toMatch(/^"call"\."id" = \$\d+$/);
    expect(params).toEqual(expect.arrayContaining(["human", 1200, CALL_ID]));
    expect(result).toEqual(expect.objectContaining({ answeredBy: "human" }));
  });

  it("stores a missing duration as null and returns null for an unknown row", async () => {
    respondWith([]);
    const result = await repo.writeAnsweredBy(CALL_ID, {
      answeredBy: "machine_end_beep",
      machineDetectionDurationMs: null,
    });
    const { params } = statement();
    expect(params).toEqual(
      expect.arrayContaining(["machine_end_beep", null, CALL_ID])
    );
    expect(result).toBeNull();
  });
});

describe("writeRecording", () => {
  it("atomically reopens a previously absent recording without changing other call statuses", async () => {
    respondWith([[CALL_ID]]);
    await repo.writeRecording(CALL_ID, {
      recordingSid: "RElate",
      startedAt: NOW,
      durationSec: 42,
    });
    expect(setClause(statement().sql)).toMatch(
      /"status" = case when "call"\."status" = \$\d+ then \$\d+ else "call"\."status" end/
    );
    expect(statement().params).toEqual(
      expect.arrayContaining(["no_recording", "awaiting_recording"])
    );
  });

  const input = {
    recordingSid: "REcccccccccccccccccccccccccccccccc",
    startedAt: NOW,
    durationSec: 42,
  };

  it("stores the recording only where recording_sid is still null", async () => {
    respondWith([[CALL_ID]]);

    const result = await repo.writeRecording(CALL_ID, input);

    expect(result).toBe("stored");
    expect(proxy.statements).toHaveLength(1);
    const { sql, params } = statement();
    const set = setClause(sql);
    expect(set).toContain('"recording_sid" = $');
    expect(set).toContain('"recording_status" = $');
    expect(set).toContain('"recording_started_at" = $');
    expect(set).toContain('"recording_duration_sec" = $');
    expect(whereClause(sql)).toMatch(
      /\("call"\."id" = \$\d+ and "call"\."recording_sid" is null\)/
    );
    expect(params).toEqual(
      expect.arrayContaining([input.recordingSid, "completed", 42, CALL_ID])
    );
  });

  it("reports a duplicate when the row already holds the same SID, writing nothing", async () => {
    respondWith([], [rowArray({ recordingSid: input.recordingSid })]);

    const result = await repo.writeRecording(CALL_ID, input);

    expect(result).toBe("duplicate");
    expect(proxy.statements).toHaveLength(2);
    expect(statement(1).sql).toMatch(/^select /);
  });

  it("reports a different SID and never overwrites it", async () => {
    respondWith([], [rowArray({ recordingSid: "REother" })]);

    const result = await repo.writeRecording(CALL_ID, input);

    expect(result).toBe("different_sid");
    expect(
      proxy.statements.filter((s) => s.sql.startsWith("update"))
    ).toHaveLength(1);
  });
});

describe("markRecordingAbsent", () => {
  it("does not overwrite a completed recording when an absent callback arrives late", async () => {
    respondWith(
      [],
      [],
      [
        rowArray({
          status: "awaiting_recording",
          recordingSid: "REcomplete",
          recordingStatus: "completed",
        }),
      ]
    );
    const result = await repo.markRecordingAbsent(CALL_ID);
    expect(result?.row.recordingStatus).toBe("completed");
    expect(result?.transitioned).toBe(false);
    for (const query of proxy.statements.filter((s) =>
      s.sql.startsWith("update")
    )) {
      expect(whereClause(query.sql)).toContain(
        '"call"."recording_sid" is null'
      );
    }
  });

  it("moves awaiting_recording to no_recording in one guarded update", async () => {
    respondWith([
      rowArray({ status: "no_recording", recordingStatus: "absent" }),
    ]);

    const result = await repo.markRecordingAbsent(CALL_ID);

    expect(proxy.statements).toHaveLength(1);
    const { sql, params } = statement();
    const set = setClause(sql);
    expect(set).toContain('"recording_status" = $');
    expect(set).toContain('"status" = $');
    expect(whereClause(sql)).toMatch(
      /\("call"\."id" = \$\d+ and "call"\."status" = \$\d+ and "call"\."recording_sid" is null\)/
    );
    expect(params).toEqual(
      expect.arrayContaining(["absent", "no_recording", "awaiting_recording"])
    );
    expect(result).toEqual({
      row: expect.objectContaining({ status: "no_recording" }),
      transitioned: true,
    });
  });

  it("in any other status only sets recording_status (busy then absent stays busy)", async () => {
    respondWith([], [rowArray({ status: "busy", recordingStatus: "absent" })]);

    const result = await repo.markRecordingAbsent(CALL_ID);

    expect(proxy.statements).toHaveLength(2);
    const second = statement(1);
    const set = setClause(second.sql);
    expect(set).toContain('"recording_status" = $');
    expect(set).not.toContain('"status"');
    expect(whereClause(second.sql)).toMatch(
      /\("call"\."id" = \$\d+ and "call"\."recording_sid" is null\)/
    );
    expect(result).toEqual({
      row: expect.objectContaining({
        status: "busy",
        recordingStatus: "absent",
      }),
      transitioned: false,
    });
  });
});

describe("getCallForPipeline", () => {
  it("joins the user's email and name and the profile timezone onto the call row", async () => {
    respondWith([
      [
        ...rowArray({ status: "emailing" }),
        "sanjeev@example.com",
        "Sanjeev",
        "America/Los_Angeles",
      ],
    ]);

    const result = await repo.getCallForPipeline(CALL_ID);

    const { sql, params } = statement();
    expect(sql).toMatch(/^select /);
    expect(sql).toContain('inner join "user"');
    expect(sql).toContain('inner join "user_profile"');
    expect(sql).toContain('"call"."id" = $1');
    expect(params).toEqual([CALL_ID, 1]);
    expect(result).toEqual({
      call: expect.objectContaining({ id: CALL_ID, status: "emailing" }),
      user: {
        email: "sanjeev@example.com",
        name: "Sanjeev",
        timezone: "America/Los_Angeles",
      },
    });
  });

  it("returns null for an unknown call", async () => {
    respondWith([]);
    expect(await repo.getCallForPipeline("nope")).toBeNull();
  });
});

describe("pipeline claim concurrency guards", () => {
  it("rechecks transcription lease expiry atomically during takeover", async () => {
    respondWith([]);
    await repo.claim(CALL_ID, {
      step: "transcribing",
      fromStatuses: ["transcribing"],
    });
    const where = whereClause(statement().sql);
    expect(where).toContain('"call"."claimed_at" < now()');
    expect(where).toContain("interval '10 minutes'");
    expect(where).toContain('coalesce("call"."recording_duration_sec", 0)');
  });
  it("rechecks email lease expiry even after the user confirms a resend", async () => {
    respondWith([]);
    await repo.claim(CALL_ID, { step: "emailing", fromStatuses: ["emailing"] });
    expect(whereClause(statement().sql)).toContain(
      '"call"."email_claimed_at" < now()'
    );
  });
  it("only claims metadata that has never been claimed or explicitly failed", async () => {
    respondWith([]);
    await repo.claim(CALL_ID, {
      step: "metadata_email",
      fromStatuses: ["no_recording"],
    });
    const where = whereClause(statement().sql);
    expect(where).toContain(
      '("call"."email_claimed_at" is null or "call"."last_email_error" is not null)'
    );
    expect(setClause(statement().sql)).toContain('"last_email_error" = $');
  });
});

describe("findUserByPhone", () => {
  it("only identifies callers with verified phone ownership and completed names", async () => {
    respondWith([["user-1", "UTC", "person@gmail.com", "Sanjeev Kumar"]]);
    expect(await repo.findUserByPhone("+16045551234")).toEqual({
      userId: "user-1",
      timezone: "UTC",
      email: "person@gmail.com",
      firstName: "Sanjeev Kumar",
    });
    const query = statement();
    expect(query.sql).toContain(
      '"user_profile"."phone_verified_at" is not null'
    );
    expect(query.sql).toContain(
      'length(trim("user_profile"."first_name")) > 0'
    );
    expect(query.sql).toContain('length(trim("user_profile"."last_name")) > 0');
    expect(query.params).toContain("+16045551234");
    expect(query.sql).not.toContain('"user"."name"');
  });
  it("returns null when caller setup is incomplete or phone is unknown", async () => {
    respondWith([]);
    expect(await repo.findUserByPhone("+16045551234")).toBeNull();
  });
});
