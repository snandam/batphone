import { describe, expect, it } from "vitest";

import { describeSignInError } from "./auth-errors";

describe("sign-in error recovery", () => {
  it.each([
    "state_mismatch",
    "state_security_mismatch",
    "state_invalid",
    "state_not_found",
    "please_restart_the_process",
  ])("offers a fresh attempt for %s", (code) => {
    expect(describeSignInError(code)).toContain("continue with Google below");
    expect(describeSignInError(code)).toContain("same browser window");
  });
  it("keeps allowlist and cancellation errors distinct", () => {
    expect(describeSignInError("account_not_allowed")).toContain("allowlist");
    expect(describeSignInError("access_denied")).toContain("cancelled");
  });
  it("does not reflect arbitrary query text", () => {
    expect(describeSignInError("<script>alert(1)</script>")).toBe(
      "Sign-in did not complete. Try again."
    );
    expect(describeSignInError(undefined)).toBeUndefined();
  });
});
