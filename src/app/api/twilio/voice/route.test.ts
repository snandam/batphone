// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import inbound from "@/test/fixtures/twilio/inbound.json";
import {
  publicUrlFor,
  signedTwilioRequest,
  TEST_AUTH_TOKEN,
  TEST_PUBLIC_BASE_URL,
} from "@/test/twilio";

const {
  mockFindUserByPhone,
  mockListContactsForUser,
  mockInsertCallIdentifying,
  mockInsertEvent,
} = vi.hoisted(() => ({
  mockFindUserByPhone: vi.fn(),
  mockListContactsForUser: vi.fn(),
  mockInsertCallIdentifying: vi.fn(),
  mockInsertEvent: vi.fn(),
}));

vi.mock("@/lib/batphone/calls-repo", () => ({
  findUserByPhone: mockFindUserByPhone,
  listContactsForUser: mockListContactsForUser,
  insertCallIdentifying: mockInsertCallIdentifying,
  insertEvent: mockInsertEvent,
  getCallById: vi.fn(),
  getCallBySid: vi.fn(),
}));

import { POST } from "./route";

const PATH = "/api/twilio/voice";
const USER = {
  userId: "user-1",
  timezone: "UTC",
  email: "a@example.com",
  firstName: "Sanjeev",
};
const CONTACTS = [
  { id: "c1", name: "Mike Anderson", phone: "+15559876543", speedDial: 1 },
  { id: "c2", name: "Sarah Chen", phone: "+15559876544", speedDial: 2 },
];
const NOW = new Date("2026-09-11T14:00:00.000Z");

function callRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "call-1",
    userId: USER.userId,
    twilioCallSid: inbound.CallSid,
    fromNumber: inbound.From,
    status: "identifying",
    inboundAt: NOW,
    ...overrides,
  };
}

function inboundRequest(
  params: Record<string, string> = inbound,
  extra: Partial<Parameters<typeof signedTwilioRequest>[0]> = {}
) {
  return signedTwilioRequest({ path: PATH, params, ...extra });
}

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  vi.stubEnv("PUBLIC_BASE_URL", TEST_PUBLIC_BASE_URL);
  vi.stubEnv("TWILIO_AUTH_TOKEN", TEST_AUTH_TOKEN);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  mockInsertEvent.mockResolvedValue(undefined);
  mockFindUserByPhone.mockResolvedValue(null);
  mockListContactsForUser.mockResolvedValue([]);
  mockInsertCallIdentifying.mockResolvedValue(callRow());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/twilio/voice signature contract", () => {
  it("accepts a request signed for the public URL when request.url is localhost", async () => {
    const request = inboundRequest();
    expect(request.url.startsWith("http://localhost:3000/")).toBe(true);

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/xml");
  });

  it("returns 403 with an empty body when a form field was mutated after signing", async () => {
    const request = signedTwilioRequest({
      path: PATH,
      params: inbound,
      // sign for the fixture, then send a different From
      signedUrl: publicUrlFor(PATH),
    });
    const tampered = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: new URLSearchParams({ ...inbound, From: "+15550009999" }),
    });

    const response = await POST(tampered);

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("");
    expect(mockInsertEvent).not.toHaveBeenCalled();
  });

  it("returns 403 with an empty body when the signature header is missing", async () => {
    const response = await POST(
      inboundRequest(inbound, { omitSignature: true })
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("");
    expect(mockInsertEvent).not.toHaveBeenCalled();
  });

  it("returns 403 when signed with a different auth token", async () => {
    const response = await POST(
      inboundRequest(inbound, { authToken: "someone-elses-token" })
    );
    expect(response.status).toBe(403);
  });

  it("returns 403 when signed for a different public base URL", async () => {
    const response = await POST(
      inboundRequest(inbound, { publicBaseUrl: "https://evil.example" })
    );
    expect(response.status).toBe(403);
  });

  it("returns 413 with an empty body before reading a body whose Content-Length exceeds 8 KB", async () => {
    const request = inboundRequest(inbound, {
      headers: { "content-length": "8193" },
    });
    const formData = vi.fn(async () => {
      throw new Error("body must not be read");
    });
    Object.defineProperty(request, "formData", { value: formData });
    Object.defineProperty(request, "text", { value: formData });

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(await response.text()).toBe("");
    expect(formData).not.toHaveBeenCalled();
    expect(mockInsertEvent).not.toHaveBeenCalled();
  });

  it("accepts a Twilio-sized body at the limit", async () => {
    const request = inboundRequest(inbound, {
      headers: { "content-length": "8192" },
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
  });

  it("validates an encoded query string as received and rejects a re-serialised one", async () => {
    const rawQuery = "?callId=call-1&attempt=1&heard=a%20b%2Cc";
    const accepted = await POST(inboundRequest(inbound, { query: rawQuery }));
    expect(accepted.status).toBe(200);

    // A signature computed over a rebuilt query (keys reordered by an
    // object round trip) must not validate against the raw string.
    const reordered = new URLSearchParams([
      ["attempt", "1"],
      ["callId", "call-1"],
      ["heard", "a b,c"],
    ]).toString();
    const rejected = await POST(
      inboundRequest(inbound, {
        query: rawQuery,
        signedUrl: publicUrlFor(PATH, `?${reordered}`),
      })
    );
    expect(rejected.status).toBe(403);
  });
});

describe("POST /api/twilio/voice caller identification", () => {
  it("AE1: an unknown caller hears not-registered, the event is stored, no row is created, and the warning carries only the call SID", async () => {
    const response = await POST(inboundRequest());
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(xml).toContain("This number isn't set up with Bat Phone yet.");
    expect(xml).toContain("<Hangup/>");
    expect(mockFindUserByPhone).toHaveBeenCalledWith(inbound.From);
    expect(mockInsertEvent).toHaveBeenCalledTimes(1);
    expect(mockInsertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        callSid: inbound.CallSid,
        eventKind: "voice",
        payload: expect.objectContaining({ From: inbound.From }),
      })
    );
    expect(mockInsertCallIdentifying).not.toHaveBeenCalled();

    const line = JSON.parse(String(warn.mock.calls.at(-1)?.[0]));
    expect(line.event).toBe("caller_not_registered");
    expect(line.call_sid).toBe(inbound.CallSid);
    expect(JSON.stringify(line)).not.toContain(inbound.From);
  });

  it("an anonymous sentinel From skips the lookup and hears not-registered", async () => {
    const response = await POST(
      inboundRequest({ ...inbound, From: "+266696687", Caller: "+266696687" })
    );

    expect(await response.text()).toContain("isn't set up with Bat Phone");
    expect(mockFindUserByPhone).not.toHaveBeenCalled();
    expect(mockInsertEvent).toHaveBeenCalledTimes(1);
    expect(mockInsertCallIdentifying).not.toHaveBeenCalled();
  });

  it("a known caller with no contacts hears no-contacts and no row is created", async () => {
    mockFindUserByPhone.mockResolvedValue(USER);

    const response = await POST(inboundRequest());
    const xml = await response.text();

    expect(xml).toContain("You don't have any contacts yet.");
    expect(xml).toContain("<Hangup/>");
    expect(mockListContactsForUser).toHaveBeenCalledWith(USER.userId);
    expect(mockInsertCallIdentifying).not.toHaveBeenCalled();
  });

  it("a known caller with contacts gets an identifying row and a gather with every name as a hint", async () => {
    mockFindUserByPhone.mockResolvedValue(USER);
    mockListContactsForUser.mockResolvedValue(CONTACTS);

    const response = await POST(inboundRequest());
    const xml = await response.text();

    expect(mockInsertCallIdentifying).toHaveBeenCalledWith({
      userId: USER.userId,
      twilioCallSid: inbound.CallSid,
      fromNumber: inbound.From,
      inboundAt: NOW,
    });
    expect(xml).toContain("<Gather");
    expect(xml).toContain(
      'hints="Mike Anderson, Sarah Chen, Mike, Sarah, call Mike Anderson, call Sarah Chen, call Mike, call Sarah"'
    );
    expect(xml).toContain(
      `action="${TEST_PUBLIC_BASE_URL}/api/twilio/gather?callId=call-1&amp;attempt=1"`
    );
    expect(xml).toContain("Hi Sanjeev. Who would you like to call?</Say>");
  });

  it("greets with the explicitly entered first name, including multiple words", async () => {
    mockFindUserByPhone.mockResolvedValue({
      ...USER,
      firstName: "Sanjeev Kumar",
    });
    mockListContactsForUser.mockResolvedValue(CONTACTS);

    const xml = await (await POST(inboundRequest())).text();

    expect(xml).toContain(
      ">Hi Sanjeev Kumar. Who would you like to call?</Say>"
    );
    expect(xml).not.toContain("Nithyanandam");
  });

  it("safely falls back to a generic greeting if a caller name is absent", async () => {
    mockFindUserByPhone.mockResolvedValue({ ...USER, firstName: "" });
    mockListContactsForUser.mockResolvedValue(CONTACTS);

    const xml = await (await POST(inboundRequest())).text();

    expect(xml).toContain(">Hi. Who would you like to call?</Say>");
  });

  it("the first prompt has no keypad hint and ends the gather after a short silence", async () => {
    mockFindUserByPhone.mockResolvedValue(USER);
    mockListContactsForUser.mockResolvedValue(CONTACTS);

    const xml = await (await POST(inboundRequest())).text();

    expect(xml).not.toContain("speed dial");
    expect(xml).toContain('speechTimeout="2"');
  });

  it("uses the configured voice and speech model", async () => {
    vi.stubEnv("TWILIO_VOICE", "Google.en-US-Chirp3-HD-Aoede");
    vi.stubEnv("TWILIO_SPEECH_MODEL", "googlev2_telephony_short");
    mockFindUserByPhone.mockResolvedValue(USER);
    mockListContactsForUser.mockResolvedValue(CONTACTS);

    const xml = await (await POST(inboundRequest())).text();

    expect(xml).toContain('speechModel="googlev2_telephony_short"');
    expect(xml).toContain('<Say voice="Google.en-US-Chirp3-HD-Aoede">');
  });

  it("falls back to the default speech model when TWILIO_SPEECH_MODEL is not a Twilio model", async () => {
    vi.stubEnv("TWILIO_SPEECH_MODEL", "whisper-large");
    mockFindUserByPhone.mockResolvedValue(USER);
    mockListContactsForUser.mockResolvedValue(CONTACTS);

    const xml = await (await POST(inboundRequest())).text();

    expect(xml).toContain('speechModel="deepgram_nova-3"');
  });

  it("a re-delivered inbound webhook for an existing CallSid creates no second row and returns the same prompt", async () => {
    mockFindUserByPhone.mockResolvedValue(USER);
    mockListContactsForUser.mockResolvedValue(CONTACTS);

    const first = await (await POST(inboundRequest())).text();
    const second = await (await POST(inboundRequest())).text();

    expect(second).toBe(first);
    // The repo does the conflict handling; the handler always calls it with
    // the same SID and never inserts under a different key.
    expect(mockInsertCallIdentifying).toHaveBeenCalledTimes(2);
    for (const call of mockInsertCallIdentifying.mock.calls) {
      expect(call[0].twilioCallSid).toBe(inbound.CallSid);
    }
  });

  it("a thrown error inside the handler returns 200 with the apology and logs an error", async () => {
    mockFindUserByPhone.mockRejectedValue(
      new Error("db down for +15551234567")
    );

    const response = await POST(inboundRequest());
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/xml");
    expect(xml).toContain("Sorry, something went wrong");
    expect(xml).toContain("<Hangup/>");

    const line = JSON.parse(String(error.mock.calls.at(-1)?.[0]));
    expect(line.level).toBe("error");
    expect(line.event).toBe("twilio_handler_error");
    expect(line.error_message).toBe("db down for +1*********67");
  });
});
