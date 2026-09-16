"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { userProfile } from "@/db/schema";
import { auth } from "@/lib/auth";
import { defaultPhoneRegion } from "@/lib/batphone/config";
import { normalizeToE164 } from "@/lib/batphone/phone";
import { createVerifyClient, type VerifyFailure } from "@/lib/batphone/verify";
import {
  confirmPhoneSchema,
  phoneInputSchema,
  validateInput,
} from "@/lib/validations";
import type { ActionResult } from "@/types";

/**
 * Phone setup server actions
 *
 * A number is saved only after Twilio Verify approves a code sent to it.
 * The app keeps no pending state between the two steps: Verify holds the
 * code, and the second action re-normalises and re-checks the number, so a
 * client cannot confirm a different number than the one the code went to.
 */

export interface MyPhone {
  phoneNumber: string | null;
  phoneVerifiedAt: Date | null;
  timezone: string;
}

const ALREADY_LINKED = "This number is already linked to another account";
const SETUP_PATH = "/setup";

const VERIFY_MESSAGES: Record<VerifyFailure, string> = {
  send_failed:
    "We couldn't send a code to that number. Check the number and try again.",
  wrong_code: "That code is not right. Check the text message and try again.",
  expired: "That code has expired. Send a new one and try again.",
  max_attempts: "Too many attempts. Wait ten minutes and try again.",
  unavailable: "Verification is unavailable right now. Try again in a moment.",
};

async function currentUserId(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user?.id ?? null;
}

/** True when another user's profile already holds this number. */
async function heldByAnotherUser(
  e164: string,
  userId: string
): Promise<boolean> {
  const [holder] = await db
    .select({ userId: userProfile.userId })
    .from(userProfile)
    .where(eq(userProfile.phoneNumber, e164))
    .limit(1);
  return holder !== undefined && holder.userId !== userId;
}

/**
 * Only IANA zones the runtime knows are stored; anything else falls back
 * to UTC so date formatting can never throw on a stored value.
 */
function resolveTimezone(candidate: string | undefined): string {
  const value = candidate?.trim();
  if (!value) return "UTC";
  try {
    const known = Intl.supportedValuesOf("timeZone");
    return known.includes(value) ? value : "UTC";
  } catch {
    return value;
  }
}

/**
 * Get the current user's phone setup state
 */
export async function getMyPhone(): Promise<ActionResult<MyPhone>> {
  try {
    const userId = await currentUserId();
    if (!userId) {
      return { success: false, error: "Not authenticated" };
    }

    const [profile] = await db
      .select({
        phoneNumber: userProfile.phoneNumber,
        phoneVerifiedAt: userProfile.phoneVerifiedAt,
        timezone: userProfile.timezone,
      })
      .from(userProfile)
      .where(eq(userProfile.userId, userId))
      .limit(1);

    return {
      success: true,
      data: profile ?? {
        phoneNumber: null,
        phoneVerifiedAt: null,
        timezone: "UTC",
      },
    };
  } catch (error) {
    unstable_rethrow(error);
    console.error("Failed to get phone:", error);
    return { success: false, error: "Failed to load your phone number" };
  }
}

/**
 * Step 1: validate and normalise the number, refuse one held by another
 * account, then ask Verify to text a code. Nothing is written.
 */
export async function startPhoneVerification(
  data: unknown
): Promise<ActionResult<{ phone: string }>> {
  try {
    const userId = await currentUserId();
    if (!userId) {
      return { success: false, error: "Not authenticated" };
    }

    const validation = validateInput(phoneInputSchema, data);
    if (!validation.success) {
      return { success: false, error: validation.error };
    }

    const normalized = normalizeToE164(
      validation.data.phone,
      defaultPhoneRegion()
    );
    if (!normalized.ok) {
      return { success: false, error: normalized.reason };
    }

    if (await heldByAnotherUser(normalized.e164, userId)) {
      return { success: false, error: ALREADY_LINKED };
    }

    const result = await createVerifyClient().startVerification(
      normalized.e164
    );
    if (!result.ok) {
      return { success: false, error: VERIFY_MESSAGES[result.reason] };
    }

    return { success: true, data: { phone: normalized.e164 } };
  } catch (error) {
    unstable_rethrow(error);
    console.error("Failed to start phone verification:", error);
    return { success: false, error: VERIFY_MESSAGES.unavailable };
  }
}

/**
 * Step 2: check the code with Verify and, only on approval, save the
 * number, the verification time, and the browser timezone.
 */
export async function confirmPhoneVerification(
  data: unknown
): Promise<ActionResult<MyPhone>> {
  try {
    const userId = await currentUserId();
    if (!userId) {
      return { success: false, error: "Not authenticated" };
    }

    const validation = validateInput(confirmPhoneSchema, data);
    if (!validation.success) {
      return { success: false, error: validation.error };
    }

    const normalized = normalizeToE164(
      validation.data.phone,
      defaultPhoneRegion()
    );
    if (!normalized.ok) {
      return { success: false, error: normalized.reason };
    }

    // Re-checked here because another user may have verified this number
    // between step 1 and step 2. The unique column is the final guard.
    if (await heldByAnotherUser(normalized.e164, userId)) {
      return { success: false, error: ALREADY_LINKED };
    }

    const result = await createVerifyClient().checkVerification(
      normalized.e164,
      validation.data.code
    );
    if (!result.ok) {
      return { success: false, error: VERIFY_MESSAGES[result.reason] };
    }

    const saved: MyPhone = {
      phoneNumber: normalized.e164,
      phoneVerifiedAt: new Date(),
      timezone: resolveTimezone(validation.data.timezone),
    };

    await db
      .insert(userProfile)
      .values({ userId, ...saved })
      .onConflictDoUpdate({
        target: userProfile.userId,
        set: { ...saved, updatedAt: new Date() },
      });

    revalidatePath(SETUP_PATH);
    return { success: true, data: saved };
  } catch (error) {
    unstable_rethrow(error);
    console.error("Failed to confirm phone verification:", error);
    return { success: false, error: "Failed to save your phone number" };
  }
}

/**
 * Clear the number and its verification time. The timezone is kept.
 */
export async function removeMyPhone(): Promise<ActionResult<null>> {
  try {
    const userId = await currentUserId();
    if (!userId) {
      return { success: false, error: "Not authenticated" };
    }

    await db
      .update(userProfile)
      .set({ phoneNumber: null, phoneVerifiedAt: null, updatedAt: new Date() })
      .where(eq(userProfile.userId, userId));

    revalidatePath(SETUP_PATH);
    return { success: true, data: null };
  } catch (error) {
    unstable_rethrow(error);
    console.error("Failed to remove phone:", error);
    return { success: false, error: "Failed to remove your phone number" };
  }
}
