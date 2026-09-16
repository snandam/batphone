# Database setup

Bat Phone uses PostgreSQL through Drizzle and the PostgreSQL wire protocol. Better Auth stores Google identities and sessions here; Supabase Auth and the Supabase Data API are not used. Users, profiles, contacts, call metadata, and transcripts live in PostgreSQL. Recordings remain at Twilio and are streamed through an authenticated app endpoint.

| Environment       | Database                                                   | Lifetime                                         |
| ----------------- | ---------------------------------------------------------- | ------------------------------------------------ |
| Local development | Your local PostgreSQL or Docker Compose service            | Until its data/volume is removed                 |
| Codespaces        | PostgreSQL devcontainer service and `postgres_data` volume | Survives stop/reopen of that Codespace           |
| Hosted demo       | Supabase PostgreSQL, accessed by Cloudflare Hyperdrive     | Independent of Worker deployments and Codespaces |

Each environment has separate users and contacts unless deliberately configured to share a database. Completing onboarding locally does not complete it on the hosted demo.

## Hosted Supabase database

Follow [Prepare Supabase and verified database TLS](DEPLOYMENT.md#prepare-supabase-and-verified-database-tls) for credentials, the CA certificate, and Hyperdrive configuration. A PostgreSQL **database password** is required; a Supabase publishable/API key cannot replace it. Hyperdrive supplies connection pooling and connects to Supabase with `verify-full` TLS and the uploaded CA. Query caching is disabled so authentication and call state remain current.

Run migrations separately before deploying, from the repository root with Node.js 22:

```bash
node --env-file=.env.local scripts/supabase-migrate.mjs
```

This reads `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD`, and `SUPABASE_SSL_CA_FILE` from the ignored local environment file. It verifies the certificate over a direct PostgreSQL connection and leaves the local `DATABASE_URL` unchanged. It also enables row-level security and revokes table access from Supabase’s `anon` and `authenticated` roles, preventing access to application tables through the Data API. Server-side ownership checks remain required. Add new application tables to this helper’s protection list when extending the schema. Stop rollout if migration fails.

Do not seed or reset the shared hosted database as part of deployment. Use real Google sign-in and SMS verification for demo users.

## Local and Codespaces databases

**In Codespaces, PostgreSQL and its database are created by the devcontainer.** Skip the manual database/user creation below and follow the [Codespaces quick start](SETUP.md#quick-start-in-github-codespaces). Stop/reopen persistence and full-rebuild limitations are covered in its [persistence check](MANUAL_E2E.md#verify-persistence-by-stopping-and-reopening). The numbered setup steps below are for a separately managed local database.

## 1. Create the Database

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database and user
CREATE DATABASE batphone;
CREATE USER batphone_user WITH ENCRYPTED PASSWORD 'your-secure-password';
GRANT ALL PRIVILEGES ON DATABASE batphone TO batphone_user;
ALTER DATABASE batphone OWNER TO batphone_user;

# Exit psql
\q
```

## 2. Configure Environment

Add to `.env.local`:

```bash
DATABASE_URL=postgresql://batphone_user:your-secure-password@localhost:5432/batphone
```

### Optional settings (uncomment and adjust as needed):

```bash
# SSL: enabled by default in production; use false for local Postgres.
# DATABASE_SSL=false

# Max connections: default 10 in production, 4 in development
# DATABASE_MAX_CONNECTIONS=10

# Set to "false" if using PgBouncer, RDS Proxy, or Supabase pooler
# DATABASE_PREPARE=true
```

### How env loading works

All `db:*` commands (`db:generate`, `db:migrate`, `db:push`, `db:studio`, `db:seed`) automatically load `.env.local` using `@next/env`, the same way Next.js does.
No manual env sourcing is needed.

## 3. Apply Migrations

Migrations are committed under `drizzle/` and applied the same way locally, in CI, and in the Docker `migrations` stage. The hosted Supabase database is migrated with `scripts/supabase-migrate.mjs`, described in the [deployment guide](DEPLOYMENT.md).

```bash
npm run db:migrate
```

`npm run db:push` exists for throwaway local databases only.
It writes no journal, cannot be reviewed, and skips migration tracking, so never run it against a database anyone else uses.

## 4. Seed Sample Data

```bash
npm run db:seed
```

This creates synthetic user/profile, contact, call, and resolution-attempt fixtures. Set `SEED_EMAIL` to the Google account that should own the history. Inserts use stable IDs and skip conflicts when repeated.

The profile fixture includes a pre-marked verified phone, but does not send an SMS or prove ownership; it does not fill the required first/last-name profile fields. It therefore does not substitute for onboarding or a live verification test. Seed only an isolated development database. For a clean end-to-end run, skip seeding and create the user and first contact through the UI.

## 5. Verify

```bash
# Open Drizzle Studio to browse tables
npm run db:studio
```

Or verify via psql:

```bash
psql -U batphone_user -d batphone -c "SELECT id, email, name FROM \"user\";"
```

## Changing the Schema

1. Edit the table in `src/db/schema/`.
2. Run `npm run db:generate`.
3. Review the SQL it wrote under `drizzle/`.
4. Check that the new entry in `drizzle/meta/_journal.json` has a `when` greater than the previous entry.
   drizzle-kit orders migrations by `when`, not `idx`, and silently skips an entry that sorts before one already applied.
5. Commit the schema change and the generated SQL together.
6. Run `npm run db:migrate`.

`src/db/schema/migration-drift.test.ts` fails `npm run test` when a schema change has no generated migration or when the journal is out of order.

Drizzle has no down migrations; a bad migration needs a corrective forward one.
Destructive changes (`DROP COLUMN`, `RENAME COLUMN`, `SET NOT NULL` without a default) break the still-running old code and take two deploys.

## Reset a Local Database

```bash
# Docker Compose (outside Codespaces): drop the volume and start over
docker compose down -v && docker compose up --build

# Inside Codespaces, or anywhere without Docker: drop and recreate the
# schema, then migrate and seed, in one step
npm run db:reset

```

`npm run db:reset` refuses to run when `NODE_ENV=production` or when the `DATABASE_URL` host is not `localhost`, `127.0.0.1`, or `postgres`.
`DB_RESET_FORCE=1` overrides those guards; use it only for a non-local database you own and intend to wipe. Do not override them for the hosted Supabase database. An individual test-account reset needs a scoped backup and deletion plan, not a whole-schema reset.
Never run a forced schema push against any shared database.

## Remote Database (VPS / AWS RDS)

```bash
# .env.local for remote PostgreSQL
DATABASE_URL=postgresql://batphone_user:your-secure-password@your-server-ip:5432/batphone
DATABASE_SSL=true
# Set this when the server uses a CA not already trusted by Node:
DATABASE_SSL_CA_FILE=/path/to/server-root.crt
```

TLS certificate verification stays enabled. Then apply migrations as in step 3 and verify the connection. Seed only if this is an isolated development database.

## All Commands (Quick Reference)

```bash
# Full setup in order:
npm run db:migrate       # Apply committed migrations
npm run db:seed          # Seed sample data
npm run db:studio        # Browse data (optional)

# After a schema change:
npm run db:generate      # Generate a migration (review, then commit it)
npm run db:migrate       # Apply it

# Throwaway local databases only:
npm run db:push
```
