# Google Sign-in

Bat Phone signs users in with Google through [Better Auth](https://www.better-auth.com/).
Google is the only provider.
There is no password, magic link, or username flow.
Sign-in is limited to an operator-configured allowlist of addresses and domains. The [hosted demo](https://batphone.sanjeevnandam.com) allows `gmail.com` accounts; your own deployment chooses its own policy. Supabase hosts PostgreSQL only: Google sign-in is handled by Better Auth, not Supabase Auth.

## Start here

To use the hosted demo, sign in at [batphone.sanjeevnandam.com](https://batphone.sanjeevnandam.com); visitors do not need to create an OAuth client. The configuration below is for operators running their own environment. For a Cloudflare deployment, use the same Web application client setup and the [hosted redirect URIs](#redirect-uris), storing credentials as Worker secrets as described in [DEPLOYMENT.md](DEPLOYMENT.md).

**Before creating your Codespace**, open [Google Cloud Console](https://console.cloud.google.com/) and follow [Create the OAuth client](#create-the-oauth-client) below. You will create the Google project/client first, save its ID and secret in GitHub, then add the Codespace URL once that URL exists. Google configuration is separate from GitHub; the repository does not create an OAuth client or provide its credentials.

Google sign-in is one part of the app setup. After the client steps, finish the [required provider credentials and Codespaces secrets](SETUP.md#codespaces-secrets) before creating your Codespace. You will also need Twilio, Deepgram, and an authenticated email sender for the full phone workflow.

**Existing-client shortcut:** if you control a working Web application client, reuse its ID/secret and add the new [redirect URIs](#redirect-uris). If someone else owns it, they must add those URLs or give you Google Cloud project access. Access to GitHub secrets alone is insufficient.

## How it works

1. The user taps "Continue with Google" on `/login`.
2. Google shows the consent screen and redirects back to `/api/auth/callback/google` with an authorization code.
3. Better Auth exchanges the code for the account's email, name, and picture.
4. Before a user row is written, the `databaseHooks.user.create.before` hook in `src/lib/auth.ts` checks the email against `ALLOWED_EMAILS` and `ALLOWED_EMAIL_DOMAINS`.
5. An allowed account gets a `user` row, a `user_profile` row, and a session cookie.
   A rejected account gets no rows and is sent to `/login?error=account_not_allowed`, which the login page renders as "This Google account is not on the allowlist".
6. Incomplete onboarding goes to `/setup`: **Step 1** confirms first and last name, then verifies the calling number by SMS. Available Google given/family names prefill editable fields; existing saved names take precedence. Names are never inferred from the email address. Google profile suggestions alone do not complete the profile.
7. After successful SMS verification, **Step 2** opens `/setup/contact` to save the first contact and its speed dial. Only then does the home screen open. Refreshes and subsequent sign-ins resume incomplete onboarding; an already completed user can return to the requested page.

The verified calling number belongs to only one Bat Phone account. A second Google account cannot claim it while it is attached to the first. Google authentication identifies the web user; SMS verification establishes the number used to look up that user during incoming calls.

The redirect URI is built from `BETTER_AUTH_URL`, so that value has to match the origin the browser is on.
Inside Codespaces `scripts/codespace-env.sh` sets it from the codespace name when the terminal sources it (see [Redirect URIs](#redirect-uris)).

## Allowlist

`ALLOWED_EMAILS` holds exact addresses and `ALLOWED_EMAIL_DOMAINS` holds apex domains.
Both are comma-separated and case-insensitive.
A domain admits addresses at exactly that domain, so `example.com` does not admit `user@mail.example.com`.
With both empty no new account can register.
There is no "allow all" mode.

The check runs only when a user row is about to be created.
Removing an address from the allowlist blocks that account's next sign-in, because the check also runs before every session is created. A session already issued lasts until it expires; ending it early requires explicit session management.

The pure helper is `src/lib/allowlist.ts`, tested in `src/lib/allowlist.test.ts`.

## Create the OAuth client

Do these steps before creating the Codespace; you do not need its hostname yet.

1. Sign in to [Google Cloud Console](https://console.cloud.google.com/), open the project selector, and create a project for Bat Phone (or choose one you can manage).
2. Open **Google Auth Platform** and complete its initial setup. Enter the app name and support/contact email. For personal Google accounts choose an **External** audience, and add the Google account you will use under **Audience → Test users** while the app is in Testing mode. In consoles using the earlier layout, these settings appear under **APIs & Services → OAuth consent screen**.
3. Configure basic identity access (`openid`, `email`, `profile`) under **Data Access**. Bat Phone does not need Gmail inbox access. See [Google's sign-in configuration guide](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).
4. Under **Clients → Create client**, choose **Web application** and name it Bat Phone. In the earlier layout, use **APIs & Services → Credentials → Create Credentials → OAuth client ID**. Create the client now. For local development you can add these initial values; the Codespace values are added later:

   ```text
   Authorized JavaScript origin: http://localhost:3000
   Authorized redirect URI:      http://localhost:3000/api/auth/callback/google
   ```

5. Save the resulting **Client ID** as `GOOGLE_CLIENT_ID` and **Client secret** as `GOOGLE_CLIENT_SECRET`. On GitHub use **repository Settings → Secrets and variables → Codespaces → New repository secret**. If you cannot manage repository secrets, use your personal **GitHub Settings → Codespaces → Secrets** and grant this repository access. Choose Codespaces secrets, not Actions secrets; save the values, not `NAME=value` text. See [the complete secret checklist](SETUP.md#codespaces-secrets).
6. Generate a separate app session secret with `openssl rand -base64 32` in your computer's terminal and save it as `BETTER_AUTH_SECRET`. Set `ALLOWED_EMAILS` to your Google account address. This app allowlist and Google's test-user list are separate checks; configure both for a test account.
7. Complete the other provider credentials in [Credential setup](SETUP.md#credential-setup), then follow [Create the Codespace](SETUP.md#quick-start-in-github-codespaces). When its public URL is available, return to this client and add the entries below.

## Redirect URIs

Google does not allow wildcards, so every hostname the app runs on is listed explicitly.

**Local development** (port 3000 only; `npm run dev` pins the port and fails instead of moving to 3001 when 3000 is busy):

```text
Authorised JavaScript origin:  http://localhost:3000
Authorised redirect URI:       http://localhost:3000/api/auth/callback/google
```

**Hosted Cloudflare demo:**

```text
Authorised JavaScript origin:  https://batphone.sanjeevnandam.com
Authorised redirect URI:       https://batphone.sanjeevnandam.com/api/auth/callback/google
```

For your own hosted deployment, replace the hostname with your configured custom domain and store credentials as Worker secrets. Keep existing local and Codespaces entries when adding a hosted origin.

**Each codespace** has its own hostname.
Read the name from the `Port 3000 is public` line printed on attach, or from `echo $CODESPACE_NAME`, and add:

```text
Authorised JavaScript origin:  https://<codespace>-3000.app.github.dev
Authorised redirect URI:       https://<codespace>-3000.app.github.dev/api/auth/callback/google
```

Save these values on the same client whose credentials you stored earlier, keeping existing entries. A new Codespace needs its own pair of entries; reusing the same Codespace avoids repeating this. Allow time for Google settings to propagate before retrying sign-in. The redirect URI must match exactly; see [Google OAuth web-server requirements](https://developers.google.com/identity/protocols/oauth2/web-server).

Adding URLs to the existing client does not change its ID or secret. If you do change a Codespaces secret, stop and reopen the Codespace to receive the updated environment; a full rebuild is unnecessary.

`BETTER_AUTH_URL` inside a codespace is derived by `scripts/codespace-env.sh` as `https://<codespace>-3000.app.github.dev`, the same value the server logs at startup as `public_base_url_resolved`.
If the two differ the sign-in fails with `redirect_uri_mismatch`.
The script runs from the shell's rc file, so a dev server started from a shell that skipped it (a task runner or `sh -c`) uses `http://localhost:3000` and Google reports `redirect_uri_mismatch`; restart it from an interactive terminal.

## Environment variables

For Codespaces, save `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BETTER_AUTH_SECRET`, and `ALLOWED_EMAILS` (or `ALLOWED_EMAIL_DOMAINS`) through GitHub as described above. `BETTER_AUTH_URL` is derived automatically from the Codespace; **do not save a localhost value as a Codespaces secret**.

For local development only, place these in the ignored `.env.local` file with your real values:

```bash
GOOGLE_CLIENT_ID=<your-web-client-id>
GOOGLE_CLIENT_SECRET=<your-web-client-secret>
BETTER_AUTH_SECRET=<output-of-openssl-rand-base64-32>
BETTER_AUTH_URL=http://localhost:3000
ALLOWED_EMAILS=<your-google-email>
```

Production refuses a `BETTER_AUTH_SECRET` shorter than 32 characters or a known placeholder. Never commit populated environment files.

## Test it

1. Start the app and open `/login`.
2. Sign in with an allowlisted account.
   Expected: new users confirm their names and verify their phone in Step 1, then add a contact in Step 2 before home opens. Returning users resume their unfinished step or open the requested page after completion.
3. Sign out and sign in with an account that is not on the allowlist.
   Expected: the login page shows the allowlist message and no `user` row exists for that address.

## Troubleshooting

- **redirect_uri_mismatch**: the redirect URI Google received is not in the client's list.
  Compare the URI in the error with the list, including scheme, hostname, port, and the `/api/auth/callback/google` path.
  In Codespaces the hostname changes with every new codespace.
- **This Google account is not on the allowlist**: the address is not in `ALLOWED_EMAILS` and its domain is not in `ALLOWED_EMAIL_DOMAINS`.
  Update the Codespaces secret, stop/reopen the Codespace, and restart the app so the new value loads. For local `.env.local` changes, restart the app. For the hosted app, update the Worker secret and deploy the configuration.
- **Google hasn't verified this app**: the OAuth client is in Testing status and the account is not a test user.
  Check the configured audience, test users, and requested scopes in Google Cloud before retrying.
- **Sign-in works but the session is empty**: the database is unreachable or migrations have not run.
  Run `npm run db:migrate` and check `/api/ready`.

## Files

| File                                 | Purpose                                                              |
| ------------------------------------ | -------------------------------------------------------------------- |
| `src/lib/auth.ts`                    | Better Auth configuration, Google provider, allowlist hook           |
| `src/lib/allowlist.ts`               | Pure allowlist helper                                                |
| `src/lib/auth-client.ts`             | Client-side session hook and sign-in call                            |
| `src/app/api/auth/[...all]/route.ts` | Better Auth route handler                                            |
| `src/app/(auth)/login/page.tsx`      | Login page, renders the allowlist message                            |
| `src/middleware.ts`                  | Cookie-presence redirect hint; pages/actions still validate sessions |

### An expired or mismatched sign-in attempt

OAuth state ties the Google callback to the browser that started sign-in. In the installed Better Auth version, `state_mismatch` can indicate that the signed state cookie was absent or replaced. Starting another sign-in tab can replace that cookie; an old callback can also expire. Do not disable state-cookie validation to work around this.

Open `http://localhost:3000/login` for local development and start a fresh attempt in one browser window. Close older Google sign-in tabs. Use the same host throughout (`localhost` and `127.0.0.1` do not share cookies). Keep `BETTER_AUTH_URL` consistent with the browser origin; the public Twilio tunnel URL is separate and does not need to replace the local OAuth origin.

`onAPIError.errorURL` routes early callback failures to `/login`, even when Better Auth cannot read the per-attempt `errorCallbackURL`. The login page displays safe recovery instructions, and a failed sign-in API response re-enables Continue with Google. An old `/api/auth/error` link also redirects to this recovery screen.

For persistent failures, inspect cookie attributes and server logs without sharing cookie values, OAuth codes, or state tokens. See [Better Auth’s state error reference](https://better-auth.com/docs/reference/errors/state_mismatch).
