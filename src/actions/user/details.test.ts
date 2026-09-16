// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rows: vi.fn(),
  insert: vi.fn(),
  conflict: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/db", () => {
  const tx = {
    insert: () => ({
      values: (value: unknown) => {
        mocks.insert(value);
        return { onConflictDoUpdate: mocks.conflict };
      },
    }),
    update: () => ({
      set: (value: unknown) => {
        mocks.update(value);
        return { where: async () => undefined };
      },
    }),
  };
  return {
    db: {
      select: () => ({
        from: () => ({ where: () => ({ limit: mocks.rows }) }),
      }),
      transaction: (fn: (value: typeof tx) => Promise<void>) => {
        mocks.transaction();
        return fn(tx);
      },
    },
  };
});
import { getMyDetails, saveMyDetails } from "./details";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "owner" } });
  mocks.rows.mockResolvedValue([]);
  mocks.conflict.mockResolvedValue(undefined);
});

describe("profile details actions", () => {
  it("authenticates before validation or database access", async () => {
    mocks.session.mockResolvedValue(null);
    expect(await saveMyDetails(null)).toEqual({
      success: false,
      error: "Not authenticated",
    });
    expect(await getMyDetails()).toEqual({
      success: false,
      error: "Not authenticated",
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.rows).not.toHaveBeenCalled();
  });
  it("does not silently use Google's name for an incomplete profile", async () => {
    expect(await getMyDetails()).toEqual({
      success: true,
      data: { firstName: null, lastName: null },
    });
  });
  it("rejects invalid names without saving", async () => {
    expect(
      (await saveMyDetails({ firstName: " ", lastName: "Nandam" })).success
    ).toBe(false);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("saves trimmed names to the session owner's profile and display name atomically", async () => {
    expect(
      await saveMyDetails({
        userId: "someone-else",
        firstName: " Sanjeev Kumar ",
        lastName: " Nandam ",
      })
    ).toEqual({
      success: true,
      data: { firstName: "Sanjeev Kumar", lastName: "Nandam" },
    });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.insert).toHaveBeenCalledWith({
      userId: "owner",
      firstName: "Sanjeev Kumar",
      lastName: "Nandam",
    });
    expect(mocks.update).toHaveBeenCalledWith({
      name: "Sanjeev Kumar Nandam",
      updatedAt: expect.any(Date),
    });
    expect(mocks.revalidate).toHaveBeenCalledWith("/", "layout");
  });
  it("returns a safe error and does not update the auth name if profile saving fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.conflict.mockRejectedValueOnce(new Error("db failed"));
    expect(
      await saveMyDetails({ firstName: "Sanjeev", lastName: "Nandam" })
    ).toEqual({ success: false, error: "Failed to save your details" });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
