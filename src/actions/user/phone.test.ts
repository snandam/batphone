// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSession,
  mockSelectRows,
  mockInsertValues,
  mockOnConflictSet,
  mockUpdateSet,
  mockStartVerification,
  mockCheckVerification,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockSelectRows: vi.fn(),
  mockInsertValues: vi.fn(),
  mockOnConflictSet: vi.fn(),
  mockUpdateSet: vi.fn(),
  mockStartVerification: vi.fn(),
  mockCheckVerification: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: mockGetSession } },
}));

vi.mock("@/lib/batphone/verify", () => ({
  createVerifyClient: () => ({
    startVerification: mockStartVerification,
    checkVerification: mockCheckVerification,
  }),
}));

vi.mock("@/db", () => {
  const select = () => ({
    from: () => ({
      where: () => ({
        limit: async () => mockSelectRows(),
      }),
    }),
  });
  const insert = () => ({
    values: (values: unknown) => {
      mockInsertValues(values);
      return {
        onConflictDoUpdate: async (conflict: { set: unknown }) => {
          mockOnConflictSet(conflict.set);
        },
      };
    },
  });
  const update = () => ({
    set: (values: unknown) => {
      mockUpdateSet(values);
      return { where: async () => undefined };
    },
  });
  return { db: { select, insert, update } };
});

import {
  confirmPhoneVerification,
  getMyPhone,
  removeMyPhone,
  startPhoneVerification,
} from "./phone";

const session = { user: { id: "user-1", email: "a@example.com" } };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(session);
  mockSelectRows.mockResolvedValue([]);
  mockStartVerification.mockResolvedValue({ ok: true });
  mockCheckVerification.mockResolvedValue({ ok: true });
});

describe("unauthenticated", () => {
  beforeEach(() => mockGetSession.mockResolvedValue(null));

  it("getMyPhone", async () => {
    expect(await getMyPhone()).toEqual({
      success: false,
      error: "Not authenticated",
    });
  });

  it("startPhoneVerification never calls Verify", async () => {
    expect(await startPhoneVerification({ phone: "+14155552671" })).toEqual({
      success: false,
      error: "Not authenticated",
    });
    expect(mockStartVerification).not.toHaveBeenCalled();
  });

  it("confirmPhoneVerification writes nothing", async () => {
    expect(
      await confirmPhoneVerification({
        phone: "+14155552671",
        code: "123456",
        timezone: "UTC",
      })
    ).toEqual({ success: false, error: "Not authenticated" });
    expect(mockCheckVerification).not.toHaveBeenCalled();
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("removeMyPhone writes nothing", async () => {
    expect(await removeMyPhone()).toEqual({
      success: false,
      error: "Not authenticated",
    });
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });
});

describe("getMyPhone", () => {
  it("returns the empty state when there is no profile row", async () => {
    expect(await getMyPhone()).toEqual({
      success: true,
      data: { phoneNumber: null, phoneVerifiedAt: null, timezone: "UTC" },
    });
  });

  it("returns the stored number, verification time, and timezone", async () => {
    const verifiedAt = new Date("2026-09-11T10:00:00Z");
    mockSelectRows.mockResolvedValue([
      {
        phoneNumber: "+14155552671",
        phoneVerifiedAt: verifiedAt,
        timezone: "America/New_York",
      },
    ]);
    expect(await getMyPhone()).toEqual({
      success: true,
      data: {
        phoneNumber: "+14155552671",
        phoneVerifiedAt: verifiedAt,
        timezone: "America/New_York",
      },
    });
  });
});

describe("startPhoneVerification", () => {
  it("rejects an invalid number before calling Verify", async () => {
    const result = await startPhoneVerification({ phone: "123" });
    expect(result.success).toBe(false);
    expect(mockStartVerification).not.toHaveBeenCalled();
  });

  it("rejects a number held by another user and never calls Verify", async () => {
    mockSelectRows.mockResolvedValue([{ userId: "user-2" }]);
    expect(await startPhoneVerification({ phone: "(415) 555-2671" })).toEqual({
      success: false,
      error: "This number is already linked to another account",
    });
    expect(mockStartVerification).not.toHaveBeenCalled();
  });

  it("allows re-verifying the caller's own number", async () => {
    mockSelectRows.mockResolvedValue([{ userId: "user-1" }]);
    expect(await startPhoneVerification({ phone: "(415) 555-2671" })).toEqual({
      success: true,
      data: { phone: "+14155552671" },
    });
    expect(mockStartVerification).toHaveBeenCalledTimes(1);
  });

  it("calls Verify once with the E.164 value for a new number", async () => {
    expect(await startPhoneVerification({ phone: "(415) 555-2671" })).toEqual({
      success: true,
      data: { phone: "+14155552671" },
    });
    expect(mockStartVerification).toHaveBeenCalledTimes(1);
    expect(mockStartVerification).toHaveBeenCalledWith("+14155552671");
  });

  it("tells the user to check the number when the send fails", async () => {
    mockStartVerification.mockResolvedValue({
      ok: false,
      reason: "send_failed",
    });
    const result = await startPhoneVerification({ phone: "+14155552671" });
    expect(result).toEqual({
      success: false,
      error:
        "We couldn't send a code to that number. Check the number and try again.",
    });
  });

  it("reports too many send attempts", async () => {
    mockStartVerification.mockResolvedValue({
      ok: false,
      reason: "max_attempts",
    });
    expect(await startPhoneVerification({ phone: "+14155552671" })).toEqual({
      success: false,
      error: "Too many attempts. Wait ten minutes and try again.",
    });
  });

  it("reports an unavailable service", async () => {
    mockStartVerification.mockResolvedValue({
      ok: false,
      reason: "unavailable",
    });
    expect(await startPhoneVerification({ phone: "+14155552671" })).toEqual({
      success: false,
      error: "Verification is unavailable right now. Try again in a moment.",
    });
  });
});

describe("confirmPhoneVerification (AE11)", () => {
  const input = {
    phone: "+14155552671",
    code: "123456",
    timezone: "America/Los_Angeles",
  };

  it("rejects a malformed code before calling Verify", async () => {
    const result = await confirmPhoneVerification({ ...input, code: "12" });
    expect(result.success).toBe(false);
    expect(mockCheckVerification).not.toHaveBeenCalled();
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("rejects a wrong code and writes nothing", async () => {
    mockCheckVerification.mockResolvedValue({
      ok: false,
      reason: "wrong_code",
    });
    expect(await confirmPhoneVerification(input)).toEqual({
      success: false,
      error: "That code is not right. Check the text message and try again.",
    });
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("saves the number, verified_at, and timezone on the right code", async () => {
    const before = Date.now();
    const result = await confirmPhoneVerification(input);
    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        phoneNumber: "+14155552671",
        timezone: "America/Los_Angeles",
      }),
    });
    expect(mockCheckVerification).toHaveBeenCalledWith(
      "+14155552671",
      "123456"
    );
    expect(mockInsertValues).toHaveBeenCalledTimes(1);
    const values = mockInsertValues.mock.calls[0]?.[0] as {
      userId: string;
      phoneNumber: string;
      phoneVerifiedAt: Date;
      timezone: string;
    };
    expect(values.userId).toBe("user-1");
    expect(values.phoneNumber).toBe("+14155552671");
    expect(values.timezone).toBe("America/Los_Angeles");
    expect(values.phoneVerifiedAt.getTime()).toBeGreaterThanOrEqual(before);
    const set = mockOnConflictSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(set.phoneNumber).toBe("+14155552671");
    expect(set.timezone).toBe("America/Los_Angeles");
    expect(set.phoneVerifiedAt).toBeInstanceOf(Date);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/setup");
  });

  it("stores the number in E.164 even when the input was formatted", async () => {
    await confirmPhoneVerification({ ...input, phone: "(415) 555-2671" });
    expect(mockCheckVerification).toHaveBeenCalledWith(
      "+14155552671",
      "123456"
    );
    const values = mockInsertValues.mock.calls[0]?.[0] as {
      phoneNumber: string;
    };
    expect(values.phoneNumber).toBe("+14155552671");
  });

  it("falls back to UTC for an unknown timezone", async () => {
    await confirmPhoneVerification({ ...input, timezone: "Not/AZone" });
    const values = mockInsertValues.mock.calls[0]?.[0] as { timezone: string };
    expect(values.timezone).toBe("UTC");
  });

  it("re-checks the other-user guard at confirm time", async () => {
    mockSelectRows.mockResolvedValue([{ userId: "user-2" }]);
    expect(await confirmPhoneVerification(input)).toEqual({
      success: false,
      error: "This number is already linked to another account",
    });
    expect(mockCheckVerification).not.toHaveBeenCalled();
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("maps an expired code and writes nothing", async () => {
    mockCheckVerification.mockResolvedValue({ ok: false, reason: "expired" });
    expect(await confirmPhoneVerification(input)).toEqual({
      success: false,
      error: "That code has expired. Send a new one and try again.",
    });
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("maps too many attempts and writes nothing", async () => {
    mockCheckVerification.mockResolvedValue({
      ok: false,
      reason: "max_attempts",
    });
    expect(await confirmPhoneVerification(input)).toEqual({
      success: false,
      error: "Too many attempts. Wait ten minutes and try again.",
    });
    expect(mockInsertValues).not.toHaveBeenCalled();
  });
});

describe("removeMyPhone", () => {
  it("clears phone_number and phone_verified_at", async () => {
    expect(await removeMyPhone()).toEqual({ success: true, data: null });
    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    const set = mockUpdateSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(set.phoneNumber).toBeNull();
    expect(set.phoneVerifiedAt).toBeNull();
    expect(mockRevalidatePath).toHaveBeenCalledWith("/setup");
  });
});
