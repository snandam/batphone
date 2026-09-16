import { afterEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/lib/batphone/background-jobs", () => ({
  executeBackgroundJob: execute,
  isBackgroundJob: (value: unknown) =>
    typeof value === "object" && value !== null && "callId" in value,
}));
vi.mock("@/lib/logger", () => ({ logger: { exception: vi.fn() } }));

import { POST } from "./route";

const secret = "test-only-job-secret";
function request(authorization?: string, body = '{"callId":"call-1"}') {
  return new Request("https://batphone.example.com/api/internal/jobs", {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
    body,
  });
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("internal queue job authorization", () => {
  it("fails closed when no server secret is configured", async () => {
    vi.stubEnv("BATPHONE_JOB_SECRET", "");
    expect((await POST(request(`Bearer ${secret}`))).status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });
  it.each([undefined, "Bearer wrong", `Bearer ${secret}x`])(
    "rejects unauthorized calls before executing jobs: %s",
    async (authorization) => {
      vi.stubEnv("BATPHONE_JOB_SECRET", secret);
      expect((await POST(request(authorization))).status).toBe(401);
      expect(execute).not.toHaveBeenCalled();
    }
  );
  it("rejects malformed jobs", async () => {
    vi.stubEnv("BATPHONE_JOB_SECRET", secret);
    expect((await POST(request(`Bearer ${secret}`, "{}"))).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
  it("returns a retry result to the authenticated consumer", async () => {
    vi.stubEnv("BATPHONE_JOB_SECRET", secret);
    execute.mockResolvedValue({ status: "retry", delaySeconds: 60 });
    const response = await POST(request(`Bearer ${secret}`));
    expect(await response.json()).toEqual({
      status: "retry",
      delaySeconds: 60,
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("does not expose provider errors", async () => {
    vi.stubEnv("BATPHONE_JOB_SECRET", secret);
    execute.mockRejectedValue(new Error("private provider details"));
    const response = await POST(request(`Bearer ${secret}`));
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
  });
});
