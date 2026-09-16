// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  execute: vi.fn(),
  context: vi.fn(),
  send: vi.fn(),
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("./background-jobs", () => ({ executeBackgroundJob: mocks.execute }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: mocks.context,
}));
import { scheduleBackgroundJob } from "./after";
const job = {
  version: 1,
  kind: "process-recording",
  callId: "call-1",
} as const;
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});
it("uses Next after for Node/Codespaces", async () => {
  vi.stubEnv("BATPHONE_CLOUDFLARE", "false");
  await scheduleBackgroundJob(job);
  expect(mocks.context).not.toHaveBeenCalled();
  await mocks.after.mock.calls[0]?.[0]();
  expect(mocks.execute).toHaveBeenCalledWith(job);
});
describe("Cloudflare durable acceptance", () => {
  it("waits for queue acceptance before resolving", async () => {
    vi.stubEnv("BATPHONE_CLOUDFLARE", "true");
    let accept = () => {};
    mocks.send.mockReturnValue(
      new Promise<void>((resolve) => {
        accept = resolve;
      })
    );
    mocks.context.mockResolvedValue({
      env: { BATPHONE_JOBS: { send: mocks.send } },
    });
    let done = false;
    const pending = scheduleBackgroundJob(job).then(() => {
      done = true;
    });
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledWith(job));
    expect(done).toBe(false);
    accept();
    await pending;
    expect(done).toBe(true);
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it("propagates rejected enqueue to the webhook", async () => {
    vi.stubEnv("BATPHONE_CLOUDFLARE", "true");
    mocks.send.mockRejectedValue(new Error("queue down"));
    mocks.context.mockResolvedValue({
      env: { BATPHONE_JOBS: { send: mocks.send } },
    });
    await expect(scheduleBackgroundJob(job)).rejects.toThrow("queue down");
  });
  it("fails closed if queue binding is absent", async () => {
    vi.stubEnv("BATPHONE_CLOUDFLARE", "true");
    mocks.context.mockResolvedValue({ env: {} });
    await expect(scheduleBackgroundJob(job)).rejects.toThrow(
      "queue binding is missing"
    );
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
