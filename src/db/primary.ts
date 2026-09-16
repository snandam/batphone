import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { logger } from "@/lib/logger";

import * as schema from "./schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;
type DatabaseScope = {
  connectionString?: string;
  connection?: postgres.Sql;
  db?: Database;
};

// The custom Worker and OpenNext server can contain separate copies of this
// module. A shared symbol ensures both use the same request-local storage.
const scopeKey = Symbol.for("batphone.database.scope");
const globals = globalThis as typeof globalThis & {
  [scopeKey]?: AsyncLocalStorage<DatabaseScope>;
  primaryConnection?: postgres.Sql;
};
const scopes = (globals[scopeKey] ??= new AsyncLocalStorage<DatabaseScope>());
let nodeDatabase: Database | undefined;
let nodeConnection: postgres.Sql | undefined;

function getSSLMode(): postgres.Options<Record<string, never>>["ssl"] {
  if (process.env.DATABASE_SSL === "false") return false;
  if (
    process.env.DATABASE_SSL !== "true" &&
    process.env.NODE_ENV !== "production"
  ) {
    return false;
  }
  const caFile = process.env.DATABASE_SSL_CA_FILE;
  return {
    rejectUnauthorized: true,
    ...(caFile ? { ca: readFileSync(caFile, "utf8") } : {}),
  };
}

function createNodeConnection(): postgres.Sql {
  const options: postgres.Options<Record<string, never>> = {
    max: Number(
      process.env.DATABASE_MAX_CONNECTIONS ||
        (process.env.NODE_ENV === "production" ? "10" : "4")
    ),
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: getSSLMode(),
    prepare: process.env.DATABASE_PREPARE !== "false",
  };
  if (process.env.DB_HOST) {
    return postgres({
      ...options,
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || "5432"),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || "app",
    });
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Set DB_HOST or DATABASE_URL for the database connection.");
  }
  return postgres(url, options);
}

function currentConnection(): postgres.Sql {
  const scope = scopes.getStore();
  if (scope) {
    if (!scope.connection) {
      const connectionString =
        scope.connectionString ??
        (
          getCloudflareContext().env as unknown as {
            HYPERDRIVE?: { connectionString: string };
          }
        ).HYPERDRIVE?.connectionString;
      if (!connectionString) throw new Error("Missing HYPERDRIVE binding.");
      // Hyperdrive handles the origin pool and TLS. Its local socket must be
      // created inside this request, never reused by another request.
      scope.connection = postgres(connectionString, {
        max: 1,
        prepare: false,
        fetch_types: false,
        connect_timeout: 10,
      });
    }
    return scope.connection;
  }
  if (process.env.BATPHONE_CLOUDFLARE === "true") {
    throw new Error("Cloudflare database access requires withDatabaseContext.");
  }
  nodeConnection ??= globals.primaryConnection ?? createNodeConnection();
  if (process.env.NODE_ENV !== "production") {
    globals.primaryConnection = nodeConnection;
  }
  return nodeConnection;
}

function currentDatabase(): Database {
  const scope = scopes.getStore();
  if (scope) return (scope.db ??= drizzle(currentConnection(), { schema }));
  return (nodeDatabase ??= drizzle(currentConnection(), { schema }));
}

// Better Auth keeps its adapter at module scope. Resolve the real client only
// when an operation runs, so auth and all other callers share the request pool.
export const db = new Proxy({} as Database, {
  get(_target, property) {
    const database = currentDatabase();
    const value: unknown = Reflect.get(database, property);
    return typeof value === "function" ? value.bind(database) : value;
  },
});

export const connection = new Proxy((() => {}) as unknown as postgres.Sql, {
  apply(_target, _thisArg, args) {
    const sql = currentConnection();
    return Reflect.apply(sql, sql, args);
  },
  get(_target, property) {
    const sql = currentConnection();
    const value: unknown = Reflect.get(sql, property);
    return typeof value === "function" ? value.bind(sql) : value;
  },
});

/** Wrap both Worker fetch and queue handlers; Node/Codespaces needs no wrapper. */
export async function withDatabaseContext<T>(
  callback: () => Promise<T>,
  options: {
    connectionString?: string;
    waitUntil?: (promise: Promise<unknown>) => void;
  } = {}
): Promise<T> {
  const scope: DatabaseScope = { connectionString: options.connectionString };
  return scopes.run(scope, async () => {
    const close = async () => {
      if (scope.connection) await scope.connection.end({ timeout: 5 });
    };
    try {
      const result = await callback();
      if (result instanceof Response && result.body) {
        // RSC can query the database after fetch returns headers. Keep its
        // scope alive until the response stream completes or is cancelled.
        const stream = new TransformStream<Uint8Array, Uint8Array>();
        const completed = result.body.pipeTo(stream.writable).finally(close);
        const handled = completed.catch((error: unknown) => {
          logger.exception("database_response_stream_failed", error);
        });
        options.waitUntil?.(handled);
        return new Response(stream.readable, result) as T;
      }
      await close();
      return result;
    } catch (error) {
      await close();
      throw error;
    }
  });
}

export async function checkConnection(): Promise<boolean> {
  try {
    await connection`SELECT 1`;
    logger.debug("database_connection_healthy");
    return true;
  } catch (error) {
    logger.exception("database_connection_failed", error);
    return false;
  }
}

export async function closeConnection(): Promise<void> {
  await currentConnection().end();
}
