// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSession,
  mockProfileRows,
  mockContactRows,
  mockLockedProfile,
  mockInsertValues,
  mockInsertReturning,
  mockUpdateSet,
  mockUpdateReturning,
  mockDeleteReturning,
  mockTransaction,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockProfileRows: vi.fn(),
  mockContactRows: vi.fn(),
  mockLockedProfile: vi.fn(),
  mockInsertValues: vi.fn(),
  mockInsertReturning: vi.fn(),
  mockUpdateSet: vi.fn(),
  mockUpdateReturning: vi.fn(),
  mockDeleteReturning: vi.fn(),
  mockTransaction: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock("@/lib/batphone/require-profile", () => ({
  requireCompletedProfile: vi
    .fn()
    .mockResolvedValue({ firstName: "Sanjeev", lastName: "" }),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: mockGetSession } },
}));

/**
 * A minimal drizzle stand-in. Reads are routed by table; writes record the
 * table name and the values so tests can assert what would be persisted.
 * `transaction` runs the callback against the same fake so the tests can
 * see that the row lock, the read of used codes, and the insert share one
 * call. A bare `where()` is awaitable so reads without `limit`/`orderBy`
 * work too.
 */
vi.mock("@/db", async () => {
  const { contact, userProfile } = await import("@/db/schema");
  const tableName = (table: unknown) =>
    table === contact ? "contact" : table === userProfile ? "profile" : "?";
  const rowsFor = (table: unknown) =>
    table === userProfile ? mockProfileRows() : mockContactRows();

  const select = () => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: async () => rowsFor(table),
        orderBy: async () => rowsFor(table),
        for: async () => mockLockedProfile(),
        then: (
          resolve: (rows: unknown) => void,
          reject: (error: unknown) => void
        ) => Promise.resolve(rowsFor(table)).then(resolve, reject),
      }),
    }),
  });
  const insert = (table: unknown) => ({
    values: (values: unknown) => {
      mockInsertValues(tableName(table), values);
      return {
        onConflictDoNothing: async () => undefined,
        returning: async () => mockInsertReturning(values),
      };
    },
  });
  const update = (table: unknown) => ({
    set: (values: unknown) => {
      mockUpdateSet(tableName(table), values);
      return {
        where: () => ({
          then: (resolve: (value: undefined) => void) => resolve(undefined),
          returning: async () => mockUpdateReturning(values),
        }),
      };
    },
  });
  const del = () => ({
    where: () => ({
      returning: async () => mockDeleteReturning(),
    }),
  });
  const fake = { select, insert, update, delete: del };
  const transaction = async (fn: (tx: typeof fake) => Promise<unknown>) => {
    mockTransaction();
    return fn(fake);
  };
  return { db: { ...fake, transaction } };
});

import {
  createContact,
  deleteContact,
  listContacts,
  updateContact,
} from "./index";

const session = { user: { id: "user-1", email: "a@example.com" } };
const OWN_NUMBER = "+14155552671";
const BAT_NUMBER = "+14155559999";

const DUPLICATE_MESSAGE = (existing: string, entered: string) =>
  `You already have a contact called ${existing}. The bat phone matches contacts by spoken name, so give this one a label you can say, like ${entered} B or ${entered} at work.`;

interface InsertedContact {
  userId: string;
  name: string;
  nameNormalized: string;
  phone: string;
  speedDial: number;
}

function insertedContacts(): InsertedContact[] {
  return mockInsertValues.mock.calls
    .filter(([table]) => table === "contact")
    .map(([, values]) => values as InsertedContact);
}

function profileUpdates(): Array<Record<string, unknown>> {
  return mockUpdateSet.mock.calls
    .filter(([table]) => table === "profile")
    .map(([, values]) => values as Record<string, unknown>);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TWILIO_PHONE_NUMBER = BAT_NUMBER;
  mockGetSession.mockResolvedValue(session);
  mockProfileRows.mockResolvedValue([{ phoneNumber: OWN_NUMBER }]);
  mockContactRows.mockResolvedValue([]);
  mockLockedProfile.mockResolvedValue([{ userId: "user-1" }]);
  mockInsertReturning.mockImplementation((values: InsertedContact) => [
    { id: "contact-new", ...values, createdAt: new Date() },
  ]);
  mockUpdateReturning.mockImplementation(
    (values: { name: string; phone: string }) => [
      { id: "contact-1", name: values.name, phone: values.phone, speedDial: 1 },
    ]
  );
  mockDeleteReturning.mockResolvedValue([{ id: "contact-2" }]);
});

afterEach(() => {
  delete process.env.TWILIO_PHONE_NUMBER;
  // Contact creation may only stamp onboarding completion, never alter phone ownership.
  for (const update of profileUpdates()) {
    expect(Object.keys(update).sort()).toEqual([
      "onboardingCompletedAt",
      "updatedAt",
    ]);
  }
});

/** Contact rows with the given speed dials, for the used-code reads. */
function contactsWithCodes(codes: number[]) {
  return codes.map((code) => ({
    id: `contact-${code}`,
    name: `Contact ${code}`,
    nameNormalized: `contact ${code}`,
    phone: `+1415555${String(code).padStart(4, "0")}`,
    speedDial: code,
  }));
}

describe("unauthenticated", () => {
  beforeEach(() => mockGetSession.mockResolvedValue(null));

  it("listContacts", async () => {
    expect(await listContacts()).toEqual({
      success: false,
      error: "Not authenticated",
    });
  });

  it("createContact writes nothing", async () => {
    expect(
      await createContact({ name: "Mike", phone: "+14155550100" })
    ).toEqual({ success: false, error: "Not authenticated" });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("updateContact writes nothing", async () => {
    expect(
      await updateContact({
        id: "contact-1",
        name: "Mike",
        phone: "+14155550100",
      })
    ).toEqual({ success: false, error: "Not authenticated" });
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("deleteContact writes nothing", async () => {
    expect(await deleteContact({ id: "contact-1" })).toEqual({
      success: false,
      error: "Not authenticated",
    });
    expect(mockDeleteReturning).not.toHaveBeenCalled();
  });
});

describe("listContacts", () => {
  it("returns the user's contacts", async () => {
    mockContactRows.mockResolvedValue([
      { id: "contact-1", name: "Mike", phone: "+14155550100", speedDial: 1 },
      { id: "contact-2", name: "Priya", phone: "+14155550101", speedDial: 2 },
    ]);
    expect(await listContacts()).toEqual({
      success: true,
      data: [
        { id: "contact-1", name: "Mike", phone: "+14155550100", speedDial: 1 },
        { id: "contact-2", name: "Priya", phone: "+14155550101", speedDial: 2 },
      ],
    });
  });
});

describe("createContact", () => {
  it("gives a fresh user code 1, locking the profile row inside the transaction", async () => {
    const first = await createContact({
      name: " Mike Anderson ",
      phone: "(415) 555-0100",
    });
    expect(first).toEqual({
      success: true,
      data: {
        contact: {
          id: "contact-new",
          name: "Mike Anderson",
          phone: "+14155550100",
          speedDial: 1,
        },
        sameNumberAs: null,
      },
    });
    expect(insertedContacts()).toEqual([
      {
        userId: "user-1",
        name: "Mike Anderson",
        nameNormalized: "mike anderson",
        phone: "+14155550100",
        speedDial: 1,
      },
    ]);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockLockedProfile).toHaveBeenCalledTimes(1);
    const [txOrder] = mockTransaction.mock.invocationCallOrder;
    const [lockOrder] = mockLockedProfile.mock.invocationCallOrder;
    const [insertOrder] = mockInsertValues.mock.invocationCallOrder.slice(-1);
    expect(txOrder).toBeLessThan(lockOrder!);
    expect(lockOrder).toBeLessThan(insertOrder!);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/contacts");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(profileUpdates()).toHaveLength(1);
    expect(mockInsertReturning.mock.invocationCallOrder[0]).toBeLessThan(
      mockUpdateSet.mock.invocationCallOrder[0]!
    );
  });

  it("gives the next code after a full run: used 1 and 2 gets 3", async () => {
    mockContactRows.mockResolvedValue(contactsWithCodes([1, 2]));
    const result = await createContact({
      name: "Front Desk",
      phone: "+14155550102",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contact.speedDial).toBe(3);
    }
    expect(insertedContacts().map((c) => c.speedDial)).toEqual([3]);
  });

  it("hands a deleted contact's code out again: used 1 and 3 gets 2", async () => {
    mockContactRows.mockResolvedValue(contactsWithCodes([1, 2, 3]));
    expect(await deleteContact({ id: "contact-2" })).toEqual({
      success: true,
      data: null,
    });

    mockContactRows.mockResolvedValue(contactsWithCodes([1, 3]));
    const result = await createContact({
      name: "Front Desk",
      phone: "+14155550102",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contact.speedDial).toBe(2);
    }
    expect(insertedContacts().map((c) => c.speedDial)).toEqual([2]);
  });

  it("gives code 1 when it is free even though higher codes are used", async () => {
    mockContactRows.mockResolvedValue(contactsWithCodes([2, 3]));
    const result = await createContact({
      name: "Front Desk",
      phone: "+14155550102",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contact.speedDial).toBe(1);
    }
  });

  it("fails without inserting when the profile row lock finds no row", async () => {
    mockLockedProfile.mockResolvedValue([]);
    expect(
      await createContact({ name: "Mike", phone: "+14155550100" })
    ).toEqual({ success: false, error: "Failed to save the contact" });
    expect(insertedContacts()).toEqual([]);
  });

  it("rejects a duplicate name that differs only in case with the exact message", async () => {
    mockContactRows.mockResolvedValue([
      {
        id: "contact-1",
        name: "Mike",
        nameNormalized: "mike",
        phone: "+14155550100",
      },
    ]);
    expect(
      await createContact({ name: "MIKE", phone: "+14155550105" })
    ).toEqual({ success: false, error: DUPLICATE_MESSAGE("Mike", "MIKE") });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("maps a unique-index race on the name to the duplicate message", async () => {
    mockInsertReturning.mockImplementation(() => {
      throw Object.assign(new Error("duplicate key"), {
        code: "23505",
        constraint_name: "contact_user_id_name_normalized_idx",
      });
    });
    const result = await createContact({ name: "Mike", phone: "+14155550105" });
    expect(result).toEqual({
      success: false,
      error: DUPLICATE_MESSAGE("Mike", "Mike"),
    });
  });

  it("rejects the user's own number", async () => {
    expect(await createContact({ name: "Me", phone: OWN_NUMBER })).toEqual({
      success: false,
      error: "That is your own number",
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects the bat phone number", async () => {
    expect(await createContact({ name: "Bat", phone: BAT_NUMBER })).toEqual({
      success: false,
      error: "That is the bat phone number",
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("allows a number another contact already has and names that contact", async () => {
    mockContactRows.mockResolvedValue([
      {
        id: "contact-1",
        name: "Mike Anderson",
        nameNormalized: "mike anderson",
        phone: "+14155550100",
        speedDial: 1,
      },
    ]);
    expect(
      await createContact({ name: "Front Desk", phone: "+14155550100" })
    ).toEqual({
      success: true,
      data: {
        contact: {
          id: "contact-new",
          name: "Front Desk",
          phone: "+14155550100",
          speedDial: 2,
        },
        sameNumberAs: "Mike Anderson",
      },
    });
  });

  it("rejects an invalid phone number before touching the database", async () => {
    const result = await createContact({ name: "Mike", phone: "123" });
    expect(result.success).toBe(false);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects a name with nothing sayable in it", async () => {
    expect(await createContact({ name: "!!!", phone: "+14155550100" })).toEqual(
      { success: false, error: "Enter a name with letters or numbers" }
    );
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("uses a chosen speed dial even when a lower one is free", async () => {
    mockContactRows.mockResolvedValue(contactsWithCodes([1]));
    const result = await createContact({
      name: "Mike",
      phone: "+14155550100",
      speedDial: "3",
    });
    expect(result).toEqual({
      success: true,
      data: {
        contact: {
          id: "contact-new",
          name: "Mike",
          phone: "+14155550100",
          speedDial: 3,
        },
        sameNumberAs: null,
      },
    });
    expect(insertedContacts().map((c) => c.speedDial)).toEqual([3]);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("gives the gap left below a chosen code to the next automatic contact", async () => {
    mockContactRows.mockResolvedValue(contactsWithCodes([1, 42]));
    const result = await createContact({
      name: "Priya",
      phone: "+14155550101",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contact.speedDial).toBe(2);
    }
  });

  it("rejects a speed dial another contact already has, naming that contact", async () => {
    mockContactRows.mockResolvedValue([
      {
        id: "contact-1",
        name: "Mike Anderson",
        nameNormalized: "mike anderson",
        phone: "+14155550100",
        speedDial: 7,
      },
    ]);
    expect(
      await createContact({
        name: "Front Desk",
        phone: "+14155550102",
        speedDial: "7",
      })
    ).toEqual({
      success: false,
      error: "Speed dial 7 is already used by Mike Anderson.",
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("maps a unique-index race on the speed dial to the same message", async () => {
    mockInsertReturning.mockImplementation(() => {
      throw Object.assign(new Error("duplicate key"), {
        code: "23505",
        constraint_name: "contact_user_id_speed_dial_idx",
      });
    });
    mockContactRows.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: "contact-1",
        name: "Mike Anderson",
        nameNormalized: "mike anderson",
        phone: "+14155550100",
        speedDial: 7,
      },
    ]);
    expect(
      await createContact({
        name: "Front Desk",
        phone: "+14155550102",
        speedDial: "7",
      })
    ).toEqual({
      success: false,
      error: "Speed dial 7 is already used by Mike Anderson.",
    });
  });

  it("Zod: rejects a speed dial outside 1 to 9999 before touching the database", async () => {
    expect(
      (
        await createContact({
          name: "Mike",
          phone: "+14155550100",
          speedDial: "0",
        })
      ).success
    ).toBe(false);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("Zod: rejects a blank name and a name over 100 characters", async () => {
    expect(
      (await createContact({ name: "  ", phone: "+14155550100" })).success
    ).toBe(false);
    expect(
      (await createContact({ name: "a".repeat(101), phone: "+14155550100" }))
        .success
    ).toBe(false);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

describe("updateContact", () => {
  const existing = [
    {
      id: "contact-1",
      name: "Mike",
      nameNormalized: "mike",
      phone: "+14155550100",
      speedDial: 1,
    },
    {
      id: "contact-2",
      name: "Priya",
      nameNormalized: "priya",
      phone: "+14155550101",
      speedDial: 2,
    },
  ];

  beforeEach(() => mockContactRows.mockResolvedValue(existing));

  it("renames and re-normalises the name and phone", async () => {
    expect(
      await updateContact({
        id: "contact-1",
        name: "  Mike B ",
        phone: "(415) 555-0199",
      })
    ).toEqual({
      success: true,
      data: {
        contact: {
          id: "contact-1",
          name: "Mike B",
          phone: "+14155550199",
          speedDial: 1,
        },
        sameNumberAs: null,
      },
    });
    const [, values] = mockUpdateSet.mock.calls[0] ?? [];
    expect(values).toMatchObject({
      name: "Mike B",
      nameNormalized: "mike b",
      phone: "+14155550199",
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/contacts");
  });

  it("keeps the code when none is given, with no transaction", async () => {
    await updateContact({
      id: "contact-1",
      name: "Mike",
      phone: "+14155550100",
    });
    const [, values] = mockUpdateSet.mock.calls[0] ?? [];
    expect(values).not.toHaveProperty("speedDial");
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockLockedProfile).not.toHaveBeenCalled();
  });

  it("changes the speed dial with a single update, no lock or transaction", async () => {
    mockUpdateReturning.mockImplementation(
      (values: { name: string; phone: string; speedDial: number }) => [
        {
          id: "contact-1",
          name: values.name,
          phone: values.phone,
          speedDial: values.speedDial,
        },
      ]
    );
    const result = await updateContact({
      id: "contact-1",
      name: "Mike",
      phone: "+14155550100",
      speedDial: "8",
    });
    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        contact: expect.objectContaining({ speedDial: 8 }),
      }),
    });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockLockedProfile).not.toHaveBeenCalled();
    const contactUpdate = mockUpdateSet.mock.calls.find(
      ([table]) => table === "contact"
    );
    expect(contactUpdate?.[1]).toMatchObject({ speedDial: 8 });
  });

  it("treats its own speed dial as unchanged", async () => {
    await updateContact({
      id: "contact-1",
      name: "Mike",
      phone: "+14155550100",
      speedDial: "1",
    });
    const [, values] = mockUpdateSet.mock.calls[0] ?? [];
    expect(values).not.toHaveProperty("speedDial");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("maps a unique-index race on a changed speed dial to the holder's name", async () => {
    mockUpdateReturning.mockImplementation(() => {
      throw Object.assign(new Error("duplicate key"), {
        code: "23505",
        constraint_name: "contact_user_id_speed_dial_idx",
      });
    });
    mockContactRows.mockResolvedValueOnce(existing).mockResolvedValueOnce([
      ...existing,
      {
        id: "contact-3",
        name: "Late Arrival",
        nameNormalized: "late arrival",
        phone: "+14155550103",
        speedDial: 8,
      },
    ]);
    expect(
      await updateContact({
        id: "contact-1",
        name: "Mike",
        phone: "+14155550100",
        speedDial: "8",
      })
    ).toEqual({
      success: false,
      error: "Speed dial 8 is already used by Late Arrival.",
    });
  });

  it("rejects moving to another contact's speed dial, naming that contact", async () => {
    expect(
      await updateContact({
        id: "contact-1",
        name: "Mike",
        phone: "+14155550100",
        speedDial: "2",
      })
    ).toEqual({
      success: false,
      error: "Speed dial 2 is already used by Priya.",
    });
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("allows changing only the case of its own name", async () => {
    const result = await updateContact({
      id: "contact-1",
      name: "MIKE",
      phone: "+14155550100",
    });
    expect(result.success).toBe(true);
  });

  it("rejects renaming to another contact's name", async () => {
    expect(
      await updateContact({
        id: "contact-1",
        name: "priya",
        phone: "+14155550100",
      })
    ).toEqual({ success: false, error: DUPLICATE_MESSAGE("Priya", "priya") });
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("reports the other contact holding the same number", async () => {
    const result = await updateContact({
      id: "contact-1",
      name: "Mike",
      phone: "+14155550101",
    });
    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({ sameNumberAs: "Priya" }),
    });
  });

  it("rejects the user's own number and the bat phone number", async () => {
    expect(
      await updateContact({ id: "contact-1", name: "Mike", phone: OWN_NUMBER })
    ).toEqual({ success: false, error: "That is your own number" });
    expect(
      await updateContact({ id: "contact-1", name: "Mike", phone: BAT_NUMBER })
    ).toEqual({ success: false, error: "That is the bat phone number" });
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("rejects a contact that is not the user's", async () => {
    expect(
      await updateContact({
        id: "someone-elses",
        name: "Mike",
        phone: "+14155550100",
      })
    ).toEqual({ success: false, error: "Contact not found" });
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });
});

describe("deleteContact", () => {
  it("returns success and revalidates", async () => {
    expect(await deleteContact({ id: "contact-2" })).toEqual({
      success: true,
      data: null,
    });
    expect(mockDeleteReturning).toHaveBeenCalledTimes(1);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/contacts");
  });

  it("reports a contact that is not the user's", async () => {
    mockDeleteReturning.mockResolvedValue([]);
    expect(await deleteContact({ id: "someone-elses" })).toEqual({
      success: false,
      error: "Contact not found",
    });
  });

  it("Zod: rejects a blank id", async () => {
    expect((await deleteContact({ id: " " })).success).toBe(false);
    expect(mockDeleteReturning).not.toHaveBeenCalled();
  });
});

describe("onboarding completion persistence", () => {
  it("retains the original completion timestamp when adding later contacts", async () => {
    const { PgDialect } = await import("drizzle-orm/pg-core");
    await createContact({ name: "Mike", phone: "+14155550100" });
    const expression = profileUpdates()[0]?.onboardingCompletedAt;
    const { SQL } = await import("drizzle-orm");
    expect(expression).toBeInstanceOf(SQL);
    const query = new PgDialect().sqlToQuery(
      expression as InstanceType<typeof SQL>
    );
    expect(query.sql).toBe(
      'coalesce("user_profile"."onboarding_completed_at", now())'
    );
  });
  it("does not complete onboarding when the contact insert fails", async () => {
    mockInsertReturning.mockResolvedValueOnce([]);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      (await createContact({ name: "Mike", phone: "+14155550100" })).success
    ).toBe(false);
    expect(profileUpdates()).toEqual([]);
    log.mockRestore();
  });
  it("does not reset onboarding when a contact is deleted", async () => {
    expect((await deleteContact({ id: "contact-2" })).success).toBe(true);
    expect(profileUpdates()).toEqual([]);
  });
});
