/** Map provider error codes to safe, actionable copy; never display raw input. */
export function describeSignInError(
  error: string | undefined
): string | undefined {
  if (!error) return undefined;
  switch (error.toLowerCase()) {
    case "account_not_allowed":
      return "This Google account is not on the allowlist. Ask the operator to add your address or domain, then try again.";
    case "state_mismatch":
    case "state_security_mismatch":
    case "state_invalid":
    case "state_not_found":
    case "please_restart_the_process":
      return "This sign-in attempt expired or no longer matches this browser. Close any other sign-in tabs, then continue with Google below to start a fresh attempt. Use the same browser window throughout.";
    case "access_denied":
      return "Google sign-in was cancelled. Continue with Google when you’re ready.";
    default:
      return "Sign-in did not complete. Try again.";
  }
}
