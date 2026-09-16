/** Apply the app's committed migrations to Supabase without changing local DATABASE_URL. */
import { readFileSync } from "node:fs";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const project = process.env.SUPABASE_PROJECT_ID;
const password = process.env.SUPABASE_DB_PASSWORD;
const certificate = process.env.SUPABASE_SSL_CA_FILE;
if (!project || !password || !certificate) {
  throw new Error(
    "Set SUPABASE_PROJECT_ID, SUPABASE_DB_PASSWORD, and SUPABASE_SSL_CA_FILE."
  );
}
const sql = postgres({
  host: `db.${project}.supabase.co`,
  port: 5432,
  database: "postgres",
  username: "postgres",
  password,
  ssl: { ca: readFileSync(certificate, "utf8"), rejectUnauthorized: true },
  max: 1,
  connect_timeout: 10,
});
try {
  await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
  // Bat Phone authorizes access in its server. These tables must not also
  // become readable through Supabase's public Data API and publishable key.
  const names = [
    "user",
    "session",
    "account",
    "verification",
    "user_profile",
    "contact",
    "call",
    "twilio_event",
    "resolution_attempt",
  ];
  await sql.begin(async (transaction) => {
    for (const name of names) {
      await transaction`ALTER TABLE ${transaction(`public.${name}`)} ENABLE ROW LEVEL SECURITY`;
      await transaction`REVOKE ALL ON TABLE ${transaction(`public.${name}`)} FROM anon, authenticated`;
    }
  });
  console.log(
    "Supabase migrations applied; application tables protected from public Data API roles."
  );
} catch (error) {
  // Connection strings and provider errors can contain credentials.
  console.error("Supabase migration failed", { code: error.code ?? "unknown" });
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
