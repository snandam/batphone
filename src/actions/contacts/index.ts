"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";

import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { contact, userProfile } from "@/db/schema";
import { auth } from "@/lib/auth";
import { batPhoneNumber, defaultPhoneRegion } from "@/lib/batphone/config";
import { normalizeToE164 } from "@/lib/batphone/phone";
import { requireCompletedProfile } from "@/lib/batphone/require-profile";
import {
  lowestFreeSpeedDial,
  normalizeContactName,
} from "@/lib/batphone/speed-dial";
import {
  contactIdSchema,
  createContactSchema,
  updateContactSchema,
  validateInput,
} from "@/lib/validations";
import type { ActionResult } from "@/types";

/**
 * Contacts server actions
 *
 * Every query is scoped to the session user. Names are unique per user
 * after normalisation because the bat phone matches contacts by spoken
 * name. Numbers are not unique (R27): saving one another contact already
 * has succeeds and reports that contact's name. Speed-dial codes are
 * unique per user: by default a new contact gets the lowest code none of
 * the user's contacts uses, so a deleted contact's code is handed out
 * again (R5), and a user may choose or change a code (R29).
 */

export interface ContactSummary {
  id: string;
  name: string;
  /** E.164. */
  phone: string;
  speedDial: number;
}

export interface SavedContact {
  contact: ContactSummary;
  /** Name of another contact that already has this number, if any. */
  sameNumberAs: string | null;
}

const CONTACTS_PATH = "/contacts";
const NOT_FOUND = "Contact not found";
const OWN_NUMBER = "That is your own number";
const BAT_NUMBER = "That is the bat phone number";
const UNSAYABLE_NAME = "Enter a name with letters or numbers";
const NAME_INDEX = "contact_user_id_name_normalized_idx";
const SPEED_DIAL_INDEX = "contact_user_id_speed_dial_idx";

function duplicateSpeedDialMessage(code: number, holder: string): string {
  return `Speed dial ${code} is already used by ${holder}.`;
}

function duplicateNameMessage(existing: string, entered: string): string {
  return `You already have a contact called ${existing}. The bat phone matches contacts by spoken name, so give this one a label you can say, like ${entered} B or ${entered} at work.`;
}

async function currentUserId(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) return null;
  await requireCompletedProfile(session.user.id);
  return session.user.id;
}

interface ExistingContact {
  id: string;
  name: string;
  nameNormalized: string;
  phone: string;
  speedDial: number;
}

/** The user's contacts in code order, with the fields the checks need. */
async function loadExisting(userId: string): Promise<ExistingContact[]> {
  return db
    .select({
      id: contact.id,
      name: contact.name,
      nameNormalized: contact.nameNormalized,
      phone: contact.phone,
      speedDial: contact.speedDial,
    })
    .from(contact)
    .where(eq(contact.userId, userId))
    .orderBy(asc(contact.speedDial));
}

/**
 * The friendly message when the chosen code belongs to another contact.
 * Null when the code is free or when it is the edited contact's own.
 */
function speedDialTaken(
  code: number,
  existing: ExistingContact[],
  selfId: string | null
): string | null {
  const holder = existing.find((c) => c.speedDial === code && c.id !== selfId);
  return holder ? duplicateSpeedDialMessage(code, holder.name) : null;
}

async function loadOwnNumber(userId: string): Promise<string | null> {
  const [profile] = await db
    .select({ phoneNumber: userProfile.phoneNumber })
    .from(userProfile)
    .where(eq(userProfile.userId, userId))
    .limit(1);
  return profile?.phoneNumber ?? null;
}

type Prepared =
  | {
      ok: true;
      name: string;
      nameNormalized: string;
      phone: string;
      sameNumberAs: string | null;
    }
  | { ok: false; error: string };

/**
 * The checks shared by create and update: normalise the name and number,
 * refuse the user's own number and the bat phone number, refuse a name
 * another contact already has, and find a contact that shares the number.
 * `selfId` excludes the contact being edited from both comparisons.
 */
function prepare(
  input: { name: string; phone: string },
  ownNumber: string | null,
  existing: ExistingContact[],
  selfId: string | null
): Prepared {
  const nameNormalized = normalizeContactName(input.name);
  if (!nameNormalized) {
    return { ok: false, error: UNSAYABLE_NAME };
  }

  const normalized = normalizeToE164(input.phone, defaultPhoneRegion());
  if (!normalized.ok) {
    return { ok: false, error: normalized.reason };
  }
  const phone = normalized.e164;

  const bat = batPhoneNumber();
  if (bat && phone === bat) {
    return { ok: false, error: BAT_NUMBER };
  }
  if (ownNumber && phone === ownNumber) {
    return { ok: false, error: OWN_NUMBER };
  }

  const others = existing.filter((c) => c.id !== selfId);
  const sameName = others.find((c) => c.nameNormalized === nameNormalized);
  if (sameName) {
    return {
      ok: false,
      error: duplicateNameMessage(sameName.name, input.name),
    };
  }

  const sameNumber = others.find((c) => c.phone === phone);
  return {
    ok: true,
    name: input.name,
    nameNormalized,
    phone,
    sameNumberAs: sameNumber?.name ?? null,
  };
}

/**
 * True for a Postgres unique violation on the per-user name index. The
 * pre-check above gives the friendly message in the common case; this
 * catches the race where two saves of the same name interleave.
 */
function isDuplicateNameError(error: unknown): boolean {
  return isUniqueViolation(error, NAME_INDEX);
}

/** True for a Postgres unique violation on the per-user speed-dial index. */
function isDuplicateSpeedDialError(error: unknown): boolean {
  return isUniqueViolation(error, SPEED_DIAL_INDEX);
}

function isUniqueViolation(error: unknown, index: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, constraint_name: constraint } = error as {
    code?: unknown;
    constraint_name?: unknown;
  };
  return code === "23505" && constraint === index;
}

/**
 * The message for a speed-dial race: the pre-check missed because another
 * save interleaved, so look the holder up again.
 */
async function raceSpeedDialMessage(
  userId: string,
  code: number
): Promise<string> {
  const holder = speedDialTaken(code, await loadExisting(userId), null);
  return holder ?? duplicateSpeedDialMessage(code, "another contact");
}

/**
 * List the current user's contacts in speed-dial order
 */
export async function listContacts(): Promise<ActionResult<ContactSummary[]>> {
  try {
    const userId = await currentUserId();
    if (!userId) {
      return { success: false, error: "Not authenticated" };
    }

    const rows = await db
      .select({
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        speedDial: contact.speedDial,
      })
      .from(contact)
      .where(eq(contact.userId, userId))
      .orderBy(asc(contact.speedDial));

    return { success: true, data: rows };
  } catch (error) {
    unstable_rethrow(error);
    console.error("Failed to list contacts:", error);
    return { success: false, error: "Failed to load your contacts" };
  }
}

/**
 * Add a contact with the lowest free speed-dial code, or the one the user
 * chose.
 *
 * The read of the used codes and the insert run in one transaction with
 * the profile row locked, so two concurrent adds queue on the lock and
 * the second one sees the first one's code. The lock is only for that
 * serialisation; the profile row is created first if setup has not run.
 */
export async function createContact(
  data: unknown
): Promise<ActionResult<SavedContact>> {
  let enteredName = "";
  let chosenCode: number | undefined;
  let userId: string | null = null;
  try {
    userId = await currentUserId();
    if (!userId) {
      return { success: false, error: "Not authenticated" };
    }
    const uid = userId;

    const validation = validateInput(createContactSchema, data);
    if (!validation.success) {
      return { success: false, error: validation.error };
    }
    enteredName = validation.data.name;
    chosenCode = validation.data.speedDial;

    const [ownNumber, existing] = await Promise.all([
      loadOwnNumber(uid),
      loadExisting(uid),
    ]);
    const prepared = prepare(validation.data, ownNumber, existing, null);
    if (!prepared.ok) {
      return { success: false, error: prepared.error };
    }
    const taken =
      chosenCode === undefined
        ? null
        : speedDialTaken(chosenCode, existing, null);
    if (taken) {
      return { success: false, error: taken };
    }
    const chosen = chosenCode;

    const saved = await db.transaction(async (tx) => {
      await tx
        .insert(userProfile)
        .values({ userId: uid })
        .onConflictDoNothing();

      const [locked] = await tx
        .select({ userId: userProfile.userId })
        .from(userProfile)
        .where(eq(userProfile.userId, uid))
        .for("update");
      if (!locked) {
        throw new Error("Profile row missing after upsert");
      }

      let speedDial = chosen;
      if (speedDial === undefined) {
        const used = await tx
          .select({ speedDial: contact.speedDial })
          .from(contact)
          .where(eq(contact.userId, uid));
        speedDial = lowestFreeSpeedDial(used.map((c) => c.speedDial));
      }

      const [row] = await tx
        .insert(contact)
        .values({
          userId: uid,
          name: prepared.name,
          nameNormalized: prepared.nameNormalized,
          phone: prepared.phone,
          speedDial,
        })
        .returning({
          id: contact.id,
          name: contact.name,
          phone: contact.phone,
          speedDial: contact.speedDial,
        });
      if (!row) {
        throw new Error("Insert returned no row");
      }
      await tx
        .update(userProfile)
        .set({
          onboardingCompletedAt: sql`coalesce(${userProfile.onboardingCompletedAt}, now())`,
          updatedAt: new Date(),
        })
        .where(eq(userProfile.userId, uid));
      return row;
    });

    revalidatePath(CONTACTS_PATH);
    revalidatePath("/", "layout");
    return {
      success: true,
      data: {
        contact: {
          id: saved.id,
          name: saved.name,
          phone: saved.phone,
          speedDial: saved.speedDial,
        },
        sameNumberAs: prepared.sameNumberAs,
      },
    };
  } catch (error) {
    unstable_rethrow(error);
    if (isDuplicateNameError(error)) {
      return {
        success: false,
        error: duplicateNameMessage(enteredName, enteredName),
      };
    }
    if (
      isDuplicateSpeedDialError(error) &&
      chosenCode !== undefined &&
      userId
    ) {
      return {
        success: false,
        error: await raceSpeedDialMessage(userId, chosenCode),
      };
    }
    console.error("Failed to create contact:", error);
    return { success: false, error: "Failed to save the contact" };
  }
}

const CONTACT_COLUMNS = {
  id: contact.id,
  name: contact.name,
  phone: contact.phone,
  speedDial: contact.speedDial,
};

/**
 * Rename, renumber, or re-code a contact. The speed dial changes only
 * when a different one is given; the per-user unique index is the
 * backstop for a code chosen by two saves at once.
 */
export async function updateContact(
  data: unknown
): Promise<ActionResult<SavedContact>> {
  let enteredName = "";
  let chosenCode: number | undefined;
  let userId: string | null = null;
  try {
    userId = await currentUserId();
    if (!userId) {
      return { success: false, error: "Not authenticated" };
    }
    const uid = userId;

    const validation = validateInput(updateContactSchema, data);
    if (!validation.success) {
      return { success: false, error: validation.error };
    }
    enteredName = validation.data.name;
    const { id } = validation.data;

    const [ownNumber, existing] = await Promise.all([
      loadOwnNumber(uid),
      loadExisting(uid),
    ]);
    const current = existing.find((c) => c.id === id);
    if (!current) {
      return { success: false, error: NOT_FOUND };
    }

    const prepared = prepare(validation.data, ownNumber, existing, id);
    if (!prepared.ok) {
      return { success: false, error: prepared.error };
    }

    const requested = validation.data.speedDial;
    const newCode =
      requested !== undefined && requested !== current.speedDial
        ? requested
        : undefined;
    chosenCode = newCode;
    const taken =
      newCode === undefined ? null : speedDialTaken(newCode, existing, id);
    if (taken) {
      return { success: false, error: taken };
    }

    const fields = {
      name: prepared.name,
      nameNormalized: prepared.nameNormalized,
      phone: prepared.phone,
      updatedAt: new Date(),
    };
    const scope = and(eq(contact.id, id), eq(contact.userId, uid));

    const [row] = await db
      .update(contact)
      .set(newCode === undefined ? fields : { ...fields, speedDial: newCode })
      .where(scope)
      .returning(CONTACT_COLUMNS);
    if (!row) {
      return { success: false, error: NOT_FOUND };
    }

    revalidatePath(CONTACTS_PATH);
    return {
      success: true,
      data: {
        contact: {
          id: row.id,
          name: row.name,
          phone: row.phone,
          speedDial: row.speedDial,
        },
        sameNumberAs: prepared.sameNumberAs,
      },
    };
  } catch (error) {
    unstable_rethrow(error);
    if (isDuplicateNameError(error)) {
      return {
        success: false,
        error: duplicateNameMessage(enteredName, enteredName),
      };
    }
    if (
      isDuplicateSpeedDialError(error) &&
      chosenCode !== undefined &&
      userId
    ) {
      return {
        success: false,
        error: await raceSpeedDialMessage(userId, chosenCode),
      };
    }
    console.error("Failed to update contact:", error);
    return { success: false, error: "Failed to save the contact" };
  }
}

/**
 * Remove a contact. Call rows keep their name and number snapshots and
 * their contact_id is set to null by the foreign key, so history survives.
 * The contact's speed-dial code is free again for the next contact.
 */
export async function deleteContact(
  data: unknown
): Promise<ActionResult<null>> {
  try {
    const userId = await currentUserId();
    if (!userId) {
      return { success: false, error: "Not authenticated" };
    }

    const validation = validateInput(contactIdSchema, data);
    if (!validation.success) {
      return { success: false, error: validation.error };
    }

    const deleted = await db
      .delete(contact)
      .where(
        and(eq(contact.id, validation.data.id), eq(contact.userId, userId))
      )
      .returning({ id: contact.id });
    if (deleted.length === 0) {
      return { success: false, error: NOT_FOUND };
    }

    revalidatePath(CONTACTS_PATH);
    return { success: true, data: null };
  } catch (error) {
    unstable_rethrow(error);
    console.error("Failed to delete contact:", error);
    return { success: false, error: "Failed to delete the contact" };
  }
}
