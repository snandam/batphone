"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { user, userProfile } from "@/db/schema";
import { auth } from "@/lib/auth";
import { profileDetailsSchema } from "@/lib/batphone/profile";
import { validateInput } from "@/lib/validations";
import type { ActionResult } from "@/types";

export interface MyDetails {
  firstName: string | null;
  lastName: string | null;
}

export async function getMyDetails(): Promise<ActionResult<MyDetails>> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id)
      return { success: false, error: "Not authenticated" };
    const [profile] = await db
      .select({
        firstName: userProfile.firstName,
        lastName: userProfile.lastName,
      })
      .from(userProfile)
      .where(eq(userProfile.userId, session.user.id))
      .limit(1);
    return {
      success: true,
      data: profile ?? { firstName: null, lastName: null },
    };
  } catch (error) {
    unstable_rethrow(error);
    console.error("Failed to load profile details:", error);
    return { success: false, error: "Failed to load your details" };
  }
}

export async function saveMyDetails(
  data: unknown
): Promise<ActionResult<MyDetails>> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id)
      return { success: false, error: "Not authenticated" };
    const validation = validateInput(profileDetailsSchema, data);
    if (!validation.success) return { success: false, error: validation.error };
    const details = validation.data;
    await db.transaction(async (tx) => {
      await tx
        .insert(userProfile)
        .values({ userId: session.user.id, ...details })
        .onConflictDoUpdate({
          target: userProfile.userId,
          set: { ...details, updatedAt: new Date() },
        });
      await tx
        .update(user)
        .set({
          name: `${details.firstName} ${details.lastName}`,
          updatedAt: new Date(),
        })
        .where(eq(user.id, session.user.id));
    });
    revalidatePath("/", "layout");
    return { success: true, data: details };
  } catch (error) {
    unstable_rethrow(error);
    console.error("Failed to save profile details:", error);
    return { success: false, error: "Failed to save your details" };
  }
}
