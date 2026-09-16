// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSession, mockGetCallById } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetCallById: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: mockGetSession } },
}));

vi.mock("@/lib/batphone/calls-repo", () => ({
  getCallById: mockGetCallById,
}));

import { GET } from "./route";

const ACCOUNT_SID = "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const KEY_SID = "SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
// Nonfunctional credential used only by the mocked upstream.
const KEY_SECRET = "dummy";
const RECORDING_SID = "REcccccccccccccccccccccccccccccccc";
const CALL_ID = "call-1";
const MP3_URL = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Recordings/${RECORDING_SID}.mp3`;

const session = { user: { id: "user-1", email: "a@example.com" } };

function callRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CALL_ID,
    userId: "user-1",
    status: "emailed",
    recordingSid: RECORDING_SID,
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

function upstream(
  status: number,
  headers: Record<string, string>,
  body: string | null = "mp3-bytes"
): Response {
  return new Response(body, { status, headers });
}

function request(headers: Record<string, string> = {}): Request {
  return new Request(
    `http://localhost:3000/api/calls/${CALL_ID}/recording.mp3`,
    { headers }
  );
}

async function get(headers: Record<string, string> = {}) {
  const response = await GET(request(headers), {
    params: Promise.resolve({ id: CALL_ID }),
  });
  return { response, body: await response.text() };
}

function upstreamRequest(): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, init };
}

function upstreamHeader(name: string): string | null {
  return new Headers(upstreamRequest().init.headers).get(name);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TWILIO_ACCOUNT_SID", ACCOUNT_SID);
  vi.stubEnv("TWILIO_API_KEY_SID", KEY_SID);
  vi.stubEnv("TWILIO_API_KEY_SECRET", KEY_SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  fetchMock = vi.fn(async () =>
    upstream(200, {
      "content-type": "audio/mpeg",
      "content-length": "9",
      "accept-ranges": "bytes",
      "x-twilio-request-id": "req-1",
    })
  );
  vi.stubGlobal("fetch", fetchMock);
  mockGetSession.mockResolvedValue(session);
  mockGetCallById.mockResolvedValue(callRow());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/calls/[id]/recording.mp3 (AE8)", () => {
  it("returns 401 without a session and never calls Twilio", async () => {
    mockGetSession.mockResolvedValue(null);
    const { response, body } = await get();
    expect(response.status).toBe(401);
    expect(body).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 for another user's call without calling Twilio", async () => {
    mockGetCallById.mockResolvedValue(callRow({ userId: "user-2" }));
    const { response, body } = await get();
    expect(response.status).toBe(404);
    expect(body).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing call", async () => {
    mockGetCallById.mockResolvedValue(null);
    const { response } = await get();
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the call has no recording", async () => {
    mockGetCallById.mockResolvedValue(callRow({ recordingSid: null }));
    const { response, body } = await get();
    expect(response.status).toBe(404);
    expect(body).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches the MP3 from Twilio with the API key and streams it with the no-store and inline headers", async () => {
    const { response, body } = await get();

    expect(response.status).toBe(200);
    expect(body).toBe("mp3-bytes");
    const { url, init } = upstreamRequest();
    expect(url).toBe(MP3_URL);
    expect(init.method).toBe("GET");
    expect(upstreamHeader("authorization")).toBe(
      `Basic ${Buffer.from(`${KEY_SID}:${KEY_SECRET}`).toString("base64")}`
    );
    expect(upstreamHeader("range")).toBeNull();

    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("content-length")).toBe("9");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toBe("inline");
    expect(response.headers.get("x-twilio-request-id")).toBeNull();
  });

  it("forwards a single Range and relays the 206 with Content-Range", async () => {
    fetchMock.mockResolvedValue(
      upstream(
        206,
        {
          "content-type": "audio/mpeg",
          "content-length": "2",
          "content-range": "bytes 0-1/123456",
          "accept-ranges": "bytes",
        },
        "ab"
      )
    );

    const { response, body } = await get({ range: "bytes=0-1" });

    expect(upstreamHeader("range")).toBe("bytes=0-1");
    expect(response.status).toBe(206);
    expect(body).toBe("ab");
    expect(response.headers.get("content-range")).toBe("bytes 0-1/123456");
    expect(response.headers.get("content-length")).toBe("2");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("drops a multi-range header and serves the whole file", async () => {
    const { response } = await get({ range: "bytes=0-1, 5-9" });

    expect(upstreamHeader("range")).toBeNull();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("9");
  });

  it("drops a malformed Range header", async () => {
    await get({ range: "items=0-1" });
    expect(upstreamHeader("range")).toBeNull();
  });

  it("maps an upstream 401 to an empty 502 with no WWW-Authenticate header", async () => {
    fetchMock.mockResolvedValue(
      upstream(
        401,
        {
          "www-authenticate": 'Basic realm="Twilio API"',
          "content-type": "application/xml",
        },
        "<TwilioResponse>nope</TwilioResponse>"
      )
    );

    const { response, body } = await get();

    expect(response.status).toBe(502);
    expect(body).toBe("");
    expect(response.headers.get("www-authenticate")).toBeNull();
    expect(response.headers.get("content-type")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(console.error).toHaveBeenCalled();
    const logged = (console.error as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string;
    expect(logged).toContain("recording_proxy_upstream_error");
    expect(logged).not.toContain(KEY_SECRET);
  });

  it("maps an upstream 404 to an empty 502", async () => {
    fetchMock.mockResolvedValue(upstream(404, {}, "missing"));
    const { response, body } = await get();
    expect(response.status).toBe(502);
    expect(body).toBe("");
  });

  it("maps a network failure to an empty 502", async () => {
    fetchMock.mockRejectedValue(new Error("socket hang up"));
    const { response, body } = await get();
    expect(response.status).toBe(502);
    expect(body).toBe("");
    expect(console.error).toHaveBeenCalled();
  });
});
