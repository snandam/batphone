// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildNumberUpdate,
  configureTwilio,
  echoTwimlUrl,
  formatConfigureResult,
  readConfigureEnv,
  type ConfigureClient,
  type NumberWebhookUpdate,
} from "./twilio-configure";
import { unavailable } from "./twiml";

const BASE = "https://abc-3000.app.github.dev";
const VOICE = { voice: "Polly.Joanna-Neural", speechModel: "test" };
const DEFAULT_FALLBACK = echoTwimlUrl(unavailable(VOICE));

function fakeClient(overrides: Partial<ConfigureClient> = {}) {
  const updates: Array<{ sid: string; params: NumberWebhookUpdate }> = [];
  const created: string[] = [];
  const client: ConfigureClient = {
    listIncomingPhoneNumbers: vi.fn(async () => [
      { sid: "PN123", phoneNumber: "+15551234567" },
    ]),
    updateIncomingPhoneNumber: vi.fn(async (sid, params) => {
      updates.push({ sid, params });
    }),
    createVerifyService: vi.fn(async (name) => {
      created.push(name);
      return { sid: "VAnew" };
    }),
    ...overrides,
  };
  return { client, updates, created };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("echoTwimlUrl", () => {
  it("serves the unavailable message from Twilio's hosted Echo Twimlet", () => {
    const url = new URL(DEFAULT_FALLBACK);

    expect(url.origin + url.pathname).toBe("https://twimlets.com/echo");
    expect(url.searchParams.get("Twiml")).toBe(unavailable(VOICE));
    expect(url.searchParams.get("Twiml")).toContain(
      "Bat Phone is unavailable right now"
    );
    expect(url.searchParams.get("Twiml")).toContain("<Hangup/>");
  });
});

describe("buildNumberUpdate", () => {
  it("derives POST webhooks from the public base URL and a hosted fallback", () => {
    vi.stubEnv("PUBLIC_BASE_URL", `${BASE}/`);

    expect(buildNumberUpdate(VOICE)).toEqual({
      voiceUrl: `${BASE}/api/twilio/voice`,
      voiceMethod: "POST",
      statusCallback: `${BASE}/api/twilio/call-status`,
      statusCallbackMethod: "POST",
      voiceFallbackUrl: DEFAULT_FALLBACK,
      voiceFallbackMethod: "GET",
    });
  });

  it("speaks the fallback in the configured voice", () => {
    vi.stubEnv("PUBLIC_BASE_URL", BASE);
    const update = buildNumberUpdate({ ...VOICE, voice: "Polly.Matthew" });

    expect(
      new URL(update.voiceFallbackUrl).searchParams.get("Twiml")
    ).toContain('voice="Polly.Matthew"');
  });

  it("prefers the operator's own TwiML URL when given", () => {
    vi.stubEnv("PUBLIC_BASE_URL", BASE);

    expect(
      buildNumberUpdate(VOICE, "https://handler.twilio.com/twiml/EH1")
    ).toMatchObject({
      voiceFallbackUrl: "https://handler.twilio.com/twiml/EH1",
      voiceFallbackMethod: "GET",
    });
  });

  it("ignores a blank override", () => {
    vi.stubEnv("PUBLIC_BASE_URL", BASE);

    expect(buildNumberUpdate(VOICE, "  ").voiceFallbackUrl).toBe(
      DEFAULT_FALLBACK
    );
  });
});

describe("configureTwilio", () => {
  it("updates the matching number and reuses an existing Verify service", async () => {
    vi.stubEnv("PUBLIC_BASE_URL", BASE);
    const { client, updates, created } = fakeClient();

    const result = await configureTwilio(client, {
      phoneNumber: "+15551234567",
      voice: VOICE,
      verifyServiceSid: "VAexisting",
      fallbackTwimlUrl: "https://handler.twilio.com/twiml/EH1",
    });

    expect(client.listIncomingPhoneNumbers).toHaveBeenCalledWith(
      "+15551234567"
    );
    expect(updates).toEqual([
      {
        sid: "PN123",
        params: {
          voiceUrl: `${BASE}/api/twilio/voice`,
          voiceMethod: "POST",
          statusCallback: `${BASE}/api/twilio/call-status`,
          statusCallbackMethod: "POST",
          voiceFallbackUrl: "https://handler.twilio.com/twiml/EH1",
          voiceFallbackMethod: "GET",
        },
      },
    ]);
    expect(created).toEqual([]);
    expect(result.verifyServiceSid).toBe("VAexisting");
    expect(result.verifyServiceCreated).toBe(false);
    expect(result.baseUrl).toBe(BASE);
    expect(result.notes).toEqual([]);
  });

  it("creates a Verify service named Bat Phone when the SID is unset", async () => {
    vi.stubEnv("PUBLIC_BASE_URL", BASE);
    const { client, created } = fakeClient();

    const result = await configureTwilio(client, {
      phoneNumber: "+15551234567",
      voice: VOICE,
    });

    expect(created).toEqual(["Bat Phone"]);
    expect(result.verifyServiceSid).toBe("VAnew");
    expect(result.verifyServiceCreated).toBe(true);
    expect(result.notes.join("\n")).toContain("TWILIO_VERIFY_SERVICE_SID");
  });

  it("installs the hosted fallback and says how to override it", async () => {
    vi.stubEnv("PUBLIC_BASE_URL", BASE);
    const { client, updates } = fakeClient();

    const result = await configureTwilio(client, {
      phoneNumber: "+15551234567",
      voice: VOICE,
      verifyServiceSid: "VAexisting",
    });

    expect(updates[0]?.params.voiceFallbackUrl).toBe(DEFAULT_FALLBACK);
    expect(result.notes.join("\n")).toContain("Echo Twimlet");
    expect(result.notes.join("\n")).toContain("TWILIO_FALLBACK_TWIML_URL");
  });

  it("fails clearly when the number is not on the account", async () => {
    vi.stubEnv("PUBLIC_BASE_URL", BASE);
    const { client, updates } = fakeClient({
      listIncomingPhoneNumbers: vi.fn(async () => []),
    });

    await expect(
      configureTwilio(client, { phoneNumber: "+15550000000", voice: VOICE })
    ).rejects.toThrow(/No incoming phone number matching \+15550000000/);
    expect(updates).toEqual([]);
  });

  it("prints every value it set", async () => {
    vi.stubEnv("PUBLIC_BASE_URL", BASE);
    const { client } = fakeClient();
    const result = await configureTwilio(client, {
      phoneNumber: "+15551234567",
      voice: VOICE,
    });

    const report = formatConfigureResult(result);
    expect(report).toContain(`${BASE}/api/twilio/voice`);
    expect(report).toContain(`${BASE}/api/twilio/call-status`);
    expect(report).toContain("VAnew (created)");
    expect(report).toContain(`${DEFAULT_FALLBACK} [GET]`);
  });
});

describe("readConfigureEnv", () => {
  it("names every missing required variable", () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    vi.stubEnv("TWILIO_API_KEY_SID", "SK1");
    vi.stubEnv("TWILIO_API_KEY_SECRET", "");
    vi.stubEnv("TWILIO_PHONE_NUMBER", "+15551234567");

    expect(() => readConfigureEnv()).toThrow(
      "Missing required environment variable(s): TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SECRET"
    );
  });

  it("returns optional values as undefined when blank", () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC1");
    vi.stubEnv("TWILIO_API_KEY_SID", "SK1");
    vi.stubEnv("TWILIO_API_KEY_SECRET", "s");
    vi.stubEnv("TWILIO_PHONE_NUMBER", "+15551234567");
    vi.stubEnv("TWILIO_VERIFY_SERVICE_SID", "");
    vi.stubEnv("TWILIO_FALLBACK_TWIML_URL", " ");
    vi.stubEnv("TWILIO_VOICE", "Polly.Matthew");
    vi.stubEnv("TWILIO_SPEECH_MODEL", "");

    expect(readConfigureEnv()).toEqual({
      phoneNumber: "+15551234567",
      voice: {
        voice: "Polly.Matthew",
        speechModel: "deepgram_nova-3",
      },
      fallbackTwimlUrl: undefined,
      verifyServiceSid: undefined,
    });
  });
});
