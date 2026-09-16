// @vitest-environment node
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  postgres: vi.fn(),
  drizzle: vi.fn(),
  context: vi.fn(),
}));
vi.mock("postgres", () => ({ default: mocks.postgres }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: mocks.drizzle }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: mocks.context,
}));
vi.mock("node:fs", () => ({ readFileSync: vi.fn(() => "test-ca") }));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), exception: vi.fn() },
}));
vi.mock("./schema", () => ({}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("BATPHONE_CLOUDFLARE", "true");
  mocks.postgres.mockImplementation(() =>
    Object.assign(
      vi.fn(async () => []),
      { end: vi.fn(async () => {}) }
    )
  );
  mocks.drizzle.mockImplementation((sql) => ({ execute: sql }));
  mocks.context.mockReturnValue({
    env: { HYPERDRIVE: { connectionString: "postgres://hyperdrive" } },
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("request-scoped Hyperdrive database", () => {
  it("does not connect at import and rejects unscoped Worker queries", async () => {
    const { db } = await import("./primary");
    expect(mocks.postgres).not.toHaveBeenCalled();
    expect(() => db.execute).toThrow("requires withDatabaseContext");
  });

  it("isolates overlapping requests and closes each request's connection", async () => {
    const { connection, withDatabaseContext } = await import("./primary");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withDatabaseContext(async () => {
      await connection`SELECT 1`;
      await gate;
      await connection`SELECT 2`;
    });
    await withDatabaseContext(async () => {
      await connection`SELECT 3`;
    });
    const sql1 = mocks.postgres.mock.results[0]!.value;
    const sql2 = mocks.postgres.mock.results[1]!.value;
    expect(sql1.end).not.toHaveBeenCalled();
    expect(sql2.end).toHaveBeenCalledOnce();
    release();
    await first;
    expect(sql1).toHaveBeenCalledTimes(2);
    expect(sql2).toHaveBeenCalledOnce();
    expect(sql1.end).toHaveBeenCalledOnce();
    expect(mocks.postgres).toHaveBeenCalledWith("postgres://hyperdrive", {
      max: 1,
      prepare: false,
      fetch_types: false,
      connect_timeout: 10,
    });
  });

  it("shares scope across separately evaluated module copies", async () => {
    const outer = await import("./primary");
    vi.resetModules();
    const inner = await import("./primary");
    await outer.withDatabaseContext(
      async () => {
        await outer.connection`SELECT 1`;
        await inner.connection`SELECT 2`;
      },
      { connectionString: "postgres://queue" }
    );
    expect(mocks.postgres).toHaveBeenCalledOnce();
    expect(mocks.context).not.toHaveBeenCalled();
  });

  it("cleans up after queue failure", async () => {
    const { connection, withDatabaseContext } = await import("./primary");
    await expect(
      withDatabaseContext(async () => {
        await connection`SELECT 1`;
        throw new Error("retry this job");
      })
    ).rejects.toThrow("retry this job");
    expect(mocks.postgres.mock.results[0]!.value.end).toHaveBeenCalledOnce();
  });

  it("waits for the response body before closing the connection", async () => {
    const { connection, withDatabaseContext } = await import("./primary");
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const waitUntil = vi.fn();
    const response = await withDatabaseContext(
      async () => {
        await connection`SELECT 1`;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(value) {
              controller = value;
            },
          })
        );
      },
      { waitUntil }
    );
    const sql = mocks.postgres.mock.results[0]!.value;
    expect(sql.end).not.toHaveBeenCalled();
    controller.enqueue(new TextEncoder().encode("hello"));
    controller.close();
    expect(await response.text()).toBe("hello");
    await waitUntil.mock.calls[0]![0];
    expect(sql.end).toHaveBeenCalledOnce();
  });
});

describe("Node database TLS", () => {
  it("verifies certificates and loads a supplied CA when SSL is explicitly enabled", async () => {
    vi.stubEnv("BATPHONE_CLOUDFLARE", "false");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgres://remote/db");
    vi.stubEnv("DATABASE_SSL", "true");
    vi.stubEnv("DATABASE_SSL_CA_FILE", "/tmp/database-ca.crt");
    vi.stubEnv("DB_HOST", "");
    const { connection } = await import("./primary");
    await connection`SELECT 1`;
    expect(readFileSync).toHaveBeenCalledWith("/tmp/database-ca.crt", "utf8");
    expect(mocks.postgres).toHaveBeenCalledWith(
      "postgres://remote/db",
      expect.objectContaining({
        ssl: { rejectUnauthorized: true, ca: "test-ca" },
      })
    );
  });

  it("preserves explicitly disabled TLS for local Docker", async () => {
    vi.stubEnv("BATPHONE_CLOUDFLARE", "false");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgres://local/db");
    vi.stubEnv("DATABASE_SSL", "false");
    vi.stubEnv("DB_HOST", "");
    const { connection } = await import("./primary");
    await connection`SELECT 1`;
    expect(mocks.postgres).toHaveBeenCalledWith(
      "postgres://local/db",
      expect.objectContaining({ ssl: false })
    );
    expect(readFileSync).not.toHaveBeenCalled();
  });
});
