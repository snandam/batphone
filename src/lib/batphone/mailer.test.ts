import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDryRunMailer,
  createMailer,
  createTwilioEmailMailer,
  type MailerLogger,
  type MailMessage,
} from "./mailer";

const message: MailMessage = {
  to: "bob@example.com",
  subject: "Call with Alice, 1:01, Sep 11, 2026, 3:42 PM",
  text: "plain body",
  html: "<p>html body</p>",
  callId: "call-123",
  kind: "transcript",
};

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async () => {
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(payload, {
      status,
      headers: { "content-type": "application/json" },
    });
  });
}

function fakeLogger(): MailerLogger & { entries: unknown[] } {
  const entries: unknown[] = [];
  return {
    entries,
    info: (event, context) => entries.push({ level: "info", event, context }),
    warn: (event, context) => entries.push({ level: "warn", event, context }),
  };
}

beforeEach(() => {
  vi.stubEnv("TWILIO_ACCOUNT_SID", "ACxxx");
  vi.stubEnv("TWILIO_API_KEY_SID", "SKkey");
  vi.stubEnv("TWILIO_API_KEY_SECRET", "s3cret");
  vi.stubEnv("EMAIL_FROM", "batphone@example.com");
  vi.stubEnv("EMAIL_FROM_NAME", "Bat Phone");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createTwilioEmailMailer", () => {
  it("POSTs the exact body shape with basic auth from the API key", async () => {
    const fetch = fakeFetch(202, { operationId: "op-1" });
    const mailer = createTwilioEmailMailer({ fetch });

    const result = await mailer.send(message);

    expect(result).toEqual({ ok: true, messageId: "op-1" });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://comms.twilio.com/v1/Emails");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(
      `Basic ${Buffer.from("SKkey:s3cret").toString("base64")}`
    );
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({
      from: { address: "batphone@example.com", name: "Bat Phone" },
      to: [{ address: "bob@example.com" }],
      content: {
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: { "X-Batphone-Call-Id": "call-123" },
      },
      tags: { callId: "call-123", kind: "transcript" },
    });
  });

  it("returns the response body as the error on a non-202 status", async () => {
    const body = {
      errors: [
        { message: "The from address does not match a verified Sender" },
      ],
    };
    const mailer = createTwilioEmailMailer({ fetch: fakeFetch(403, body) });

    const result = await mailer.send(message);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("403");
    expect(result.error).toContain("does not match a verified Sender");
  });

  it("truncates a long error body to 500 characters of body text", async () => {
    const mailer = createTwilioEmailMailer({
      fetch: fakeFetch(500, "x".repeat(2000)),
    });
    const result = await mailer.send(message);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.length).toBeLessThanOrEqual(500 + "HTTP 500: ".length);
  });

  it("treats a 202 without an operationId as a failure", async () => {
    const mailer = createTwilioEmailMailer({ fetch: fakeFetch(202, {}) });
    const result = await mailer.send(message);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false on a network error", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const mailer = createTwilioEmailMailer({ fetch });
    const result = await mailer.send(message);
    expect(result).toEqual({ ok: false, error: "fetch failed" });
  });
});

describe("createDryRunMailer", () => {
  it("logs the subject, recipient, and kind, and returns a fake id", async () => {
    const logger = fakeLogger();
    const mailer = createDryRunMailer(logger);

    const result = await mailer.send(message);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.messageId).toMatch(/^dry-run-\d+$/);
    expect(logger.entries).toEqual([
      {
        level: "info",
        event: "email_dry_run",
        context: expect.objectContaining({
          to: "bob@example.com",
          subject: message.subject,
          kind: "transcript",
          call_id: "call-123",
        }),
      },
    ]);
  });
});

describe("createMailer", () => {
  it("chooses the Twilio mailer when dry run is off", () => {
    vi.stubEnv("EMAIL_DRY_RUN", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(createMailer({ logger: fakeLogger() }).name).toBe("twilio");
  });

  it("chooses dry run outside production when EMAIL_DRY_RUN=true", () => {
    vi.stubEnv("EMAIL_DRY_RUN", "true");
    vi.stubEnv("NODE_ENV", "development");
    expect(createMailer({ logger: fakeLogger() }).name).toBe("dry-run");
  });

  it("ignores EMAIL_DRY_RUN=true in production and warns", () => {
    vi.stubEnv("EMAIL_DRY_RUN", "true");
    vi.stubEnv("NODE_ENV", "production");
    const logger = fakeLogger();
    expect(createMailer({ logger }).name).toBe("twilio");
    expect(logger.entries).toContainEqual(
      expect.objectContaining({ level: "warn", event: "email_dry_run_ignored" })
    );
  });

  it("honours EMAIL_DRY_RUN=force in production and warns", () => {
    vi.stubEnv("EMAIL_DRY_RUN", "force");
    vi.stubEnv("NODE_ENV", "production");
    const logger = fakeLogger();
    expect(createMailer({ logger }).name).toBe("dry-run");
    expect(logger.entries).toContainEqual(
      expect.objectContaining({ level: "warn", event: "email_dry_run_active" })
    );
  });
});
