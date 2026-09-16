// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkNumberLink,
  numberLinkStatus,
  resetNumberLinkCache,
  type NumberLinkClient,
} from "./number-link";

const BASE = "https://abc-3000.app.github.dev";
const VOICE = `${BASE}/api/twilio/voice`;

function fakeClient(
  voiceUrl: string | null,
  voiceMethod = "POST"
): NumberLinkClient & {
  fetchVoiceWebhook: ReturnType<typeof vi.fn>;
} {
  return {
    fetchVoiceWebhook: vi.fn(async () =>
      voiceUrl === null ? null : { voiceUrl, voiceMethod }
    ),
  };
}

beforeEach(() => {
  resetNumberLinkCache();
  vi.stubEnv("PUBLIC_BASE_URL", BASE);
  vi.stubEnv("TWILIO_PHONE_NUMBER", "+15555550199");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkNumberLink", () => {
  it("is connected when the voice URL matches, ignoring a trailing slash", async () => {
    const link = await checkNumberLink(
      fakeClient(`${VOICE}/`),
      "+15555550199",
      VOICE
    );
    expect(link.status).toBe("connected");
  });

  it("is disconnected when the URL matches but Twilio would send GET", async () => {
    const link = await checkNumberLink(
      fakeClient(VOICE, "GET"),
      "+15555550199",
      VOICE
    );
    expect(link.status).toBe("disconnected");
  });

  it("is disconnected when the number points somewhere else", async () => {
    const link = await checkNumberLink(
      fakeClient("https://old-tunnel.trycloudflare.com/api/twilio/voice"),
      "+15555550199",
      VOICE
    );
    expect(link).toEqual({
      status: "disconnected",
      voiceUrl: "https://old-tunnel.trycloudflare.com/api/twilio/voice",
      expectedVoiceUrl: VOICE,
    });
  });

  it("is unknown when the number is not on the account", async () => {
    const link = await checkNumberLink(fakeClient(null), "+15555550199", VOICE);
    expect(link.status).toBe("unknown");
  });
});

describe("numberLinkStatus", () => {
  it("asks Twilio for the configured number against this deployment's voice URL", async () => {
    const client = fakeClient(VOICE);
    const link = await numberLinkStatus({ client: async () => client });
    expect(client.fetchVoiceWebhook).toHaveBeenCalledWith("+15555550199");
    expect(link.status).toBe("connected");
    expect(link.expectedVoiceUrl).toBe(VOICE);
  });

  it("reuses one answer within the TTL and reads again after it", async () => {
    let now = 1_000_000;
    const client = fakeClient(VOICE);
    const deps = { client: async () => client, now: () => now };
    await numberLinkStatus(deps);
    await numberLinkStatus(deps);
    expect(client.fetchVoiceWebhook).toHaveBeenCalledTimes(1);
    now += 60_001;
    await numberLinkStatus(deps);
    expect(client.fetchVoiceWebhook).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight read between concurrent callers", async () => {
    const client = fakeClient(VOICE);
    const deps = { client: async () => client };
    await Promise.all([numberLinkStatus(deps), numberLinkStatus(deps)]);
    expect(client.fetchVoiceWebhook).toHaveBeenCalledTimes(1);
  });

  it("reports unknown instead of throwing when Twilio fails", async () => {
    const client: NumberLinkClient = {
      fetchVoiceWebhook: vi.fn(async () => {
        throw new Error("ECONNRESET");
      }),
    };
    const link = await numberLinkStatus({ client: async () => client });
    expect(link.status).toBe("unknown");
  });

  it("reports unknown when the API key is missing", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    vi.stubEnv("TWILIO_API_KEY_SID", "");
    vi.stubEnv("TWILIO_API_KEY_SECRET", "");
    const link = await numberLinkStatus();
    expect(link.status).toBe("unknown");
  });
});
