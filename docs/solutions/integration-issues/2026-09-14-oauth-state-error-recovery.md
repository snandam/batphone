---
module: auth
tags: [oauth, better-auth, cookies, sign-in]
problem_type: bug
symptoms:
  - Safari sign-in opens the provider library's generic state_mismatch error page.
root_cause: Early state validation failures cannot recover the per-attempt errorCallbackURL and had no application-wide error URL configured.
resolution_type: code
severity: medium
---

# Google sign-in opens a generic state_mismatch error page

This is a dated investigation of local sign-in recovery. The current application also supports the hosted Cloudflare origin; use [Google sign-in setup](../../GOOGLE_AUTH.md) for current URLs and onboarding behavior.

## Investigation

During this investigation, the configured auth and browser origins both used http://localhost:3000. A fresh sign-in request sets a signed, HTTP-only state cookie for localhost with SameSite=Lax. A fresh callback with that cookie passes state validation. Removing the cookie reproduces the reported error without exchanging a Google authorization code.

In the Better Auth version investigated at the time, oauth2/state.mjs maps state_security_mismatch to the displayed state_mismatch code. The exact reason the user's original cookie was missing or different was not observable. Parallel sign-in attempts, expired cookies, or changing browser/host can invalidate the attempt.

## Fix

Set onAPIError.errorURL to /login in src/lib/auth.ts so failures before state parsing and old /api/auth/error links return to the app. Map state errors to instructions for starting a fresh attempt in one browser window. Keep state verification enabled.

Also handle returned API errors in LoginForm: Better Auth does not always throw, so an error response or missing authorization URL must release the loading button.

## Guardrail

Auth-error mapping and login-form regression tests cover recognized errors, untrusted query strings, returned API failures, missing redirect URLs, and network exceptions. Local browser checks exercise fresh and missing-cookie callbacks without calling Google's token endpoint. A successful real Google login still requires the user's browser interaction.
