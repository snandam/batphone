// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Call } from "@/db/schema";
import inbound from "@/test/fixtures/twilio/inbound.json";
import {
  publicUrlFor,
  signedTwilioRequest,
  TEST_AUTH_TOKEN,
  TEST_PUBLIC_BASE_URL,
} from "@/test/twilio";

// bindCall takes its repo functions as deps, so the DB is never touched here.
vi.mock("@/db", () => ({ db: {} }));

import {
  bindCall,
  callLogContext,
  emptyResponse,
  parseTwilioRequest,
  twimlResponse,
  withTwiml,
} from "./twilio-request";

const PATH = "/api/twilio/gather";
const NOW = new Date("2026-09-11T14:00:00.000Z");

/** The columns bindCall reads; the rest of the row is irrelevant here. */
function row(overrides: Partial<Call> = {}): Call {
  return {
    id: "call-1",
    userId: "user-1",
    twilioCallSid: inbound.CallSid,
    fromNumber: inbound.From,
    status: "identifying" as const,
    inboundAt: new Date(NOW.getTime() - 60_000),
    ...overrides,
  } as Call;
}

function deps(overrides: Partial<Parameters<typeof bindCall>[2]> = {}) {
  return {
    getCallById: vi.fn(async (id: string) => (id === "call-1" ? row() : null)),
    loadContactIds: vi.fn(async () => ["c1", "c2"]),
    now: () => NOW,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv("PUBLIC_BASE_URL", TEST_PUBLIC_BASE_URL);
  vi.stubEnv("TWILIO_AUTH_TOKEN", TEST_AUTH_TOKEN);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("parseTwilioRequest", () => {
  it("returns the form params and the raw query on a valid signature", async () => {
    const query = "?callId=call-1&attempt=2";
    const result = await parseTwilioRequest(
      signedTwilioRequest({ path: PATH, query, params: inbound })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.params.CallSid).toBe(inbound.CallSid);
    expect(result.params.From).toBe(inbound.From);
    expect(result.query.get("callId")).toBe("call-1");
    expect(result.query.get("attempt")).toBe("2");
  });

  it("signs against the public base URL, not request.url", async () => {
    const request = signedTwilioRequest({
      path: PATH,
      params: inbound,
      signedUrl: `http://localhost:3000${PATH}`,
    });
    const result = await parseTwilioRequest(request);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.response.status).toBe(403);
  });

  it("rejects when the auth token is not configured", async () => {
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    const result = await parseTwilioRequest(
      signedTwilioRequest({ path: PATH, params: inbound })
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.response.status).toBe(403);
  });

  it("rejects a body whose Content-Length exceeds 8192 before reading it", async () => {
    const request = signedTwilioRequest({
      path: PATH,
      params: inbound,
      headers: { "content-length": "100000" },
    });
    const formData = vi.fn(async () => {
      throw new Error("must not read");
    });
    Object.defineProperty(request, "formData", { value: formData });

    const result = await parseTwilioRequest(request);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.response.status).toBe(413);
    expect(await result.response.text()).toBe("");
    expect(formData).not.toHaveBeenCalled();
  });

  it("rejects a body that is not form-encoded with 403", async () => {
    const request = new Request(`http://localhost:3000${PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-twilio-signature": "irrelevant",
      },
      body: JSON.stringify({ CallSid: "x" }),
    });
    const result = await parseTwilioRequest(request);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.response.status).toBe(403);
  });

  it("uses the raw query string for validation", async () => {
    const rawQuery = "?heard=a%20b%2Cc&callId=call-1";
    const accepted = await parseTwilioRequest(
      signedTwilioRequest({ path: PATH, query: rawQuery, params: inbound })
    );
    expect(accepted.ok).toBe(true);

    const reserialised = `?${new URLSearchParams([
      ["callId", "call-1"],
      ["heard", "a b,c"],
    ]).toString()}`;
    const rejected = await parseTwilioRequest(
      signedTwilioRequest({
        path: PATH,
        query: rawQuery,
        params: inbound,
        signedUrl: publicUrlFor(PATH, reserialised),
      })
    );
    expect(rejected.ok).toBe(false);
  });
});

describe("bindCall", () => {
  const params = { CallSid: inbound.CallSid };

  it("returns the row and the attempt from the query", async () => {
    const d = deps();
    const result = await bindCall(
      params,
      new URLSearchParams({ callId: "call-1", attempt: "2" }),
      d
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.row.id).toBe("call-1");
    expect(result.attempt).toBe(2);
    expect(d.loadContactIds).not.toHaveBeenCalled();
  });

  it("defaults the attempt to 1 when absent", async () => {
    const result = await bindCall(
      params,
      new URLSearchParams({ callId: "call-1" }),
      deps()
    );
    expect(result.ok && result.attempt).toBe(1);
  });

  it("rejects a missing callId and an unknown call id", async () => {
    const missing = await bindCall(params, new URLSearchParams(), deps());
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error("expected rejection");
    expect(missing.reason).toBe("missing_call");

    const unknown = await bindCall(
      params,
      new URLSearchParams({ callId: "nope" }),
      deps()
    );
    expect(unknown.ok).toBe(false);
    if (unknown.ok) throw new Error("expected rejection");
    expect(unknown.reason).toBe("missing_call");
  });

  it("rejects a CallSid mismatch", async () => {
    const result = await bindCall(
      { CallSid: "CAsomeoneelse" },
      new URLSearchParams({ callId: "call-1" }),
      deps()
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.reason).toBe("sid_mismatch");
  });

  it("rejects a row older than 24 hours", async () => {
    const old = row({ inboundAt: new Date(NOW.getTime() - 24 * 3600_000 - 1) });
    const result = await bindCall(
      params,
      new URLSearchParams({ callId: "call-1" }),
      deps({ getCallById: vi.fn(async () => old) })
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.reason).toBe("expired");
  });

  it("accepts a row just under 24 hours old", async () => {
    const fresh = row({
      inboundAt: new Date(NOW.getTime() - 24 * 3600_000 + 1),
    });
    const result = await bindCall(
      params,
      new URLSearchParams({ callId: "call-1" }),
      deps({ getCallById: vi.fn(async () => fresh) })
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a contactId owned by another user", async () => {
    const d = deps();
    const result = await bindCall(
      params,
      new URLSearchParams({ callId: "call-1", contactId: "c9" }),
      d
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.reason).toBe("foreign_contact");
    expect(d.loadContactIds).toHaveBeenCalledWith("user-1");
  });

  it("rejects when any candidate id is foreign, accepts when all are owned", async () => {
    const foreign = await bindCall(
      params,
      new URLSearchParams({ callId: "call-1", candidates: "c1,c9" }),
      deps()
    );
    expect(foreign.ok).toBe(false);

    const owned = await bindCall(
      params,
      new URLSearchParams({
        callId: "call-1",
        candidates: "c1,c2",
        contactId: "c2",
      }),
      deps()
    );
    expect(owned.ok).toBe(true);
  });

  it("rejects an attempt that is not a positive integer", async () => {
    for (const attempt of ["0", "-1", "abc", "1.5"]) {
      const result = await bindCall(
        params,
        new URLSearchParams({ callId: "call-1", attempt }),
        deps()
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected rejection");
      expect(result.reason).toBe("bad_attempt");
    }
  });

  it("an unknown call id carries the apology TwiML", async () => {
    const result = await bindCall(
      { CallSid: "CAother" },
      new URLSearchParams({ callId: "no-such-call" }),
      deps()
    );
    if (result.ok) throw new Error("expected rejection");
    expect(result.reason).toBe("missing_call");
    expect(await result.response.text()).toContain(
      "Sorry, something went wrong"
    );
  });

  it("a rejection carries a goodbye TwiML response", async () => {
    const result = await bindCall(
      { CallSid: "CAother" },
      new URLSearchParams({ callId: "call-1" }),
      deps()
    );
    if (result.ok) throw new Error("expected rejection");
    expect(result.response.status).toBe(200);
    expect(result.response.headers.get("content-type")).toBe("text/xml");
    expect(await result.response.text()).toContain("<Hangup/>");
  });
});

describe("response helpers", () => {
  it("twimlResponse sets text/xml and 200", async () => {
    const response = twimlResponse("<Response/>");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/xml");
    expect(await response.text()).toBe("<Response/>");
  });

  it("emptyResponse has no body", async () => {
    const response = emptyResponse(204);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("callLogContext exposes only call id, SID, status, and attempt", () => {
    expect(callLogContext(row(), 3)).toEqual({
      call_id: "call-1",
      call_sid: inbound.CallSid,
      status: "identifying",
      attempt: 3,
    });
    expect(callLogContext(row())).toEqual({
      call_id: "call-1",
      call_sid: inbound.CallSid,
      status: "identifying",
    });
  });

  it("withTwiml turns a thrown error into a 200 apology and logs it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withTwiml(async () => {
      throw new Error("boom");
    });

    const response = await handler(
      new Request("http://localhost:3000/api/twilio/voice", { method: "POST" })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/xml");
    expect(await response.text()).toContain("<Hangup/>");
    const line = JSON.parse(String(error.mock.calls.at(-1)?.[0]));
    expect(line.event).toBe("twilio_handler_error");
    expect(line.path).toBe("/api/twilio/voice");
    expect(line.error_message).toBe("boom");
  });

  it("withTwiml passes through a successful response", async () => {
    const handler = withTwiml(async () => emptyResponse(204));
    const response = await handler(
      new Request("http://localhost:3000/x", { method: "POST" })
    );
    expect(response.status).toBe(204);
  });
});
