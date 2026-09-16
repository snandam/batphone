import { afterEach, describe, expect, it, vi } from "vitest";

import {
  batPhoneNumber,
  callbackUrl,
  deepgramApiKey,
  defaultPhoneRegion,
  emailDryRun,
  emailFrom,
  invalidTwilioSpeechModel,
  publicBaseUrl,
  twilioApiKey,
  twilioAuthToken,
  twilioPhoneNumber,
  TWILIO_SPEECH_MODELS,
  twilioSpeechModel,
  twilioVerifyServiceSid,
  twilioVoice,
  voiceSettings,
} from "./config";

const PUBLIC_URL_VARS = [
  "PUBLIC_BASE_URL",
  "CODESPACES",
  "CODESPACE_NAME",
  "GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN",
] as const;

function clearPublicUrlEnv() {
  for (const name of PUBLIC_URL_VARS) {
    vi.stubEnv(name, "");
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("publicBaseUrl", () => {
  it("derives the Codespaces forwarded URL for port 3000", () => {
    clearPublicUrlEnv();
    vi.stubEnv("CODESPACES", "true");
    vi.stubEnv("CODESPACE_NAME", "abc");
    vi.stubEnv("GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN", "app.github.dev");

    expect(publicBaseUrl()).toBe("https://abc-3000.app.github.dev");
  });

  it("prefers an explicit PUBLIC_BASE_URL over Codespaces variables", () => {
    clearPublicUrlEnv();
    vi.stubEnv("PUBLIC_BASE_URL", "https://batphone.example.com");
    vi.stubEnv("CODESPACES", "true");
    vi.stubEnv("CODESPACE_NAME", "abc");
    vi.stubEnv("GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN", "app.github.dev");

    expect(publicBaseUrl()).toBe("https://batphone.example.com");
  });

  it("falls back to localhost when nothing is set", () => {
    clearPublicUrlEnv();

    expect(publicBaseUrl()).toBe("http://localhost:3000");
  });

  it("strips a trailing slash from an explicit base", () => {
    clearPublicUrlEnv();
    vi.stubEnv("PUBLIC_BASE_URL", "https://batphone.example.com/");

    expect(publicBaseUrl()).toBe("https://batphone.example.com");
  });

  it("ignores Codespaces variables when CODESPACES is not true", () => {
    clearPublicUrlEnv();
    vi.stubEnv("CODESPACE_NAME", "abc");
    vi.stubEnv("GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN", "app.github.dev");

    expect(publicBaseUrl()).toBe("http://localhost:3000");
  });
});

describe("callbackUrl", () => {
  it("builds an absolute URL with an encoded query string", () => {
    clearPublicUrlEnv();
    vi.stubEnv("PUBLIC_BASE_URL", "https://abc-3000.app.github.dev");

    expect(callbackUrl("/api/twilio/gather", { callId: "x", attempt: 2 })).toBe(
      "https://abc-3000.app.github.dev/api/twilio/gather?callId=x&attempt=2"
    );
  });

  it("percent-encodes reserved characters in query values", () => {
    clearPublicUrlEnv();
    vi.stubEnv("PUBLIC_BASE_URL", "https://abc-3000.app.github.dev");

    expect(callbackUrl("/api/twilio/gather", { to: "+15005550006" })).toBe(
      "https://abc-3000.app.github.dev/api/twilio/gather?to=%2B15005550006"
    );
  });

  it("has no trailing slash and no query marker without a query", () => {
    clearPublicUrlEnv();
    vi.stubEnv("PUBLIC_BASE_URL", "https://abc-3000.app.github.dev/");

    expect(callbackUrl("/api/twilio/voice")).toBe(
      "https://abc-3000.app.github.dev/api/twilio/voice"
    );
    expect(callbackUrl("api/twilio/voice", {})).toBe(
      "https://abc-3000.app.github.dev/api/twilio/voice"
    );
  });

  it("omits undefined query values", () => {
    clearPublicUrlEnv();
    vi.stubEnv("PUBLIC_BASE_URL", "https://abc-3000.app.github.dev");

    expect(
      callbackUrl("/api/twilio/gather", { callId: "x", attempt: undefined })
    ).toBe("https://abc-3000.app.github.dev/api/twilio/gather?callId=x");
  });
});

describe("credential accessors", () => {
  it("reads the Twilio auth token", () => {
    vi.stubEnv("TWILIO_AUTH_TOKEN", " tok ");
    expect(twilioAuthToken()).toBe("tok");
  });

  it("reads the Twilio API key triple", () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC1");
    vi.stubEnv("TWILIO_API_KEY_SID", "SK1");
    vi.stubEnv("TWILIO_API_KEY_SECRET", "secret");
    expect(twilioApiKey()).toEqual({
      accountSid: "AC1",
      keySid: "SK1",
      keySecret: "secret",
    });
  });

  it("reads the Twilio phone number and Verify service SID", () => {
    vi.stubEnv("TWILIO_PHONE_NUMBER", "+15551234567");
    vi.stubEnv("TWILIO_VERIFY_SERVICE_SID", "VA1");
    expect(twilioPhoneNumber()).toBe("+15551234567");
    expect(twilioVerifyServiceSid()).toBe("VA1");
    expect(batPhoneNumber()).toBe("+15551234567");
  });

  it("reads the Deepgram key", () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "dg");
    expect(deepgramApiKey()).toBe("dg");
  });

  it("reads the email sender with a default name", () => {
    vi.stubEnv("EMAIL_FROM", "bat@example.com");
    vi.stubEnv("EMAIL_FROM_NAME", "");
    expect(emailFrom()).toEqual({
      address: "bat@example.com",
      name: "Bat Phone",
    });

    vi.stubEnv("EMAIL_FROM_NAME", "Ops");
    expect(emailFrom()).toEqual({ address: "bat@example.com", name: "Ops" });
  });

  it("treats EMAIL_DRY_RUN as a boolean flag", () => {
    vi.stubEnv("EMAIL_DRY_RUN", "");
    expect(emailDryRun()).toBe(false);
    vi.stubEnv("EMAIL_DRY_RUN", "true");
    expect(emailDryRun()).toBe(true);
    vi.stubEnv("EMAIL_DRY_RUN", "1");
    expect(emailDryRun()).toBe(true);
    vi.stubEnv("EMAIL_DRY_RUN", "false");
    expect(emailDryRun()).toBe(false);
  });

  it("upper-cases the default phone region", () => {
    vi.stubEnv("DEFAULT_PHONE_REGION", "gb");
    expect(defaultPhoneRegion()).toBe("GB");
  });
});

describe("twilioVoice", () => {
  it("defaults to the Polly Joanna neural voice", () => {
    vi.stubEnv("TWILIO_VOICE", "");
    expect(twilioVoice()).toBe("Polly.Joanna-Neural");
  });

  it("returns the configured voice, trimmed", () => {
    vi.stubEnv("TWILIO_VOICE", " Google.en-US-Chirp3-HD-Aoede ");
    expect(twilioVoice()).toBe("Google.en-US-Chirp3-HD-Aoede");
  });
});

describe("twilioSpeechModel", () => {
  it("defaults to deepgram_nova-3", () => {
    vi.stubEnv("TWILIO_SPEECH_MODEL", "");
    expect(twilioSpeechModel()).toBe("deepgram_nova-3");
    expect(invalidTwilioSpeechModel()).toBeNull();
  });

  it.each(TWILIO_SPEECH_MODELS)("accepts %s", (model) => {
    vi.stubEnv("TWILIO_SPEECH_MODEL", model);
    expect(twilioSpeechModel()).toBe(model);
    expect(invalidTwilioSpeechModel()).toBeNull();
  });

  it("falls back to the default and reports an unknown model", () => {
    vi.stubEnv("TWILIO_SPEECH_MODEL", "whisper-large");
    expect(twilioSpeechModel()).toBe("deepgram_nova-3");
    expect(invalidTwilioSpeechModel()).toBe("whisper-large");
  });

  it("is case-sensitive, as Twilio is", () => {
    vi.stubEnv("TWILIO_SPEECH_MODEL", "Deepgram_Nova-3");
    expect(twilioSpeechModel()).toBe("deepgram_nova-3");
    expect(invalidTwilioSpeechModel()).toBe("Deepgram_Nova-3");
  });
});

describe("voiceSettings", () => {
  it("bundles the voice and speech model for the TwiML builders", () => {
    vi.stubEnv("TWILIO_VOICE", "Polly.Matthew-Neural");
    vi.stubEnv("TWILIO_SPEECH_MODEL", "experimental_utterances");
    expect(voiceSettings()).toEqual({
      voice: "Polly.Matthew-Neural",
      speechModel: "experimental_utterances",
    });
  });
});
