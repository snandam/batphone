import { afterEach, describe, expect, it, vi } from "vitest";

import { createVerifyClient, type VerifyTransport } from "./verify";

/** Mirrors the shape twilio's RestException exposes at runtime. */
function restError(code: number, status: number, message = "boom") {
  const error = new Error(message) as Error & {
    code: number;
    status: number;
  };
  error.code = code;
  error.status = status;
  return error;
}

function transport(overrides: Partial<VerifyTransport> = {}): VerifyTransport {
  return {
    createVerification: vi.fn().mockResolvedValue({ status: "pending" }),
    createVerificationCheck: vi.fn().mockResolvedValue({ status: "approved" }),
    ...overrides,
  };
}

describe("startVerification", () => {
  it("sends an SMS verification to the E.164 number", async () => {
    const t = transport();
    const client = createVerifyClient({ transport: t });
    await expect(client.startVerification("+14155552671")).resolves.toEqual({
      ok: true,
    });
    expect(t.createVerification).toHaveBeenCalledTimes(1);
    expect(t.createVerification).toHaveBeenCalledWith({
      to: "+14155552671",
      channel: "sms",
    });
  });

  it("maps 60200 invalid parameter to send_failed", async () => {
    const t = transport({
      createVerification: vi.fn().mockRejectedValue(restError(60200, 400)),
    });
    const client = createVerifyClient({ transport: t });
    await expect(client.startVerification("+14155552671")).resolves.toEqual({
      ok: false,
      reason: "send_failed",
    });
  });

  it("maps 60205 landline to send_failed", async () => {
    const t = transport({
      createVerification: vi.fn().mockRejectedValue(restError(60205, 403)),
    });
    const client = createVerifyClient({ transport: t });
    await expect(client.startVerification("+14155552671")).resolves.toEqual({
      ok: false,
      reason: "send_failed",
    });
  });

  it("maps 60203 max send attempts to max_attempts", async () => {
    const t = transport({
      createVerification: vi.fn().mockRejectedValue(restError(60203, 429)),
    });
    const client = createVerifyClient({ transport: t });
    await expect(client.startVerification("+14155552671")).resolves.toEqual({
      ok: false,
      reason: "max_attempts",
    });
  });

  it("maps any other failure to unavailable", async () => {
    const t = transport({
      createVerification: vi.fn().mockRejectedValue(new Error("ECONNRESET")),
    });
    const client = createVerifyClient({ transport: t });
    await expect(client.startVerification("+14155552671")).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

describe("checkVerification", () => {
  it("returns ok on an approved check", async () => {
    const t = transport();
    const client = createVerifyClient({ transport: t });
    await expect(
      client.checkVerification("+14155552671", "123456")
    ).resolves.toEqual({ ok: true });
    expect(t.createVerificationCheck).toHaveBeenCalledWith({
      to: "+14155552671",
      code: "123456",
    });
  });

  it("maps a pending status (wrong code) to wrong_code", async () => {
    const t = transport({
      createVerificationCheck: vi.fn().mockResolvedValue({ status: "pending" }),
    });
    const client = createVerifyClient({ transport: t });
    await expect(
      client.checkVerification("+14155552671", "000000")
    ).resolves.toEqual({ ok: false, reason: "wrong_code" });
  });

  it("maps an expired status to expired", async () => {
    const t = transport({
      createVerificationCheck: vi.fn().mockResolvedValue({ status: "expired" }),
    });
    const client = createVerifyClient({ transport: t });
    await expect(
      client.checkVerification("+14155552671", "123456")
    ).resolves.toEqual({ ok: false, reason: "expired" });
  });

  it("maps 20404 not found (verification expired or consumed) to expired", async () => {
    const t = transport({
      createVerificationCheck: vi.fn().mockRejectedValue(restError(20404, 404)),
    });
    const client = createVerifyClient({ transport: t });
    await expect(
      client.checkVerification("+14155552671", "123456")
    ).resolves.toEqual({ ok: false, reason: "expired" });
  });

  it("maps 60202 max check attempts to max_attempts", async () => {
    const t = transport({
      createVerificationCheck: vi.fn().mockRejectedValue(restError(60202, 429)),
    });
    const client = createVerifyClient({ transport: t });
    await expect(
      client.checkVerification("+14155552671", "123456")
    ).resolves.toEqual({ ok: false, reason: "max_attempts" });
  });

  it("maps a max_attempts_reached status to max_attempts", async () => {
    const t = transport({
      createVerificationCheck: vi
        .fn()
        .mockResolvedValue({ status: "max_attempts_reached" }),
    });
    const client = createVerifyClient({ transport: t });
    await expect(
      client.checkVerification("+14155552671", "123456")
    ).resolves.toEqual({ ok: false, reason: "max_attempts" });
  });

  it("maps 60200 (malformed code) to wrong_code", async () => {
    const t = transport({
      createVerificationCheck: vi.fn().mockRejectedValue(restError(60200, 400)),
    });
    const client = createVerifyClient({ transport: t });
    await expect(
      client.checkVerification("+14155552671", "12")
    ).resolves.toEqual({ ok: false, reason: "wrong_code" });
  });

  it("maps any other failure to unavailable", async () => {
    const t = transport({
      createVerificationCheck: vi.fn().mockRejectedValue(new Error("down")),
    });
    const client = createVerifyClient({ transport: t });
    await expect(
      client.checkVerification("+14155552671", "123456")
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("native Verify transport", () => {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    TWILIO_API_KEY_SID: "SK_test",
    TWILIO_API_KEY_SECRET: "test-secret",
    TWILIO_VERIFY_SERVICE_SID: "VA_test",
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts a form with API key auth and a ten-second deadline", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ status: "pending" }));
    vi.stubGlobal("fetch", fetchMock);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await expect(
      createVerifyClient({ env }).startVerification("+14155552671")
    ).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://verify.twilio.com/v2/Services/VA_test/Verifications",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa("SK_test:test-secret")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "To=%2B14155552671&Channel=sms",
        signal: expect.any(AbortSignal),
      })
    );
    expect(timeout).toHaveBeenCalledWith(10_000);
  });

  it.each([
    ["approved", { ok: true }],
    ["pending", { ok: false, reason: "wrong_code" }],
  ])("maps a %s verification check", async (status, expected) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ status }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createVerifyClient({ env }).checkVerification("+14155552671", "123456")
    ).resolves.toEqual(expected);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://verify.twilio.com/v2/Services/VA_test/VerificationCheck",
      expect.objectContaining({
        method: "POST",
        body: "To=%2B14155552671&Code=123456",
      })
    );
  });

  it.each([
    [60200, "send_failed"],
    [60203, "max_attempts"],
    [20003, "unavailable"],
  ])(
    "maps provider HTTP error %s without logging sensitive fields",
    async (code, reason) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            Response.json(
              { code, message: "secret-provider-body" },
              { status: 400 }
            )
          )
      );
      await expect(
        createVerifyClient({ env }).startVerification("+14155552671")
      ).resolves.toEqual({ ok: false, reason });
      const logs = JSON.stringify(warn.mock.calls);
      expect(logs).toContain(String(code));
      expect(logs).not.toContain("secret-provider-body");
      expect(logs).not.toContain("14155552671");
      expect(logs).not.toContain("test-secret");
    }
  );

  it("maps a deleted verification HTTP response to expired", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ code: 20404 }, { status: 404 }))
    );
    await expect(
      createVerifyClient({ env }).checkVerification("+14155552671", "123456")
    ).resolves.toEqual({ ok: false, reason: "expired" });
  });

  it.each([
    new TypeError("network failure"),
    new DOMException("deadline", "TimeoutError"),
  ])("returns unavailable on transport failure", async (error) => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
    const client = createVerifyClient({ env });
    await expect(client.startVerification("+14155552671")).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    await expect(
      client.checkVerification("+14155552671", "123456")
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it.each([
    null,
    {},
    { status: 1 },
    { status: "unknown" },
    { status: "approved" },
  ])(
    "does not report SMS sent for malformed or unexpected success payload %j",
    async (payload) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
      await expect(
        createVerifyClient({ env }).startVerification("+14155552671")
      ).resolves.toEqual({ ok: false, reason: "unavailable" });
    }
  );

  it("returns unavailable for non-JSON success responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json")));
    await expect(
      createVerifyClient({ env }).startVerification("+14155552671")
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
  });
});
