import { z } from "zod";

export const profileDetailsSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, "Enter your first name")
    .max(80, "First name must be 80 characters or fewer"),
  lastName: z
    .string()
    .trim()
    .min(1, "Enter your last name")
    .max(80, "Last name must be 80 characters or fewer"),
});

export interface ProfileCompletion {
  firstName?: string | null;
  lastName?: string | null;
  phoneNumber?: string | null;
  phoneVerifiedAt?: Date | string | null;
}

/** Google identity alone does not complete Bat Phone onboarding. */
export function isProfileComplete(
  profile: ProfileCompletion | null | undefined
): boolean {
  return Boolean(
    profile?.firstName?.trim() &&
    profile.lastName?.trim() &&
    profile.phoneNumber &&
    profile.phoneVerifiedAt
  );
}

interface NameDetails {
  firstName?: string | null;
  lastName?: string | null;
}

interface GoogleNameClaims {
  googleGivenName?: string | null;
  googleFamilyName?: string | null;
}

/** Suggestions only: saving the form is what completes the name step. */
export function prefillProfileDetails(
  details: NameDetails | null | undefined,
  googleClaims: GoogleNameClaims | null | undefined,
  displayName?: string | null
): { firstName: string; lastName: string } {
  const given = googleClaims?.googleGivenName?.trim() ?? "";
  const family = googleClaims?.googleFamilyName?.trim() ?? "";
  const display = displayName?.trim() ?? "";
  // Older accounts predate structured claims. Never infer a name from email.
  const legacy =
    !given && !family && !display.includes("@") ? display.split(/\s+/) : [];
  return {
    firstName: details?.firstName?.trim() || given || legacy[0] || "",
    lastName: details?.lastName?.trim() || family || legacy.slice(1).join(" "),
  };
}
