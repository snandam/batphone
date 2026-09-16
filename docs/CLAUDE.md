# Bat Phone contributor guide

Shared coding context for Claude and Codex. Root `AGENTS.md` is a symlink to this file.

## Shared working approach

- Complete authorized work without repeatedly asking for permission on routine steps.
- When blocked, investigate and try a safe alternative. Ask when essential information is missing or an action is ambiguous or destructive.
- Keep changes focused, preserve unrelated work, and verify the result before reporting completion.
- Use independent parallel tasks when they improve throughput; coordinate file ownership to avoid conflicting edits.

## Claude agent

- Use this file as the project-specific guide for Claude.
- Use the tools and subagents available in the current Claude session for independent tasks.
- Follow the shared project rules below and the current session’s instructions.

## Codex agent

- Read the same guide through the root `AGENTS.md` symlink.
- Use Codex native subagents for independent work when that improves throughput and the session permits delegation.
- Follow the shared project rules below and the current session’s instructions.

The remaining sections apply to both agents and human contributors.

## Project and documentation

Bat Phone is a mobile-first Next.js 16 / React 19 app with strict TypeScript, Tailwind CSS v4, shadcn/ui, Better Auth, and Drizzle/PostgreSQL. Google users confirm their names, verify a mobile number by SMS, and add their first contact before entering the app. They call a Twilio number and select a contact by voice or speed dial. Twilio records the call; Deepgram transcribes it; Twilio Email sends the transcript. Codespaces runs Node and PostgreSQL locally; the hosted demo runs through OpenNext on Cloudflare Workers Paid with Supabase PostgreSQL, Hyperdrive, and Queues.

Read the relevant document before changing its area, and update it with behavior changes:

- [README](../README.md): architecture introduction, project story, and quick start.
- [DECISIONS](DECISIONS.md): design rationale, alternatives, evolution, and evidence.
- [Original plan](plans/2026-09-11-001-feat-bat-phone-plan.md): historical planning record, not current instructions or proof of completed checks.
- [DEPLOYMENT](DEPLOYMENT.md): hosted demo options, Cloudflare compatibility, and deployment access.
- [SETUP](SETUP.md): credentials, Codespaces, operational commands, deployment.
- [ARCHITECTURE](ARCHITECTURE.md): call flow, state machine, security, limitations.
- [DB_SETUP](DB_SETUP.md): schema, migration, seed, reset instructions.
- [GOOGLE_AUTH](GOOGLE_AUTH.md): OAuth configuration and recovery.
- [MANUAL_E2E](MANUAL_E2E.md): live provider verification and honest run log.
- [Solutions](solutions/README.md): investigated bugs and durable guardrails.

## Commands

```bash
npm run dev          # Always port 3000
npm run build        # Production build
npm run lint         # ESLint; lint:fix applies fixes
npm run type-check   # TypeScript
npm test             # Vitest
npm run db:generate  # Generate migration after every schema change
npm run db:migrate   # Apply committed migrations
npm run db:seed      # Optional sample data
npm run cf:build     # Build Worker; scrub and check generated environment defaults
npm run cf:deploy    # Guarded Worker deployment with allowlisted runtime secrets
```

Never skip Git hooks with `--no-verify`. Run checks appropriate to the change. Component tests use `src/test/test-utils.tsx`; tests live alongside their source as `*.test.ts` or `*.test.tsx`. Fixture/browser checks are not evidence that a live phone call succeeded.

## Code organization

- `src/actions/`: authenticated server actions, grouped by domain.
- `src/app/`: routes, loading states, error boundaries, webhook handlers.
- `src/components/`: shared UI, authentication, and navigation.
- `src/lib/batphone/`: call flow, matching, providers, pipeline, and presentation helpers.
- `src/db/schema/`: Drizzle tables; committed migrations live in `drizzle/`.
- `src/lib/validations/`: Zod schemas; `src/types/`: shared result types.

Use kebab-case filenames. Default to Server Components; use `"use client"` only for client behavior. Prefer direct imports, avoid unnecessary barrel exports, and run independent asynchronous operations with `Promise.all()`. TypeScript is strict with `noUncheckedIndexedAccess`: avoid `any` and check indexed values.

## Authentication and actions

- Google is the only sign-in provider. There are no roles or plans.
- `ALLOWED_EMAILS` and `ALLOWED_EMAIL_DOMAINS` are comma-separated and case-insensitive. Domains match exactly, not subdomains. Empty lists reject new accounts.
- The allowlist runs before user creation and again before every session is created; removing an address blocks the next sign-in but does not end a session already issued.
- Onboarding has two numbered steps: name confirmation and SMS verification, then the first contact. Saved names override Google suggestions. `onboardingCompletedAt` is stamped atomically with contact creation and survives contact deletion.
- Main app pages and call actions require completed onboarding. Contact creation requires the completed profile only, so step 2 can save its first contact. Never redirect through home between steps.
- Protected pages authenticate themselves. Cookie-presence middleware adds early redirects for `/account`, `/setup`, `/contacts`, and `/calls`; keep `PROTECTED_ROUTES` and `config.matcher` consistent when adding routes.
- Actions authenticate first, validate user input with Zod second, then work. Return `ActionResult<T>`; begin every catch with `unstable_rethrow(error)` so framework redirects still work.
- Scope contact/call access to the session owner. An absent session returns immediately; do not call authenticated endpoints merely to discover a 401.
- Keep OAuth state validation enabled. On failure, return safe instructions to `/login`; do not expose tokens or codes. Keep the browser origin and `BETTER_AUTH_URL` consistent.
- Never read `headers()` or `cookies()` in the root layout: public pages must remain prerenderable. Navbar session state resolves client-side in a fixed-size slot.

## Database and migrations

- Tables use text primary keys with `$defaultFn(() => crypto.randomUUID())`, not Drizzle `uuid()` columns. Seed IDs may be readable text.
- Export new tables from `src/db/schema/index.ts`.
- Every schema change needs `npm run db:generate`, reviewed SQL, and the generated migration committed with the schema.
- Confirm each journal entry's `when` is greater than the preceding entry. Out-of-order timestamps can silently skip migrations; `migration-drift.test.ts` guards this.
- Use `db:migrate` locally and in CI. For the documented Supabase deployment, use `scripts/supabase-migrate.mjs` with the downloaded CA certificate; it applies migrations and protects app tables from Supabase Data API roles. Add new tables to its protection list. `db:push` is only for throwaway local databases, never shared or production data.
- Drizzle has no down migrations. Correct mistakes with forward migrations. Destructive changes need expand-and-contract across deploys.
- Apply migrations as a separate step before rollout. Stop deployment on failure and expose the migration logs.
- Keep Hyperdrive query caching disabled for auth and processing state. Worker database connections are request-scoped; do not introduce a cross-request Postgres singleton.
- Require certificate verification for external PostgreSQL. Use `DATABASE_SSL_CA_FILE` for Node or the uploaded CA and `verify-full` for Hyperdrive.
- Reset commands destroy data; do not override remote/production guards as routine cleanup.

## Phone and pipeline invariants

- Normalize phone numbers to E.164 using the existing phone helpers. Match callers by verified number; do not weaken verification or ownership checks.
- Speed dials are unique per user, range 1–9999. Automatic allocation uses the lowest available code; suggestions stay bounded and custom entry validates availability server-side.
- All calling links dial Bat Phone; contacts are selected during the ordinary voice call.
- Validate Twilio signatures against the public callback URL and bind events to the expected account/call SIDs. Build TwiML with the response builder, never interpolated XML.
- Preserve idempotency, compare-and-set transitions, and claim tokens in webhook/pipeline changes. Guard repeated callbacks and lease takeover. Never claim exactly-once email delivery: an accepted provider send can precede its database result.
- Recovery must resume from the saved state, retain pending recordings, and allow late completed recordings. Node uses process-local after() scheduling; Cloudflare awaits queue acceptance before returning webhook success. Preserve serializable job contracts and uncertain-email safeguards.
- Keep recording playback behind authenticated ownership checks. Escape untrusted contact names and transcript text in email templates.
- Do not log provider credentials, auth cookies, OAuth codes, or state tokens.
- Use explicit locale and timezone for server-rendered dates. Do not parse bare `YYYY-MM-DD` strings as local dates.

## UI conventions

- Mobile-first Tailwind styles; use semantic colors (`text-foreground`, `text-muted-foreground`, `bg-background`, `border-border`, `text-destructive`).
- Main readable content uses foreground; secondary metadata uses muted foreground. Meet contrast and keyboard-access requirements; label controls and provide visible focus states.
- Clickable elements use `cursor-pointer` and usable mobile touch targets.
- Standard page container: `container mx-auto max-w-screen-2xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8`. Use `max-w-2xl` inside for forms; full width for history and tables.
- Navbar/footer span the viewport. Center utility pages such as login/error around a compact card.
- H1: `text-3xl sm:text-4xl lg:text-5xl`; section heading: `text-xl sm:text-2xl`; body: `text-sm sm:text-base`.
- Card padding: `p-4 sm:p-6`. Scale related spacing from 4 to 6, section spacing from 6 to 8, and major spacing from 8 to 12.
- Async routes get layout-matching skeletons, not a generic root spinner. Preserve layout when data or auth loads.
- Dark mode defaults to `dark`, respects saved preferences, and uses `next-themes` with `attribute="class"`, `enableSystem`, and `disableTransitionOnChange`.
- ThemeToggle's server fallback is an empty, same-size button. UserAvatar probes external images client-side before displaying them, preserving initials on failure.
- Home presents the next useful setup/calling action. History prioritizes identity, time, duration, outcome, and transcript access. Keep technical diagnostics in the call detail.

## Configuration

[`.env.example`](../.env.example) is authoritative. Workers Paid is required; keep the configured CPU limit in `wrangler.jsonc`. Codespaces supplies database settings and derives the public URL; do not overwrite those with local settings. `PUBLIC_BASE_URL` is used for Twilio callbacks/signatures. `NEXT_PUBLIC_*` values are inlined at build time; credentials stay server-side. Never commit populated environment files. Cloudflare deployment credentials and Supabase operator credentials stay outside the Worker application-secret allowlist. Use the guarded `cf:*` scripts because OpenNext copies local environment defaults into its generated output before the wrapper scrubs them.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
