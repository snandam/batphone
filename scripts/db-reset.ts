/**
 * Reset a development database from inside the codespace.
 *
 * Usage:
 *   npm run db:reset
 *
 * Drops and recreates the public schema, then applies the committed
 * migrations and seeds sample data. Docker is not available inside the dev
 * container, so this replaces `docker compose down -v`.
 *
 * Refuses to run against anything that is not a local database
 * (NODE_ENV=production, or a DATABASE_URL host other than localhost,
 * 127.0.0.1, or postgres) unless DB_RESET_FORCE=1.
 */

import { spawnSync } from "node:child_process";

import { loadEnvConfig } from "@next/env";
import postgres from "postgres";

loadEnvConfig(process.cwd());

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "postgres"]);

function fail(message: string): never {
  console.error(`db:reset refused: ${message}`);
  process.exit(1);
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(
      `db:reset failed: ${command} ${args.join(" ")} exited with ${result.status}`
    );
    process.exit(result.status ?? 1);
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    fail(
      "DATABASE_URL is not set. Add it to .env.local or export it in your shell."
    );
  }

  const force = process.env.DB_RESET_FORCE === "1";
  if (process.env.NODE_ENV === "production" && !force) {
    fail(
      "NODE_ENV=production. Set DB_RESET_FORCE=1 only if you really mean it."
    );
  }

  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    fail("DATABASE_URL is not a valid URL.");
  }
  if (!LOCAL_HOSTS.has(host) && !force) {
    fail(
      `DATABASE_URL host "${host}" is not local (localhost, 127.0.0.1, postgres). ` +
        "Set DB_RESET_FORCE=1 to reset a non-local database on purpose."
    );
  }

  console.log(`Dropping schemas "public" and "drizzle" on ${host}...`);
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    // drizzle-kit records applied migrations in its own "drizzle" schema.
    // Dropping only "public" would leave that journal intact, so migrate
    // would report success without recreating any table.
    await sql.unsafe(
      "DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;"
    );
  } finally {
    await sql.end();
  }

  console.log("Applying migrations...");
  run("npx", ["drizzle-kit", "migrate"]);

  console.log("Seeding...");
  run("npm", ["run", "db:seed"]);

  console.log("Database reset complete.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`db:reset failed: ${message}`);
  process.exit(1);
});
