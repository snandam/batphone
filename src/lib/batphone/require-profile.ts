import { redirect } from "next/navigation";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { userProfile } from "@/db/schema";

import { isProfileComplete } from "./profile";

/** Server-side gate shared by pages and actions; a URL cannot skip onboarding. */
export async function requireCompletedProfile(userId: string) {
  const [profile] = await db
    .select({
      firstName: userProfile.firstName,
      lastName: userProfile.lastName,
      phoneNumber: userProfile.phoneNumber,
      phoneVerifiedAt: userProfile.phoneVerifiedAt,
      timezone: userProfile.timezone,
      onboardingCompletedAt: userProfile.onboardingCompletedAt,
    })
    .from(userProfile)
    .where(eq(userProfile.userId, userId))
    .limit(1);
  if (!isProfileComplete(profile)) redirect("/setup");
  return profile!;
}

/** Full app access additionally requires saving the first personal contact once. */
export async function requireCompletedOnboarding(userId: string) {
  const profile = await requireCompletedProfile(userId);
  if (!profile.onboardingCompletedAt) redirect("/setup/contact");
  return profile;
}
