/**
 * Twilio webhook test helpers
 *
 * Builds a Request the way Twilio delivers a webhook: a form-encoded POST
 * carrying an X-Twilio-Signature computed over the public URL plus the
 * sorted form fields. The Request itself is addressed to localhost, as it
 * is inside Codespaces, so tests prove the validator uses the configured
 * public base URL rather than `request.url`.
 *
 * Signatures come from the twilio package's own helper; nothing here stubs
 * validation.
 */

import { getExpectedTwilioSignature } from "twilio";

export const TEST_PUBLIC_BASE_URL = "https://abc-3000.app.github.dev";
export const TEST_AUTH_TOKEN = "test-auth-token-0123456789abcdef";
export const LOCAL_REQUEST_ORIGIN = "http://localhost:3000";

export interface SignedTwilioRequestOptions {
  /** Path Twilio was configured with, for example "/api/twilio/voice". */
  path: string;
  /** Raw query string including the leading "?", exactly as Twilio sends it. */
  query?: string;
  /** Form fields Twilio posts. */
  params: Record<string, string>;
  /** Public base URL the signature covers; defaults to TEST_PUBLIC_BASE_URL. */
  publicBaseUrl?: string;
  /** Auth token used to sign; defaults to TEST_AUTH_TOKEN. */
  authToken?: string;
  /**
   * Override the URL the signature is computed over. Used to prove a
   * signature over a re-serialised query string does not validate.
   */
  signedUrl?: string;
  /** Leave the X-Twilio-Signature header off entirely. */
  omitSignature?: boolean;
  /** Extra headers, for example a forged Content-Length. */
  headers?: Record<string, string>;
  /** Origin the app sees in request.url; defaults to localhost. */
  requestOrigin?: string;
}

/** The URL Twilio signs for a path and raw query under a public base. */
export function publicUrlFor(
  path: string,
  query = "",
  publicBaseUrl = TEST_PUBLIC_BASE_URL
): string {
  return `${publicBaseUrl}${path}${query}`;
}

export function signedTwilioRequest(
  options: SignedTwilioRequestOptions
): Request {
  const {
    path,
    query = "",
    params,
    publicBaseUrl = TEST_PUBLIC_BASE_URL,
    authToken = TEST_AUTH_TOKEN,
    omitSignature = false,
    requestOrigin = LOCAL_REQUEST_ORIGIN,
  } = options;
  const signedUrl =
    options.signedUrl ?? publicUrlFor(path, query, publicBaseUrl);
  const headers = new Headers(options.headers);
  if (!omitSignature) {
    headers.set(
      "x-twilio-signature",
      getExpectedTwilioSignature(authToken, signedUrl, params)
    );
  }
  return new Request(`${requestOrigin}${path}${query}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(params),
  });
}
