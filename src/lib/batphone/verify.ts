/**
 * Twilio Verify wrapper
 *
 * The app stores no pending state: Verify holds the one-time code, expires
 * it after ten minutes, and limits check attempts to five. This module
 * turns provider responses and exceptions into a small result union so
 * the server actions can map them to user messages without knowing Twilio
 * error codes.
 *
 * Twilio error codes handled (https://www.twilio.com/docs/api/errors):
 *   60200 Invalid parameter (malformed To or Code)
 *   60202 Max check attempts reached
 *   60203 Max send attempts reached
 *   60205 SMS is not supported by landline phone number
 *   20404 Resource not found: VerificationCheck after the verification
 *         expired, was approved, or hit max attempts
 *         (https://www.twilio.com/docs/verify/api/verification-check)
 *
 * Native fetch works in Node and Cloudflare Workers. Each provider request
 * has a ten-second deadline; transport injection keeps tests offline.
 */

import { logger } from "@/lib/logger";

export type VerifyFailure =
  "send_failed" | "wrong_code" | "expired" | "max_attempts" | "unavailable";

export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailure };

/** The two Verify v2 calls the app makes, narrowed to what it reads back. */
export interface VerifyTransport {
  createVerification(params: {
    to: string;
    channel: "sms";
  }): Promise<{ status: string }>;
  createVerificationCheck(params: {
    to: string;
    code: string;
  }): Promise<{ status: string }>;
}

export interface VerifyClient {
  startVerification(e164: string): Promise<VerifyResult>;
  checkVerification(e164: string, code: string): Promise<VerifyResult>;
}

export interface VerifyClientDeps {
  transport?: VerifyTransport;
  env?: NodeJS.ProcessEnv;
}

const TWILIO_INVALID_PARAMETER = 60200;
const TWILIO_MAX_CHECK_ATTEMPTS = 60202;
const TWILIO_MAX_SEND_ATTEMPTS = 60203;
const TWILIO_LANDLINE_NOT_SUPPORTED = 60205;
const TWILIO_NOT_FOUND = 20404;

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Twilio's RestException carries `code` (Twilio) and `status` (HTTP). */
function twilioCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : undefined;
}

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

/** Fetch avoids Node HTTP adapters inside Workers and bounds provider latency. */
async function fetchTransport(
  env: NodeJS.ProcessEnv
): Promise<VerifyTransport> {
  const apiKeySid = requireEnv(env, "TWILIO_API_KEY_SID");
  const apiKeySecret = requireEnv(env, "TWILIO_API_KEY_SECRET");
  const serviceSid = requireEnv(env, "TWILIO_VERIFY_SERVICE_SID");
  const baseUrl = `https://verify.twilio.com/v2/Services/${encodeURIComponent(serviceSid)}`;

  async function request(path: string, fields: Record<string, string>) {
    const response = await fetch(`${baseUrl}/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${apiKeySid}:${apiKeySecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(fields).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      // Preserve only numeric diagnostics, never provider messages or bodies.
      const error = Object.assign(new Error("Twilio Verify request failed"), {
        name: "VerifyProviderError",
        status: response.status,
        code: twilioCode(payload),
      });
      throw error;
    }
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("status" in payload) ||
      typeof payload.status !== "string"
    ) {
      throw new Error("Invalid Twilio Verify response");
    }
    return { status: payload.status };
  }

  return {
    createVerification: ({ to, channel }) =>
      request("Verifications", { To: to, Channel: channel }),
    createVerificationCheck: ({ to, code }) =>
      request("VerificationCheck", { To: to, Code: code }),
  };
}

function logFailure(operation: "send" | "check", error: unknown) {
  logger.warn("phone_verification_provider_failed", {
    operation,
    provider_code: twilioCode(error),
    status_code: httpStatus(error),
    error_name: error instanceof Error ? error.name : "UnknownError",
  });
}

export function createVerifyClient(deps: VerifyClientDeps = {}): VerifyClient {
  const env = deps.env ?? process.env;
  let transportPromise: Promise<VerifyTransport> | undefined;
  const transport = () => {
    if (deps.transport) return Promise.resolve(deps.transport);
    transportPromise ??= fetchTransport(env);
    return transportPromise;
  };

  return {
    async startVerification(e164) {
      try {
        const t = await transport();
        const { status } = await t.createVerification({
          to: e164,
          channel: "sms",
        });
        return status === "pending"
          ? { ok: true }
          : { ok: false, reason: "unavailable" };
      } catch (error) {
        logFailure("send", error);
        switch (twilioCode(error)) {
          case TWILIO_INVALID_PARAMETER:
          case TWILIO_LANDLINE_NOT_SUPPORTED:
            return { ok: false, reason: "send_failed" };
          case TWILIO_MAX_SEND_ATTEMPTS:
            return { ok: false, reason: "max_attempts" };
          default:
            return { ok: false, reason: "unavailable" };
        }
      }
    },

    async checkVerification(e164, code) {
      try {
        const t = await transport();
        const { status } = await t.createVerificationCheck({ to: e164, code });
        switch (status) {
          case "approved":
            return { ok: true };
          case "pending":
            return { ok: false, reason: "wrong_code" };
          case "expired":
            return { ok: false, reason: "expired" };
          case "max_attempts_reached":
            return { ok: false, reason: "max_attempts" };
          default:
            return { ok: false, reason: "unavailable" };
        }
      } catch (error) {
        logFailure("check", error);
        switch (twilioCode(error)) {
          case TWILIO_INVALID_PARAMETER:
            return { ok: false, reason: "wrong_code" };
          case TWILIO_MAX_CHECK_ATTEMPTS:
            return { ok: false, reason: "max_attempts" };
          case TWILIO_NOT_FOUND:
            return { ok: false, reason: "expired" };
          default:
            // Verify deletes the verification after expiry or approval and
            // the check then 404s; treat a bare 404 the same way.
            if (httpStatus(error) === 404) {
              return { ok: false, reason: "expired" };
            }
            return { ok: false, reason: "unavailable" };
        }
      }
    },
  };
}
