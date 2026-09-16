# Setup and operations

For an always-available hosted installation, use [Deploy to Cloudflare with Supabase](DEPLOYMENT.md). This guide covers Codespaces and local Node.js development; both run the complete phone-to-email workflow. Cloudflare and Supabase accounts are not required for those development environments.

This guide starts from an unconfigured copy of Bat Phone. Creating a Codespace provides the app runtime and PostgreSQL; it does **not** supply Google, Twilio, or Deepgram accounts, API keys, a phone number, or an email domain.

**First action:** open the [Google Cloud Console](https://console.cloud.google.com/) and create a project and Web application OAuth client using [the Google steps below](#google-oauth). Then complete the other [provider setup steps](#credential-setup), save every required value in [Codespaces secrets](#codespaces-secrets), and only then [create the Codespace](#quick-start-in-github-codespaces). The tables below are your checklist while obtaining those values.

You will need:

- A GitHub account that can create Codespaces for this repository or your fork.
- A Google account and permission to create/edit a Google Cloud OAuth client.
- A Twilio account with Voice, Verify SMS, and Twilio Email access, plus a Voice-capable Twilio number.
- A Deepgram account/project with speech-to-text access and available credit or billing.
- An email-sending domain whose DNS records you can edit (or a domain owner who can authenticate it for you).
- Your mobile phone to receive SMS and call from, and a second number you can answer as the contact.

Existing users may reuse provider resources they control. Everyone must make the corresponding credentials available to their own Codespace; forks do not inherit the upstream repository's secrets. Provider usage and GitHub Codespaces may incur charges under your accounts.

## Codespaces secrets

These values become **environment variables** when the Codespace starts. You do not paste keys into application source code, and cloning the repository does not populate them.

### Save the values before creating a Codespace

1. On GitHub, open **your repository → Settings → Secrets and variables → Codespaces → New repository secret**. Choose **Codespaces**, not Actions.
2. For each required row below, use the exact **Name** and paste your actual value into **Secret**, then save it. Do not include `NAME=`, quotes, or example placeholders.
3. If you cannot manage repository secrets, use **your GitHub profile → Settings → Codespaces → Secrets → New secret**, and select this repository under **Repository access** for each secret. These personal secrets are for Codespaces you create. See [GitHub's personal-secret instructions](https://docs.github.com/en/codespaces/managing-your-codespaces/managing-your-account-specific-secrets-for-github-codespaces).
4. Check that every required name is present before continuing. Repository secret access depends on your permissions; if relying on shared values, have the repository owner confirm access. See [repository secret access](https://docs.github.com/en/codespaces/managing-codespaces-for-your-organization/managing-development-environment-secrets-for-your-repository-or-organization).

If you add or change a secret after creating a Codespace, **stop and reopen that Codespace** to load the change. Restart the app afterward. No full rebuild or database reset is needed.

### Required for the complete phone-to-email workflow

| Exact secret name                             | Where the value comes from                                                                                                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                          | Run `openssl rand -base64 32` in a terminal on your computer and save the generated value. This is the app's session-signing secret, not a Google key.                                         |
| `GOOGLE_CLIENT_ID`                            | Client ID from your Google Cloud **Web application** OAuth client; see [Google OAuth](#google-oauth).                                                                                          |
| `GOOGLE_CLIENT_SECRET`                        | Client secret from that same OAuth client.                                                                                                                                                     |
| `ALLOWED_EMAILS` (or `ALLOWED_EMAIL_DOMAINS`) | Your Google account's email address; separate additional permitted addresses with commas. You may use `ALLOWED_EMAIL_DOMAINS` instead for an exact domain allowlist; at least one must be set. |
| `TWILIO_ACCOUNT_SID`                          | Account SID (`AC…`) on the Twilio Console account dashboard.                                                                                                                                   |
| `TWILIO_AUTH_TOKEN`                           | Auth Token from that same Twilio account; the app uses it to validate webhook signatures.                                                                                                      |
| `TWILIO_API_KEY_SID`                          | SID (`SK…`) of a **Standard API key** created in that Twilio account.                                                                                                                          |
| `TWILIO_API_KEY_SECRET`                       | Secret shown when you create that Standard API key; save it at creation. This is different from the Auth Token.                                                                                |
| `TWILIO_PHONE_NUMBER`                         | Your Twilio Voice-capable phone number in E.164 format, for example `+15551234567`; not your personal mobile number.                                                                           |
| `NEXT_PUBLIC_BAT_PHONE_NUMBER`                | Exactly the same number as `TWILIO_PHONE_NUMBER`; this is the number displayed in the app.                                                                                                     |
| `TWILIO_VERIFY_SERVICE_SID`                   | Service SID (`VA…`) from the SMS Verify service you create in Twilio. Follow [Twilio](#twilio) before launching the Codespace.                                                                 |
| `DEEPGRAM_API_KEY`                            | Project API key with speech-to-text access created in the [Deepgram Console](https://console.deepgram.com/).                                                                                   |
| `EMAIL_FROM`                                  | Sender address on your authenticated Twilio Email domain, such as `batphone@your-domain.com`; see [Twilio Email](#twilio-email).                                                               |

### Optional settings

You can leave these unset on the first run.

| Secret                      | Purpose                                                                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Optional. Contact address shown on the public `/privacy` and `/terms` pages, which the Google OAuth consent screen links to. Leave empty to show generic wording. |
| `ALLOWED_EMAIL_DOMAINS`     | Alternative/addition to `ALLOWED_EMAILS`; exact domains such as `your-company.com`, not subdomains or wildcards.                                                  |
| `GH_TOKEN`                  | Optional. Lets the attach hook set port 3000 public automatically; without it, set **Port Visibility → Public** by hand in the Ports panel.                       |
| `TWILIO_FALLBACK_TWIML_URL` | Your own TwiML URL for when the app cannot be reached. Leave empty to use Twilio's free hosted Echo Twimlet with an unavailable message.                          |
| `TWILIO_VOICE`              | Prompt voice; default `Polly.Joanna-Neural`.                                                                                                                      |
| `TWILIO_SPEECH_MODEL`       | Speech recognition model; default `deepgram_nova-3`.                                                                                                              |
| `DEFAULT_PHONE_REGION`      | Region for phone numbers entered without a country code; default `CA`.                                                                                            |
| `EMAIL_FROM_NAME`           | Email sender display name; default `Bat Phone`.                                                                                                                   |
| `EMAIL_DRY_RUN`             | Set to `true` to log emails instead of sending them while the sender domain is not verified yet. Leave unset for the full end-to-end test.                        |
| `SEED_EMAIL`                | Owner of optional seeded sample data. Do not seed during a fresh first-run test.                                                                                  |

### Automatically configured - do not add as Codespaces secrets

| Variables                                                   | Supplied by                                                                                                 |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`, `DATABASE_SSL`                              | The devcontainer's PostgreSQL service configuration. No external database account is needed for Codespaces. |
| `PUBLIC_BASE_URL`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL` | `scripts/codespace-env.sh`, using the Codespace name and forwarded-port domain after creation.              |

Do not copy a local `.env.local` or the localhost values in `.env.example` into Codespaces. They would conflict with this environment's database and public URL. [`.env.example`](../.env.example) remains the complete reference for local development and advanced settings.

## Credential setup

Complete these steps **before creating the Codespace**, using the required table above to save each value. Provider accounts and API keys are created in their respective consoles; the repository does not create them.

### Google OAuth

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select a project and configure its OAuth consent settings with the app name, support/contact email, and basic `openid`, `email`, and `profile` access.
2. Create an OAuth client with application type **Web application**. The detailed [Google client instructions](GOOGLE_AUTH.md#create-the-oauth-client) cover the console screens and test users.
3. You do not know the Codespace hostname yet. Create the client now; if configuring local development, use origin `http://localhost:3000` and redirect URI `http://localhost:3000/api/auth/callback/google`. Add the Codespace's HTTPS URLs after creation in the quick start below.
4. Save the client ID and secret as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Codespaces secrets. Also set `ALLOWED_EMAILS` to the Google email you will use. If Google consent is in Testing mode, add that account under the OAuth test users too.
5. Generate `BETTER_AUTH_SECRET` with `openssl rand -base64 32` and save it as a separate Codespaces secret.

You must be able to edit this OAuth client later to add the Codespace URL. Access to GitHub secrets does not grant Google Cloud project access.

### Twilio

1. Create a [Twilio account](https://www.twilio.com/try-twilio) and open its Console. Ensure the account supports the countries/numbers you will call and SMS verification. Trial accounts have restrictions; check [Voice trial limits](https://www.twilio.com/docs/usage/trials/try-out-voice) and [Verify prerequisites](https://www.twilio.com/docs/verify/api/verification). A trial announcement is not an app-generated prompt; use an account without that restriction for the clean demo.
2. Under **Phone Numbers**, obtain a number with **Voice** capability. Save it in E.164 format as both `TWILIO_PHONE_NUMBER` and `NEXT_PUBLIC_BAT_PHONE_NUMBER`.
3. From the account dashboard, save the Account SID and Auth Token as `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`.
4. Under **Account → API keys and tokens**, create a **Standard API key** for that same account. Save its SID and secret as `TWILIO_API_KEY_SID` and `TWILIO_API_KEY_SECRET`. The app uses this pair for Twilio REST calls, including Email; it uses the Auth Token separately for webhook validation.
5. Under **Verify → Services**, create a service named Bat Phone with SMS enabled. Save its Service SID as `TWILIO_VERIFY_SERVICE_SID`. This service sends the app's phone-verification codes; it is separate from your Voice number. See [Twilio Verify](https://www.twilio.com/docs/verify/api).
6. Under **Voice → Settings → Geo permissions**, enable the destination countries needed for your test and restrict the others.

Only one environment should own the Voice number's callbacks at a time. Starting this Codespace can repoint them from another environment. `npm run twilio:configure` sets the URLs after the Codespace URL exists; you do not need to configure callback URLs by hand now.

**Advanced alternative:** if `TWILIO_VERIFY_SERVICE_SID` is omitted, `npm run twilio:configure` can create a Verify service and print its SID. Save the returned SID as a Codespaces secret and stop/reopen the Codespace before testing SMS. Creating the service explicitly beforehand avoids this extra restart. The configure script does not create a Twilio account, API key, or Voice number.

Answering-machine detection is enabled on outbound calls. Machine results are displayed as "Automated answer", which can include voicemail, phone menus, and automated agents. Its classification is best effort, and its provider usage is billed separately from voice minutes.

### Deepgram

1. Create an account at the [Deepgram Console](https://console.deepgram.com/) and select a project with available credit or billing.
2. Create a project API key with speech-to-text permissions. Follow [Deepgram's API-key instructions](https://developers.deepgram.com/guides/fundamentals/authenticating) for the current role choices.
3. Save the key as `DEEPGRAM_API_KEY` in Codespaces secrets. It is used for transcribing the completed recordings.

An existing project's remaining credit is shared by your environments; creating another Codespace does not grant new provider credit.

### Twilio Email

This app uses **Twilio Email** through the Twilio API key configured above, rather than a separate SMTP username/password.

1. In the same Twilio account, open **Email → Domains** and create an authenticated domain that you control.
2. Add the DNS records Twilio provides through your domain's DNS host, or ask the domain owner to do this. Wait for the domain's status to become **Verified**. See [Twilio's domain-authentication steps](https://www.twilio.com/docs/email/security/domains).
3. Choose a sender address on that domain and save it as `EMAIL_FROM`, for example `batphone@your-domain.com`. Your personal Gmail address is not a substitute for an authenticated sending domain.
4. Leave `EMAIL_DRY_RUN` unset for the real email test. While waiting on DNS you can set it to `true` to inspect rendered emails, but logged output is not evidence of delivered email. In production, dry-run is honored only when the value is `force`.

The templates request disabled click tracking on the call-page link. Verify the actual delivered link during the manual test; account-level provider behavior is not enforced by this application.

### Sign-in allowlist

`ALLOWED_EMAILS` and `ALLOWED_EMAIL_DOMAINS` are comma-separated and case-insensitive. A domain admits exactly that domain, so `example.com` does not admit `mail.example.com`. Set at least one; empty lists reject new registrations. Removing an address later blocks that account's next sign-in; a session already issued lasts until it expires.

### Usage and billing

Provider usage includes incoming and outgoing voice, recording/storage, answering-machine detection, SMS verification, transcription, and email. Charges and trial allowances depend on country, account, and usage. Consult [Twilio Voice](https://www.twilio.com/en-us/voice/pricing), [Twilio Verify](https://www.twilio.com/en-us/verify/pricing), [Twilio Email](https://www.twilio.com/en-us/email/pricing), and [Deepgram](https://deepgram.com/pricing) before testing. Existing resources can be reused when their account permissions and balance support the test.

## Quick start in GitHub Codespaces

Proceed only after completing [credential setup](#credential-setup) and saving every [required Codespaces secret](#codespaces-secrets). This sequence assumes you are starting with an empty app database.

1. On your repository's `main` branch, select **Code → Codespaces → Create codespace on main**. If asked whether you trust the repository, review it and choose **Trust Folder & Continue** to enable its workspace tasks.
2. Wait for the setup hooks: PostgreSQL starts, dependencies install, migrations apply, and Twilio callbacks are configured when credentials are valid. Fix reported failures before continuing. A warning about setting port visibility can be resolved manually at step 6.
3. In its terminal, obtain the public URL:

   ```bash
   source scripts/codespace-env.sh
   printf '%s\n' "$PUBLIC_BASE_URL"
   ```

   Expected: `https://<codespace>-3000.app.github.dev` (or the forwarding domain supplied by GitHub). This URL is public configuration, not a credential.

4. Open the **Google Web application client you created earlier**. Add the exact URL from step 3 under **Authorized JavaScript origins**, and that URL plus `/api/auth/callback/google` under **Authorized redirect URIs**. Save without removing existing entries. See [redirect URI details](GOOGLE_AUTH.md#redirect-uris). Adding URLs to that client does not change its ID or secret.
5. Start the app and keep this terminal open:

   ```bash
   npm run dev
   ```

   Look for `public_base_url_resolved` with this Codespace's URL and `startup_env_verified`. If `startup_env_missing` lists names, return to [Save the values before creating a Codespace](#save-the-values-before-creating-a-codespace), correct those secrets, then stop/reopen the Codespace and start the app again. Never paste secret values into logs or bug reports.

6. In the **Ports** panel, set port **3000 → Port Visibility → Public** if it is not already public. The app listens on HTTP inside the Codespace; use GitHub's forwarded HTTPS URL from your phone and for callbacks. If the optional attach helper stalls, press Ctrl+C and do this step manually.
7. In a second terminal, verify the app and database, then configure Twilio if the start hook reported an error:

   ```bash
   curl --fail --silent --show-error http://localhost:3000/api/ready
   ```

   Expect JSON with `"status":"ready"` and `"database":"connected"`. For a Twilio configuration failure, correct the credentials as in step 5, then run `npm run twilio:configure`; its printed callback URLs must use this Codespace's origin.

8. Open the HTTPS URL on your phone, sign in, complete step 1 by confirming your first and last name and verifying your mobile number by SMS, then complete step 2 by adding your first contact. The home screen opens after both steps finish. Follow [Make the first real call](MANUAL_E2E.md#make-the-first-real-call) to verify recording, transcription, and actual inbox delivery.

For a full reviewer rehearsal, [the first-run checklist](MANUAL_E2E.md#create-a-fresh-codespace) adds public readiness, failure recovery, and stop/reopen persistence checks. Keep this Codespace running during calls and processing.

## Codespaces details

### Lifecycle hooks

- `postCreateCommand` (`.devcontainer/post-create.sh`) installs the Postgres client, waits for Postgres with `pg_isready`, runs `npm ci` and `npm run db:migrate`, and adds `scripts/codespace-env.sh` to the shell profile so every terminal derives the public URL.
- `postStartCommand` (`.devcontainer/post-start.sh`) runs `npm run db:migrate` again, then `npm run twilio:configure` when `TWILIO_API_KEY_SID` is set.
  A failure prints a warning and never blocks the start.
- `postAttachCommand` (`.devcontainer/set-port-public.sh`) runs `gh codespace ports visibility 3000:public -c "$CODESPACE_NAME"` with `GH_TOKEN`.

### Public URL and port visibility

Inside a codespace the public URL is derived as `https://<codespace>-3000.<forwarding domain>`, normally `https://<codespace>-3000.app.github.dev`.
`scripts/codespace-env.sh` exports it as `PUBLIC_BASE_URL`, `BETTER_AUTH_URL`, and `NEXT_PUBLIC_APP_URL` when they are unset; the post-create hook sources that script from `.bashrc` and `.zshrc`, so start the app from an interactive terminal.
The server derives `PUBLIC_BASE_URL` on its own and logs it at startup as `public_base_url_resolved`, but `BETTER_AUTH_URL` comes only from the script and falls back to `http://localhost:3000` in a shell that skipped it.
An explicit `PUBLIC_BASE_URL` always wins.
In Codespaces this one value is used for every TwiML callback URL, the webhook signature check, Better Auth, and the Google redirect URI, so a mismatch breaks calls and logins at once.

The attach hook limits the GitHub CLI command to 20 seconds, with a five-second forced-stop grace period. If it cannot set the port public, it prints a warning and lets setup continue. On an older checkout, if it stays at “Waiting for codespace to become ready,” press Ctrl+C; start the app and use the manual fallback below.
Manual fallback: open the Ports panel, right-click port 3000 (Bat Phone), Port Visibility, Public.
Twilio cannot reach a private port; it gets a GitHub login page instead of the app.

### The configure script

```bash
npm run twilio:configure
```

The start hook runs this automatically when the Twilio secrets are present.
Run it by hand after changing secrets or in a new codespace.
It authenticates with the API key, finds the incoming number matching `TWILIO_PHONE_NUMBER`, sets the voice URL to `/api/twilio/voice` (POST) and the status callback to `/api/twilio/call-status` (POST) under the public URL, sets the voice fallback URL to `TWILIO_FALLBACK_TWIML_URL` when present and otherwise to Twilio's hosted Echo Twimlet serving the unavailable message, creates a Verify service named "Bat Phone" when `TWILIO_VERIFY_SERVICE_SID` is unset, and prints every value it set.

### Environment checks

Two checks confirm the architecture works from a codespace.

**Check one: an external POST reaches the app and is rejected by signature validation, not by a GitHub login page.**
From a machine outside the codespace:

```bash
curl -i -X POST https://<codespace>-3000.app.github.dev/api/twilio/voice -d From=%2B15005550006
```

Expected: `403` from the Twilio signature check.
A `302` to `github.com/login` means the port is still private.

**Check two: custom TwiML plays with no trial announcement on either leg.**
With the number pointed at the app, dial the bat phone number from a verified phone.
Expected: "Hi <your first name>. Who would you like to call?" plays immediately, with no Twilio trial message before it.
A Twilio trial announcement is a reason to check account status in Console.

Record live results in [MANUAL_E2E.md](MANUAL_E2E.md); its run log is not a claim of completed verification.

## Environment reference

[`.env.example`](../.env.example) is the complete variable reference, including optional speech, database, branding, and dry-run settings. The server logs `startup_env_missing` with missing required names. Never commit a populated env file.

## Running outside Codespaces

Twilio must be able to reach the app over HTTPS, so outside Codespaces set `PUBLIC_BASE_URL` to a tunnel or deployed URL and run `npm run twilio:configure` after every change.
Web pages and the database work on plain localhost.
Keep `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` at `http://localhost:3000` and open the app on that origin; only `PUBLIC_BASE_URL` points at the tunnel, so the two values intentionally differ outside Codespaces.

```bash
npm ci
cp .env.example .env.local   # fill in the values
npm run db:migrate
npm run db:seed              # optional demo history
npm run dev
```

Always use port 3000; the OAuth redirect URIs are registered for it.

The root `docker-compose.yml` runs Postgres, a one-shot migrations container, and the production build of the app:

```bash
cp .env.example .env         # uncomment the Docker section
docker compose up --build
docker compose down          # stop; preserve the database
```

## Scripts

| Script                                                        | Description                                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm run dev`                                                 | Start the dev server on port 3000                                                                      |
| `npm run build`, `npm run start`                              | Production build and server                                                                            |
| `npm run lint`, `npm run lint:fix`                            | ESLint                                                                                                 |
| `npm run type-check`                                          | TypeScript                                                                                             |
| `npm run test`                                                | Vitest unit and contract tests                                                                         |
| `npm run db:generate`                                         | Generate a migration after a schema change (commit it)                                                 |
| `npm run db:migrate`                                          | Apply committed migrations                                                                             |
| `npm run db:seed`                                             | Seed one demo user with contacts, calls, and resolution attempts                                       |
| `npm run db:reset`                                            | Drop the `public` and `drizzle` schemas, migrate, and seed (local databases only)                      |
| `npm run cf:build`, `npm run cf:preview`, `npm run cf:deploy` | Build, locally preview, or deploy the OpenNext Worker; follow [deployment setup](DEPLOYMENT.md) first. |
| `npm run db:studio`                                           | Browse data in Drizzle Studio                                                                          |
| `npm run twilio:configure`                                    | Point the Twilio number at the public URL and ensure a Verify service exists                           |
| `npm run resolution:report`                                   | Print every name-resolution attempt across all calls                                                   |
| `npm run email:test -- you@example.com`                       | Send one sample transcript email through the configured mailer                                         |

### Reset the database

Docker is not available inside the dev container, so reset with:

```bash
npm run db:reset
```

It drops the `public` and `drizzle` schemas, applies the committed migrations, and seeds the demo data.
It refuses to run when `NODE_ENV=production` or when the database host is not `localhost`, `127.0.0.1`, or `postgres` unless `DB_RESET_FORCE=1` is set.
Never run `npm run db:push` against a shared database; it writes no migration journal.

## Tuning the matcher

Speech recognition and fuzzy matching will be wrong sometimes.
Every name-resolution attempt is stored with what Twilio heard, its confidence, the matcher's candidates and scores, the decision, and what the caller did next, and the call page lists them under "How the bat phone understood you".
The loop for improving the matcher on real data:

1. After a batch of real calls, run the report:

   ```bash
   npm run resolution:report
   npm run resolution:report -- --since 2026-09-01
   ```

   Each row shows the date, input kind, heard text, confidence, the top three candidates with scores, the decision, and the caller's response.
   A `none` or `ambiguous` decision followed by a retry, or a `match` followed by `retried`, is a miss or a false match.

2. Copy each miss into the speech sample table in `src/lib/batphone/matcher.test.ts` with the contact list it was matched against and the outcome it should have had.
3. Adjust the thresholds (`MATCH_THRESHOLD`, `MATCH_MARGIN`, `AMBIGUOUS_THRESHOLD` in `src/lib/batphone/matcher.ts`) or add entries to the nickname map in `src/lib/batphone/nicknames.ts` until the table passes.
4. Keep the real cases in the table permanently so a later change cannot regress them.

A recognition miss on an unusual name, such as "Sanjeev" transcribed as a different name, is a speech model problem before it is a matcher problem: the matcher never sees the right sounds.
Switch `TWILIO_SPEECH_MODEL` to `googlev2_telephony_short` or `experimental_utterances`, make the same calls again, and compare the heard text and confidence in the resolution report before touching thresholds.
Tell callers to keep the phone off speaker, because the prompt can leak back into the microphone and arrive as speech ("So, would you like? Call sanjiv.").

## Deployment beyond Codespaces

[The deployment guide](DEPLOYMENT.md) provides the complete Cloudflare setup: Workers Paid runs Next.js through OpenNext, Supabase supplies PostgreSQL, Hyperdrive manages database connections, and Cloudflare Queues runs post-call jobs. It covers separate deployment credentials, verified database TLS, migrations, resource bindings, application secrets, Google OAuth, and Twilio cutover. CI checks the application; it does not automatically deploy it.

Codespaces uses its own PostgreSQL container and process-local `after()` jobs. Its users, contacts, and calls are separate from Supabase unless you deliberately migrate data. Stopping Codespaces does not stop the hosted Worker; it does stop calls and processing whose callbacks still target that Codespace.

Use separate Twilio numbers for simultaneous environments. The Codespaces start hook can repoint a shared number away from the hosted deployment. Before each real call, verify which origin owns that number's callbacks.

A persistent Node.js container is also supported by the Dockerfile and Compose setup. For that route, use a stable HTTPS origin, authenticated remote PostgreSQL with verified TLS, runtime secrets, build-time public settings, and a separate migration step before rollout. It retains process-local scheduling and must stay running through recording, transcription, and email. See [architecture limitations](ARCHITECTURE.md#limitations-of-the-proof-of-concept).
