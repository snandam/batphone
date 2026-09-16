/**
 * Post-login destination
 *
 * Pure rule shared by the login page (server) and the OAuth callback page
 * (client, through a server action): incomplete onboarding always goes to setup; a safe callback applies only
 * after the profile and phone verification are complete.
 */

import { isSafePath } from "@/lib/safe-path";

export const SETUP_PATH = "/setup";

export function postLoginDestination(input: {
  profileComplete: boolean;
  onboardingComplete: boolean;
  callbackUrl?: string | null;
}): string {
  if (!input.profileComplete) return SETUP_PATH;
  if (!input.onboardingComplete) return "/setup/contact";
  if (isSafePath(input.callbackUrl)) {
    return input.callbackUrl;
  }
  return "/";
}
