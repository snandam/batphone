import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

// Load .env.local (and other .env files) the same way Next.js does,
// so drizzle-kit commands work without manual env sourcing.
loadEnvConfig(process.cwd());

// Support both DATABASE_URL and separate DB_* env vars
function getDbCredentials() {
  // Prefer separate env vars (avoids URL encoding issues)
  if (process.env.DB_HOST) {
    const host = process.env.DB_HOST;
    const port = process.env.DB_PORT || "5432";
    const user = process.env.DB_USER;
    const password = process.env.DB_PASSWORD;
    const database = process.env.DB_NAME || "app";
    const sslEnabled = process.env.DATABASE_SSL !== "false";

    return {
      host,
      port: parseInt(port),
      user,
      password,
      database,
      // SECURITY NOTE: rejectUnauthorized: false skips certificate verification.
      // Acceptable for RDS within VPC where traffic stays in AWS's private network.
      // For stricter security, use the RDS CA bundle instead.
      ssl: sslEnabled ? { rejectUnauthorized: false } : false,
    };
  }

  // Fall back to DATABASE_URL
  if (process.env.DATABASE_URL) {
    return {
      url: process.env.DATABASE_URL,
    };
  }

  throw new Error(
    "Database config required. Set DB_HOST/DB_USER/DB_PASSWORD/DB_NAME or DATABASE_URL"
  );
}

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: getDbCredentials(),
  // Enable verbose logging in development
  verbose: true,
  // Strict mode for safer migrations
  strict: true,
});
