# Deployment

The hosted demo runs on **Cloudflare Workers Paid with Supabase PostgreSQL**. This guide takes a new deployment from provider accounts to a verified public URL. For development or a scheduled demo, [Codespaces setup](SETUP.md#quick-start-in-github-codespaces) remains supported and needs neither Cloudflare nor Supabase.

Follow the sections in order: prerequisites → token → Supabase and migrations → Hyperdrive and queues → Worker configuration and deployment → Google login and Twilio cutover → live verification. The checked-in Worker configuration belongs to the existing demo; replace its resource identifiers and hostname for your own installation.

Bat Phone needs a public HTTPS application, persistent PostgreSQL, provider credentials, and a runtime that can finish post-call work. A domain supplies an address; it does not supply the application server or database. Codespaces remains a fully supported way to run and test the complete solution. The hosted demo is an additional environment, not a replacement.

## Codespaces and the hosted demo

Codespaces is suitable for development and scheduled demonstrations. Its default idle timeout is 30 minutes and can be set up to four hours, subject to organization policy; there is no never-stop idle setting. Compute is billed while it runs. When it stops, the application and phone callbacks become unavailable. Use a hosted application for a demo people can access without asking someone to start the environment. [GitHub idle timeout documentation](https://docs.github.com/en/codespaces/setting-your-user-preferences/setting-your-timeout-period-for-github-codespaces).

## Cloudflare Workers with Supabase PostgreSQL

**Workers Paid is required for this application.** The Free plan allows only 10 ms of CPU per HTTP invocation. Authenticated Next.js pages in the live deployment used approximately 80-90 ms; Free-plan requests can intermittently fail with Error 1102 despite successful health checks. Enable Workers Paid in the account before deploying. The checked-in configuration sets a 1,000 ms CPU ceiling; this is CPU execution time, not time spent waiting for the database or providers. [CPU limits](https://developers.cloudflare.com/workers/platform/limits/), [pricing](https://developers.cloudflare.com/workers/platform/pricing/).

The repository includes an OpenNext adapter, a custom Worker entry point, Hyperdrive database support, and a Cloudflare Queues consumer. Cloudflare hosts the application and job consumer; Supabase hosts PostgreSQL; Hyperdrive connects the two and pools origin connections. Supabase Auth is not used: Better Auth and Google remain the sign-in system.

```mermaid
flowchart LR
    Request[Browser or Twilio callback] --> Worker[Next.js on Cloudflare Workers]
    Worker --> Hyperdrive[Hyperdrive]
    Hyperdrive --> DB[(Supabase PostgreSQL)]
    Worker --> Queue[Post-call queue]
    Queue --> Consumer[Worker queue consumer]
    Consumer --> Hyperdrive
    Consumer --> Providers[Twilio recording, Deepgram, email]
```

[worker.ts](../worker.ts) wraps each HTTP request and queue invocation in a database scope. [The database module](../src/db/primary.ts) opens a Postgres.js client inside that scope using the `HYPERDRIVE` binding, then closes it after the response stream finishes. Connections are not shared across Workers requests. Node.js and Codespaces retain their existing connection pool.

On Cloudflare, [background scheduling](../src/lib/batphone/after.ts) awaits queue acceptance before returning. Messages contain a job kind and call identifier, never audio or credentials. The consumer invokes the app's internal job handler with `BATPHONE_JOB_SECRET`, resumes saved progress, and retries execution failures. The configured queue processes one message per batch, allows two concurrent consumers, and sends exhausted retries to a dead-letter queue. Uncertain email outcomes require manual review rather than automatic resending. Queue delivery is not an exactly-once email guarantee.

Node.js and Codespaces use the same job functions through Next.js `after()`. That fallback remains process-local and requires the application to stay running. Queues removes that response-bound scheduling dependency for Workers, but recording buffers, provider timeouts, redelivery, and long calls still need testing within [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [Queues limits](https://developers.cloudflare.com/queues/platform/limits/).

Use a dedicated subdomain such as `batphone.example.com`, leaving the root website and email DNS records intact. Authenticated pages, recordings, and webhook responses must not be cached. Twilio callbacks must be publicly reachable without a browser challenge or Cloudflare Access login; the app validates their signatures.

A persistent Node.js container remains an alternative. The [Dockerfile](../Dockerfile) provides an application image and a separate migrations image. That runtime retains `after()` scheduling; keeping a container running does not supply durable jobs.

## Prerequisites and configuration ownership

Before provisioning resources:

1. Install Node.js 22 and run `npm ci` from the repository root. Wrangler and OpenNext are repository dependencies.
2. Enable Workers Paid on the Cloudflare account that owns your domain. Choose an unused subdomain such as `batphone.example.com`.
3. Create or select a Supabase PostgreSQL project. Retain access to its database password, CA certificate, backups, and project settings.
4. Complete [provider credential setup](SETUP.md#credential-setup): Google OAuth, Twilio Voice and Verify, Deepgram, and an authenticated Twilio Email domain. You need permission to update the Google client's URLs and the Twilio number's callbacks later.
5. Create the ignored `.env.local` from `.env.example` if it does not already exist. Populate your own provider settings; cloning this repository supplies no credentials.

| Configuration                                                                       | Where it belongs                                              | What uses it                                                                           |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`                                     | Local `.env.local` or deployment CI environment               | Resource provisioning and Wrangler deployment only                                     |
| `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD`, `SUPABASE_SSL_CA_FILE`               | Local `.env.local` or migration environment                   | Direct database migrations; the password is also supplied when provisioning Hyperdrive |
| Provider keys, `BETTER_AUTH_SECRET`, allowlist, `EMAIL_FROM`, `BATPHONE_JOB_SECRET` | Local deployment environment → Worker secrets via `cf:deploy` | Application runtime                                                                    |
| Stable public URL, support email, resource IDs and queue names                      | `wrangler.jsonc`; public phone number supplied at build       | Worker bindings and public app configuration                                           |

Never upload the Cloudflare deployment token or Supabase operator settings as application secrets. The Worker receives its database connection through Hyperdrive. `SUPABASE_PROJECT_REGION` is optional operator information; neither deployment nor migration scripts require it. A Supabase publishable/service-role API key is not used.

Codespaces secrets, GitHub Actions secrets, local `.env.local`, and deployed Worker secrets are separate stores. Saving a value in one does not populate the others. The deployment wrapper explicitly transfers only its allowlisted app settings.

## Cloudflare account API token setup

Wrangler is Cloudflare's deployment CLI. An API token lets it deploy from your computer or CI without a browser login. These steps use the **Account API tokens** interface; its resource selector says **Entire Account** and **Specified Domains**, rather than the Account/Zone dropdowns shown in some user-token guides.

Creating the token prepares deployment access. Provisioning, binding configuration, migrations, and live verification are separate steps below.

### 1. Open the token editor

In the Cloudflare dashboard, select the account that owns your domain, then open **Manage account → Account API tokens → Create token**. Name it `batphone-deploy` and choose **Start from scratch** to select individual permissions.

### 2. Add the account policy

Choose **Entire Account** as the resource scope. Select only these permissions for the deployment account:

| Permission           | Access | Purpose                                                      |
| -------------------- | ------ | ------------------------------------------------------------ |
| Account Settings     | Read   | Identify the account                                         |
| Workers Scripts      | Write  | Create/deploy Worker code and manage its secrets             |
| Workers Tail         | Read   | Inspect live Worker logs                                     |
| Hyperdrive           | Write  | Configure connectivity to hosted PostgreSQL                  |
| SSL and Certificates | Write  | Upload the Supabase CA certificate for verified database TLS |
| Queues               | Write  | Create/configure post-call job queues                        |

The account-token screen labels this access **Write**; other screens may call it **Edit**. If you started with the **Edit Cloudflare Workers** template, review its selected permissions rather than assuming all are required. The **Workers Editor** role may appear alongside Workers Scripts Write; these overlap for editing existing Workers. Keep Workers Scripts Write for the initial setup: an Editor role alone does not grant creation of a new Worker under the newer role model. [Workers roles and creation permissions](https://developers.cloudflare.com/workers/authorization/workers/).

**SSL and Certificates Write is an additional account permission.** Hyperdrive Write alone does not authorize uploading a custom CA. Add it under **Entire Account**, not the domain policy. A certificate upload returning HTTP 403 can mean this permission is missing or its update has not propagated. Confirm the policy and account, allow the change to propagate, then retry the upload before replacing the token. This permission is used to upload the database CA; it does not require sharing your domain's TLS private key.

Do not select **Read all resources** or **Write all resources**. Account DNS Settings, DNS Firewall, DNS View, and Registrar Domains permissions are not needed for this Workers deployment.

### 3. Add the domain policy

Keep the account policy, then click **Add policy**:

1. Change the new policy's resource selector to **Specified Domains**.
2. Select the domain that will host the app, such as `example.com` for `batphone.example.com`.
3. Search the permissions for **Workers Routes** and enable **Write**.
4. Search for **Zone** and enable **Read**.

**Cannot find Workers Routes?** Check that this policy is scoped to **Specified Domains**, not **Entire Account**. The deployment permissions and domain permissions belong in separate policies. Scope the latter to your selected domain, not All Domains. Workers Routes Write permits attaching the Worker custom domain; unrelated DNS-edit permissions are not part of this token checklist. [Cloudflare permission reference](https://developers.cloudflare.com/fundamentals/api/reference/permissions/).

### 4. Review and create

Choose an expiration suitable for your deployment workflow; 30 days is a reasonable initial period. Expiration prevents subsequent API operations with this token; it does not remove an already deployed app. Leave client IP filtering blank unless you have stable deployment IPs to allow.

Click **Review token** and check that the summary contains the account permissions above and a separate domain policy with **Workers Routes Write** and **Zone Read**. Then click **Create token** and save the value when displayed.

### 5. Save it locally

Add these entries to the existing `.env.local` in the repository root, preserving the app settings already there:

```dotenv
CLOUDFLARE_API_TOKEN=replace-with-your-token
CLOUDFLARE_ACCOUNT_ID=replace-with-your-account-id
```

The account ID is available in the Cloudflare dashboard and in the account portion of its URL. It is an identifier, not the token. `.env.local` is Git-ignored; keep the token out of commits, screenshots, and chat. Never prefix it with `NEXT_PUBLIC_` or upload it as an application runtime secret: it is a deployment credential.

### 6. Verify authentication

From the repository root, use Node.js 22 to load the local environment file and invoke Wrangler without putting the token in the command or printing it:

```bash
node --env-file=.env.local node_modules/wrangler/bin/wrangler.js whoami
```

This uses the installed Wrangler version and displays account information. It verifies authentication; it does not prove that every deployment permission works. If authentication fails, check the token value, expiration, and account. If a later operation returns a permissions error, check its corresponding policy and resource scope rather than granting access to all resources.

If you add a deploy workflow later (none is included; CI does not deploy), save the token as an **Actions secret** named `CLOUDFLARE_API_TOKEN` and the account ID as the workflow's `CLOUDFLARE_ACCOUNT_ID` configuration. These are separate from the **Codespaces secrets** used to run the development app. The account-token flow does not require `wrangler login`.

## Prepare Supabase and verified database TLS

Supabase Free projects can pause after a seven-day period of low activity. Workers Paid does not prevent a database pause. Check the project status and `/api/ready` before a scheduled demo; use a database plan suited to continuous availability if that is required. [Supabase project pausing](https://supabase.com/docs/guides/platform/free-project-pausing).

1. Create a Supabase project and save its **database password**. This is the password selected when creating the project, not a Supabase publishable key, secret API key, service-role key, or account login password. The app connects to PostgreSQL directly and needs no Supabase API key.
2. Open the project's **Connect** dialog and inspect the **Direct connection** details. The expected format is `postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres`. The migration helper uses these components directly, so the password does not need URL encoding. Direct access requires a network capable of reaching the database address; check the project's IPv6/IPv4 options if it is unreachable. [Supabase connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres).
3. In the project's Database settings, download the server root certificate. Save it outside the repository, for example `/path/to/certificates/supabase-root.crt`. Keep server certificate verification enabled. [Supabase TLS guidance](https://supabase.com/docs/guides/platform/ssl-enforcement).
4. Add the following operator settings to the ignored `.env.local`, preserving the local app's existing `DATABASE_URL`:

   ```dotenv
   SUPABASE_PROJECT_ID=your-project-reference
   SUPABASE_DB_PASSWORD=your-database-password
   SUPABASE_SSL_CA_FILE=/path/to/certificates/supabase-root.crt
   ```

5. Apply the committed migrations over the direct TLS connection:

   ```bash
   node --env-file=.env.local scripts/supabase-migrate.mjs
   ```

   The helper reads the downloaded CA, verifies the server certificate, and leaves the local `DATABASE_URL` unchanged. It enables row-level security on application tables and revokes privileges from Supabase's `anon` and `authenticated` roles, preventing the public Data API from bypassing server ownership checks. A failed migration must stop rollout. When adding tables, update the helper's protection list too.

## Provision Hyperdrive and queues

Upload the downloaded Supabase CA, replacing the file path below:

```bash
node --env-file=.env.local node_modules/wrangler/bin/wrangler.js cert upload certificate-authority --name batphone-supabase-ca --ca-cert /path/to/certificates/supabase-root.crt
```

Record the returned certificate ID. In Cloudflare, open **Hyperdrive → Create configuration** and enter the origin settings below. Under **Server certificates**, select **Verify full** and the uploaded CA certificate. The equivalent Wrangler flags follow the table:

| Setting                    | Value                                                       |
| -------------------------- | ----------------------------------------------------------- |
| Host                       | `db.<your-project-reference>.supabase.co`                   |
| Port / database / username | `5432` / `postgres` / `postgres`                            |
| Password                   | Your Supabase database password                             |
| TLS mode                   | `verify-full`                                               |
| CA certificate             | The certificate ID uploaded above                           |
| Query caching              | Disabled: login and processing state must read current data |

The `wrangler hyperdrive create` options are `--origin-host`, `--origin-port`, `--database`, `--origin-user`, `--origin-password`, `--ca-certificate-id`, `--sslmode verify-full`, and `--caching-disabled`. Keep passwords out of shared commands and terminal transcripts. [Hyperdrive certificate configuration](https://developers.cloudflare.com/hyperdrive/configuration/tls-ssl-certificates-for-hyperdrive/) explains custom CA handling. Record the resulting Hyperdrive resource ID for the next section; never put its origin password into `wrangler.jsonc`.

Create the normal and dead-letter queues in the deployment account:

```bash
node --env-file=.env.local node_modules/wrangler/bin/wrangler.js queues create batphone-postcall
node --env-file=.env.local node_modules/wrangler/bin/wrangler.js queues create batphone-postcall-failed
```

If those names already serve a different deployment in your account, choose distinct names and use them consistently in the producer, consumer, and dead-letter configuration. The binding names `HYPERDRIVE` and `BATPHONE_JOBS` must remain unchanged because the application uses them.

## Configure, build, and deploy the Worker

### Replace the demo's configuration

Edit [wrangler.jsonc](../wrangler.jsonc) for your own resources:

- Set `name` to your Worker name, and `services[].service` to that same name. Keep the binding `WORKER_SELF_REFERENCE`.
- Set `PUBLIC_BASE_URL`, `BETTER_AUTH_URL`, and `NEXT_PUBLIC_APP_URL` to the same stable HTTPS origin.
- Set `routes[].pattern` to the hostname without `https://`, retaining `custom_domain: true`.
- Set `NEXT_PUBLIC_SUPPORT_EMAIL` to your support mailbox for the public privacy/terms pages.
- Replace `hyperdrive[].id` with **your** Hyperdrive ID; the checked-in value cannot provision or connect your database.
- Match all queue names to the resources just created. Keep the retry/dead-letter configuration and the `limits.cpu_ms: 1000` setting on Workers Paid.

Do not deploy unchanged configuration to a new account. The existing resource ID and hostname are identifiers for the current demo, not portable examples.

### Supply runtime and build settings

Populate the [required application credentials](SETUP.md#codespaces-secrets) in `.env.local`. Generate a separate random `BATPHONE_JOB_SECRET` (for example, with `openssl rand -hex 32`) and save it there. Retain it across deployments unless deliberately rotating it. Set at least one of `ALLOWED_EMAILS` or `ALLOWED_EMAIL_DOMAINS`; `gmail.com` admits that exact domain, subject to Google's consent audience settings.

`cf:deploy` requires `BETTER_AUTH_SECRET`, Google client credentials, the Twilio account/auth/API-key/phone/Verify settings, `DEEPGRAM_API_KEY`, `EMAIL_FROM`, `BATPHONE_JOB_SECRET`, and a nonempty allowlist. It transfers those settings plus its optional allowlisted names (`EMAIL_FROM_NAME`, `TWILIO_VOICE`, `TWILIO_SPEECH_MODEL`, `DEFAULT_PHONE_REGION`) as Worker secrets. Settings absent from this list are not automatically transferred; see [the wrapper](../scripts/cloudflare.mjs) before extending configuration.

Set `NEXT_PUBLIC_BAT_PHONE_NUMBER` to the same number as `TWILIO_PHONE_NUMBER`; the wrapper falls back to the latter. Public values are inlined at build time. The wrapper takes the origin from `wrangler.jsonc`, overriding local URL values for the build.

### Build and deploy

After migrations and resource configuration succeed:

```bash
npm run cf:build
npm run cf:deploy
```

Both commands build with OpenNext. The wrapper replaces the generated local-environment module with empty exports so local server/operator settings do not become runtime defaults. It scans the artifact for loaded credential values whose names contain `SECRET`, `PASSWORD`, `TOKEN`, or `API_KEY`, stopping on matches without printing values. This targeted guard is not a general proof that an artifact contains no sensitive data.

On deploy, the wrapper writes only allowlisted runtime settings to a temporary restricted-permission file, gives it to Wrangler, and removes it afterward. Use the wrapper rather than a direct adapter deployment, so these checks and runtime-secret transfer execute together.

**Optional local Worker preview:** `npm run cf:preview` also builds, then starts Wrangler's local preview server. It does not upload application secrets like `cf:deploy`. Create an ignored `.dev.vars` by hand (no template is provided) with application runtime settings and a reachable local database via `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` (the wrapper falls back to local `DATABASE_URL`). Do not copy operator tokens into `.dev.vars`. Preview uses the configured public origin; it is not a ready-to-use local OAuth/Twilio environment. Use the Node/Codespaces path for ordinary local development, and the deployed HTTPS origin for live provider checks.

## Configure Google OAuth and switch Twilio

1. Check the deployed application and database:

   ```bash
   curl --fail --silent --show-error https://batphone.example.com/api/health
   curl --fail --silent --show-error https://batphone.example.com/api/ready
   ```

   Replace the hostname with yours. Readiness must report `"status":"ready"` and `"database":"connected"`.

2. In your Google OAuth **Web application** client, add your HTTPS origin as an Authorized JavaScript origin and that origin plus `/api/auth/callback/google` as an Authorized redirect URI. Keep existing environment entries. Configure audience/test users and the deployed privacy/terms URLs following [Google sign-in setup](GOOGLE_AUTH.md).
3. Sign in and complete onboarding: step 1 confirms names and verifies the mobile number by SMS; step 2 saves the first contact. Confirm another user's contacts are not visible. Public health probes alone cannot validate authenticated pages or SMS.
4. Point the Twilio number at the new deployment **only when ready for live calls**:

   ```bash
   PUBLIC_BASE_URL=https://batphone.example.com npm run twilio:configure
   ```

   This explicitly overrides a localhost URL in `.env.local`; the script loads provider credentials from that file. Check its printed Voice and status URLs name your deployed origin and use POST. One Voice number has one active callback destination; this switches calls away from Codespaces or another environment. A Codespace start hook can switch it back. Use separate numbers for simultaneous environments.

5. Run [live verification](MANUAL_E2E.md): human answer, voicemail, recording playback, transcript, actual inbox delivery, recovery, and stop/retry scenarios. Include a longer call for memory and execution limits, plus queue redelivery and dead-letter handling. Record actual results; a build or provider-accepted email is not a complete end-to-end result.

## Operations and rollback

- Keep a previous Worker version and the previous Twilio callback configuration for rollback. Database migrations are forward-only; an application rollback must remain compatible with the migrated schema.
- Monitor Worker invocation errors and both queues. Investigate dead-letter messages rather than replaying them blindly. Check saved state and provider outcomes before retrying uncertain email sends.
- Configure Supabase backups and test restore. PostgreSQL persistence survives app deployments, but deployment itself creates no backup. Check your Supabase plan's availability and backup behavior for an unattended demo.
- Avoid browser challenges or Cloudflare Access on signed Twilio callbacks. Do not cache authenticated pages, recordings, or webhook responses.
- Keep domain, provider billing, allowlists, and deployment-token expiration under review. Token expiration stops future deployments, not the currently running Worker.

## Deployment verification record

The [manual end-to-end checklist](MANUAL_E2E.md) is the procedure for live verification. Hosted checks established HTTPS/database readiness, Google sign-in and SMS verification, signed-webhook enforcement, queue plumbing, and a real call with stored recording/transcript metadata and provider-accepted email. Actual inbox delivery and manual playback remain separate checks; do not infer them from a successful send timestamp.

Repeat those checks for your own deployment. Passing the local test suite or a no-op queue job does not establish a real phone-to-email result.

## Demo sign-in and onboarding

For a Gmail-wide demo, set `ALLOWED_EMAIL_DOMAINS=gmail.com`; leave `ALLOWED_EMAILS` empty unless specific additional addresses should be admitted. Domain matching is exact. The Google OAuth consent configuration must also allow those users: a project in Testing mode can still restrict access to its test-user list.

After Google sign-in, users confirm their first and last name, prefilled from Google when available, then enter their mobile number and the SMS code sent by Twilio Verify. Saved Bat Phone names take precedence over Google suggestions. Missing names stay editable, and suggestions alone do not complete onboarding. Onboarding has two numbered steps: confirm the name and verify the phone, then add the first contact. Verification goes directly to the contact form; the home screen appears only after the contact saves. A completion timestamp records the finished onboarding, so deleting all contacts later does not restart it. Dashboard and call access require completed onboarding; contact creation requires the verified profile so it can finish step 2. Existing verified users supply names without repeating verification. Incoming calls use the verified number to find the account and greet the caller with the entered first name, not the email address or Google display-name parsing.

### Error 1102 during sign-in or onboarding

Confirm **Workers Paid** is active and the deployed configuration has `limits.cpu_ms=1000`. The Free plan's 10 ms CPU limit caused real authenticated pages to fail even while public health checks passed. A rejected CPU setting with API error `100328` identified the original account as Free.

After changing the plan, redeploy and test authenticated onboarding. If failures continue, inspect the invocation's outcome and CPU/memory data. A successful `/api/ready` or unauthenticated `/login` response is insufficient evidence for sign-in readiness; an email allowlist change cannot fix resource exhaustion.

### SMS arrived but the form reports verification unavailable

SMS delivery and receiving a successful provider response are separate outcomes. A failed or timed-out request does not prove no code was sent. Verification now uses native `fetch` in both Node and Workers, with a ten-second deadline and numeric-only provider diagnostics.

Refresh the setup page, enter the same phone number, and select **I already have a code** to proceed without sending another SMS. This only opens code entry: Twilio must still approve the code before the app saves a verified number. If the code has expired, use **Send again** to request another.
