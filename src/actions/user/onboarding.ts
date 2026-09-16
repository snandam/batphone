"use server";

import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { userProfile } from "@/db/schema";
import { auth } from "@/lib/auth";
import { postLoginDestination } from "@/lib/batphone/onboarding";
import { isProfileComplete } from "@/lib/batphone/profile";

/**
 * Where to send the user after sign-in.
 *
 * Used by the OAuth callback page, which runs in the browser and cannot
 * read the profile itself. Returns the explicit callback when it is a safe
 * same-origin path after onboarding; incomplete profiles always go to /setup.
 * Without a session the answer is /login so the caller never lands on a
 * protected page that would bounce it back.
 */
export async function resolvePostLoginDestination(
  callbackUrl?: string | null
): Promise<string> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return "/login";
    }

    const [profile] = await db
      .select({
        firstName: userProfile.firstName,
        lastName: userProfile.lastName,
        phoneNumber: userProfile.phoneNumber,
        phoneVerifiedAt: userProfile.phoneVerifiedAt,
        onboardingCompletedAt: userProfile.onboardingCompletedAt,
      })
      .from(userProfile)
      .where(eq(userProfile.userId, session.user.id))
      .limit(1);

    return postLoginDestination({
      profileComplete: isProfileComplete(profile),
      onboardingComplete: Boolean(profile?.onboardingCompletedAt),
      callbackUrl,
    });
  } catch (error) {
    unstable_rethrow(error);
    console.error("Failed to resolve post-login destination:", error);
    return postLoginDestination({
      profileComplete: false,
      onboardingComplete: false,
      callbackUrl,
    });
  }
}
