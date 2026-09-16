/**
 * Mailer interface with the Twilio Email implementation and a dry-run
 * fallback.
 *
 * Twilio Email is one POST to `https://comms.twilio.com/v1/Emails`
 * authenticated with the Twilio API key (no SDK). It has no sandbox mode,
 * so `EMAIL_DRY_RUN` swaps in a mailer that logs the message and returns
 * a fake id. Dry run is honoured only outside production, or in production
 * when the value is exactly "force", so a stale flag can never silently
 * swallow real mail.
 *
 * `fetch` is injected so tests assert on the exact request without a
 * network. The pipeline owns the claim rows and idempotency; this module
 * only sends.
 */

import { logger as appLogger } from "@/lib/logger";

import { emailDryRun, emailFrom, twilioApiKey } from "./config";

export const TWILIO_EMAIL_URL = "https://comms.twilio.com/v1/Emails";

const ACCEPTED = 202;
const MAX_ERROR_BODY = 500;
const FORCE_VALUE = "force";

export type EmailKind = "transcript" | "metadata_only";

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  callId: string;
  kind: EmailKind;
};

export type SendResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

export type Mailer = {
  /** "twilio" or "dry-run"; surfaced in logs and the UI. */
  name: "twilio" | "dry-run";
  send(msg: MailMessage): Promise<SendResult>;
};

export type MailerLogger = {
  info(event: string, context?: Record<string, unknown>): void;
  warn(event: string, context?: Record<string, unknown>): void;
};

export type TwilioEmailMailerDeps = {
  fetch?: typeof globalThis.fetch;
};

export type CreateMailerDeps = TwilioEmailMailerDeps & {
  logger?: MailerLogger;
  env?: NodeJS.ProcessEnv;
};

function basicAuth(user: string, secret: string): string {
  return `Basic ${Buffer.from(`${user}:${secret}`).toString("base64")}`;
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readOperationId(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const id = (payload as { operationId?: unknown }).operationId;
  return typeof id === "string" && id ? id : undefined;
}

export function createTwilioEmailMailer(
  deps: TwilioEmailMailerDeps = {}
): Mailer {
  const fetchImpl = deps.fetch ?? globalThis.fetch;

  return {
    name: "twilio",
    async send(msg) {
      const { keySid, keySecret } = twilioApiKey();
      const from = emailFrom();
      const body = {
        from: { address: from.address, name: from.name },
        to: [{ address: msg.to }],
        content: {
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          headers: { "X-Batphone-Call-Id": msg.callId },
        },
        tags: { callId: msg.callId, kind: msg.kind },
      };

      let response: Response;
      try {
        response = await fetchImpl(TWILIO_EMAIL_URL, {
          method: "POST",
          headers: {
            authorization: basicAuth(keySid, keySecret),
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(body),
        });
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }

      const raw = await response.text();
      if (response.status !== ACCEPTED) {
        return {
          ok: false,
          error: `HTTP ${response.status}: ${truncate(raw, MAX_ERROR_BODY)}`,
        };
      }

      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = undefined;
      }
      const messageId = readOperationId(payload);
      if (!messageId) {
        return {
          ok: false,
          error: `HTTP 202 without operationId: ${truncate(raw, MAX_ERROR_BODY)}`,
        };
      }
      return { ok: true, messageId };
    },
  };
}

export function createDryRunMailer(logger: MailerLogger = appLogger): Mailer {
  return {
    name: "dry-run",
    async send(msg) {
      const messageId = `dry-run-${Date.now()}`;
      logger.info("email_dry_run", {
        to: msg.to,
        subject: msg.subject,
        kind: msg.kind,
        call_id: msg.callId,
        message_id: messageId,
      });
      return { ok: true, messageId };
    },
  };
}

/**
 * True when the dry-run mailer should be used: the flag is set and either
 * this is not production or the flag is explicitly "force".
 */
export function isDryRunActive(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.EMAIL_DRY_RUN?.trim().toLowerCase() ?? "";
  const forced = value === FORCE_VALUE;
  if (!emailDryRun() && !forced) return false;
  return env.NODE_ENV !== "production" || forced;
}

/** Picks the mailer from the environment, logging the choice when it is not the real one. */
export function createMailer(deps: CreateMailerDeps = {}): Mailer {
  const env = deps.env ?? process.env;
  const logger = deps.logger ?? appLogger;
  const flag = env.EMAIL_DRY_RUN?.trim().toLowerCase() ?? "";

  if (isDryRunActive(env)) {
    logger.warn("email_dry_run_active", {
      node_env: env.NODE_ENV,
      forced: flag === FORCE_VALUE,
    });
    return createDryRunMailer(logger);
  }

  if (emailDryRun() && env.NODE_ENV === "production") {
    logger.warn("email_dry_run_ignored", {
      node_env: env.NODE_ENV,
      hint: "Set EMAIL_DRY_RUN=force to dry-run in production",
    });
  }

  return createTwilioEmailMailer(deps);
}
