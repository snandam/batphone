# End-to-end verification

Choose the environment before starting:

- **Try the hosted demo:** open [batphone.sanjeevnandam.com](https://batphone.sanjeevnandam.com) with a Gmail account, a phone that can receive SMS, and a contact you can call. Skip Codespaces preparation and begin at [Make the first real call](#make-the-first-real-call). The operator has already configured Google, Twilio, Deepgram, Cloudflare, and Supabase.
- **Reproduce the setup in a fresh Codespace:** complete preparation below, then test the same user journey plus stop/reopen persistence. You supply your own provider credentials; Cloudflare and Supabase are not required.

The hosted app uses a Cloudflare Queue for post-call jobs and Supabase PostgreSQL through Hyperdrive. Codespaces uses Node’s process-local `after()` scheduling and its own PostgreSQL container. Successful tests in one environment do not prove the other. Reserve a separate Twilio number when testing both simultaneously: a number’s webhooks can target only one environment.

The steps below are a procedure; completing them is the evidence, and a step that was skipped or failed is recorded as such. The detailed credential reference is in [SETUP.md](SETUP.md#codespaces-secrets).

## Prepare before creating the codespace

**This is a blocking prerequisite: configure your accounts and secrets first.** A new reader or fork does not receive the maintainer's credentials. Creating a Codespace installs the app and database, but does not create provider accounts, keys, an OAuth client, a Voice number, or an authenticated sending domain.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create your project and Web application OAuth client using [Credential setup](SETUP.md#credential-setup). Continue through that section to configure Twilio Voice/Verify/Email, a Deepgram project key, and your sending domain's DNS. You need permission to edit the Google client again after the Codespace URL exists.
2. Save the required values using the exact names and sources in the [Codespaces secrets table](SETUP.md#codespaces-secrets), before creating the environment:

   | Area                       | Required secret names                                                                                                                        |
   | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
   | Sign-in                    | `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAILS` (or `ALLOWED_EMAIL_DOMAINS`)                              |
   | Calls and SMS              | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_PHONE_NUMBER`, `TWILIO_VERIFY_SERVICE_SID` |
   | Displayed calling number   | `NEXT_PUBLIC_BAT_PHONE_NUMBER`, identical to `TWILIO_PHONE_NUMBER`                                                                           |
   | Transcription and delivery | `DEEPGRAM_API_KEY`, `EMAIL_FROM`                                                                                                             |

   Save these under **repository Settings → Secrets and variables → Codespaces**, not Actions. If you cannot manage repository secrets, use **your GitHub Settings → Codespaces → Secrets**, granting this repository access to each personal secret. These become environment variables; do not edit source code to insert them. Database settings and public URLs are automatic and must not be added as secrets.

3. Set `ALLOWED_EMAILS` to the Google account you will sign in with. If Google consent is in Testing mode, add that same account to Google's OAuth test users. Leave `EMAIL_DRY_RUN` unset; an authenticated sender and real inbox delivery are required for this test.
4. Have your mobile phone to receive SMS and call from, plus a second number you can answer or send to voicemail as the contact. Use test conversations.
5. Use the `main` branch of [the repository](https://github.com/snandam/batphone) or your configured fork. Reserve the selected Twilio number for this environment: the start hook repoints its callbacks, so another environment using that number will stop receiving them.

If you already have working provider resources, you can reuse them after confirming that your Codespace has the secrets and you can edit the OAuth client. This is a shortcut for existing users, not a prerequisite assumed by this guide.

## Create a fresh codespace

1. On the repository's `main` branch, choose **Code → Codespaces → Create codespace on main** (or the **+** button). Create a new codespace for this first-run rehearsal, rather than reopening an existing one.
2. If VS Code asks **“Do you trust the authors of the files in this folder?”**, choose **Trust Folder & Continue** for this Bat Phone repository. This enables terminal commands in the workspace. Wait for the setup hooks to finish. They install dependencies, start PostgreSQL, and apply migrations. Check their output for errors or manual steps. If a dependency or migration step fails, fix that issue before continuing; do not reset the database as a generic workaround.
   If the optional port-public helper stays at **“Waiting for codespace to become ready”**, press **Ctrl+C** in that terminal and continue. You can start the app normally and set port 3000 public in the Ports panel at step 6. Current versions of the helper time out after 20 seconds and print this manual fallback.

3. Open a terminal in the repository and print the derived public URL:

   ```bash
   source scripts/codespace-env.sh
   printf '%s\n' "$PUBLIC_BASE_URL"
   ```

   Expected: an HTTPS URL such as `https://<codespace>-3000.app.github.dev`. A localhost URL or an old tunnel address is incorrect. Do not copy your local machine's `.env.local` into the codespace; database settings and public URLs come from the devcontainer, and provider credentials come from Codespaces secrets.

4. Open the **Web application OAuth client created during preparation**, in its Google Cloud project.
   - Add the exact HTTPS URL printed in step 3 under **Authorized JavaScript origins**.
   - Under **Authorized redirect URIs**, add the same URL followed by `/api/auth/callback/google`. Keep existing entries and click **Save**. See [Google redirect URI details](GOOGLE_AUTH.md#redirect-uris).
   - Adding these URLs does not change the client ID or secret. If you cannot edit the client, its owner must do this before sign-in can work. If you discover missing or incorrect secrets, return to [preparation step 2](#prepare-before-creating-the-codespace), correct them, then stop and reopen the Codespace.
5. In the codespace terminal, start the app:

   ```bash
   npm run dev
   ```

   Keep this terminal running. Expected: the app serves port 3000, `public_base_url_resolved` names this codespace, and `startup_env_verified` appears. If `startup_env_missing` names required settings, return to [preparation step 2](#prepare-before-creating-the-codespace) and the [required secrets table](SETUP.md#codespaces-secrets), save/correct those values, and stop/reopen the Codespace before running the app again. Do not print their values.

6. In the **Ports** panel, set port **3000 → Port Visibility → Public** if the attach hook has not already done so. Keep the app listening over HTTP on port 3000; use GitHub's HTTPS forwarded URL in the browser.
7. In a second terminal, confirm both the local app and public URL can reach the database:

   ```bash
   source scripts/codespace-env.sh
   curl --fail --silent --show-error http://localhost:3000/api/ready
   curl --fail --silent --show-error "$PUBLIC_BASE_URL/api/ready"
   ```

   Both must return JSON containing `"status":"ready"` and `"database":"connected"`. An HTML login page, redirect, or 503 is not a pass. These checks verify the web app and database, not the provider integrations.

8. Confirm the start hook configured Twilio for this codespace. If it failed, correct the credentials and rerun:

   ```bash
   npm run twilio:configure
   ```

   Expected: the printed webhook URLs use this codespace's origin. The Verify service should already exist from preparation. If you used the advanced auto-create option instead, save the printed SID as `TWILIO_VERIFY_SERVICE_SID`, then stop/reopen the Codespace before testing SMS.

9. Open the same HTTPS URL on your phone. Proceed with the checks below. Do not seed sample data on this first pass: create the user and contacts through the UI so the test proves that fresh setup works.

## Make the first real call

For your own environment, keep the app running with `EMAIL_DRY_RUN` unset so these calls send real emails. Hosted demo users do not need to start a server. Back-end states shown in code formatting below refer to the `call.status` database column; inspect them with `npm run db:studio` if needed. The visible transcript, recording, and inbox email are the main evidence for this test.

1. **Sign in.**
   Open the public URL on the phone you will call from and continue with Google.
   Expected: **Step 1 of 2** opens. Confirm first and last name; Google names prefill when available and remain editable. Then the phone verification form appears.
2. **Verify the phone number.**
   Enter the phone's number, receive the SMS code, enter a wrong code once, then the right one.
   Expected: the wrong code is rejected and the phone remains unverified. The right code opens **Step 2 of 2: Add your first contact**, without flashing the home screen. Refresh and confirm the unfinished contact step is retained.
3. **Complete contact setup.**
   Add the number you will answer as, named "Mike Anderson", using an available speed dial or automatic allocation.
   Expected: saving the first contact opens home with the Bat Phone tap-to-call action. Open Contacts and add a second contact with a clearly different name. Both have distinct speed dials. Suggestions exclude occupied numbers; custom entry rejects occupied codes.
4. **Call the bat phone.**
   Dial the bat phone number from the verified phone.
   Expected: the app's own greeting plays with no Twilio announcement before it, in a natural voice, and it says "Hi <your first name>. Who would you like to call?".
5. **Say the name.**
   Say "Mike Anderson".
   Expected: the app says "Mike Anderson. Press 1 or say yes to call, or 2 to try again."
6. **Confirm.**
   Say "yes" (or press 1).
   Expected: the app says "Connecting you now."
   Expected: the contact phone rings and shows the bat phone number as the caller.
   The `call` row is in `dialing`.
7. **Talk and hang up.**
   Answer on the contact phone, exchange a few sentences with both parties speaking, then hang up from either side.
   Expected: the call ends. If the caller remains connected after the contact hangs up, the caller hears "Bye for now." History should stop presenting an ongoing call once its hang-up timestamp arrives, even while recording/transcription processing continues.
8. **Wait for the transcript and email.**
   Open `/calls`; processing calls update automatically. Open the call to see progress and use Refresh if updates have paused.
   Expected: processing progresses through `awaiting_recording`, `transcribing`, `transcribed`, and `emailing`, then settles on `emailed`. Some states may complete between refreshes. Record the elapsed time; the app has no fixed delivery-time guarantee.
   On the row, `transcript_email_sent_at` is set and `metadata_email_sent_at` is null.
9. **Open the email.**
   Open the transcript email in the demo account's inbox.
   Expected: the header shows the caller, "Mike Anderson", the dialled number, the start time in the phone's timezone, and the duration; the transcript labels lines "You" and "Mike Anderson"; the link opens the call page.
10. **Play the recording on the phone.**
    On the call page at `/calls/<id>`, press play and seek within the recording.
    Expected: playback works in the phone's browser and seeking works; the metadata header on the page matches the email.

## Check phone ownership across accounts

After a first account has verified a phone, sign in with a second allowed Google account and try that same number. Expected: the second account cannot attach it; the original owner retains their contacts and caller identity. Use another phone to complete the second account’s onboarding. Neither account should see the other’s contacts, calls, transcript, or recording when opening a copied call URL. Do not reset another user’s records to make this test pass.

## Exercise failure recovery

Run these after the first real call succeeds, in a dedicated test Codespace. Do not replace credentials or inject failures in the shared hosted demo. These steps exercise the Node path; Cloudflare queue retry/dead-letter behavior needs a separate isolated hosted test with the deployment’s queue configuration. Automated mocked queue tests verify scheduling contracts, not live provider delivery.

11. **Force a transcription failure in this process only.**
    Stop the app with Ctrl+C, then start it with a temporary invalid key:

    ```bash
    DEEPGRAM_API_KEY=invalid npm run dev
    ```

    Make another call to Mike Anderson with a few sentences of talk. Do not change the shared repository secret; this override lasts only for this server process.
    Expected: the row ends in `transcription_failed` with the Deepgram error in `last_error`.

12. **Confirm one metadata-only email.**
    Check the inbox.
    Expected: exactly one email for this call, with the metadata header, an explanation that transcription failed, and the call page link, and no transcript.
13. **Retry.**
    Stop the test server with Ctrl+C and run `npm run dev` normally in the same terminal. The temporary override is gone, so the real key from Codespaces secrets is used again. Open the call page and press Retry.
    Expected: the row moves to `transcribing` and settles on `emailed`.
14. **Confirm one transcript email.**
    Check the inbox again.
    Expected: exactly one transcript email for this call, so two emails in total for the call and neither kind twice.
15. **Re-deliver the confirm callback.**
    For the call from step 11, read the ids you need:

    ```sql
    select c.id, c.twilio_call_sid, c.contact_id, a.id as attempt_id
    from call c join resolution_attempt a on a.call_id = c.id
    order by c.inbound_at desc limit 1;
    ```

    Build the confirm URL and sign it with the auth token, then post it:

    ```bash
    URL="$PUBLIC_BASE_URL/api/twilio/confirm?callId=<id>&attempt=1&attemptId=<attempt_id>&contactId=<contact_id>"
    SIG=$(node -e 'const t=require("twilio");console.log(t.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN,process.argv[1],{CallSid:process.argv[2],Digits:"1"}))' "$URL" "<twilio_call_sid>")
    curl -s -X POST "$URL" -H "X-Twilio-Signature: $SIG" -d "CallSid=<twilio_call_sid>" -d "Digits=1"
    ```

    Expected: the response is TwiML that says "Your call is already connecting." with no `<Dial>` element, no phone rings, and the row is unchanged.

16. **Mumble a name.**
    Call the bat phone again and say the contact's name indistinctly, or say a name that is not a contact.
    Expected: the app repeats what it heard, for example "I heard my canderson, and I don't have that contact. Say the name again, or press their speed dial, then pound.", and asks again.
    On the second failure it says "Let's try the keypad. Press their speed dial, then pound."; on the third the call ends with "I still couldn't find that contact".
17. **Check the attempts on the call page.**
    Open the call at `/calls/<id>`.
    Expected: expand Call diagnostics; the "How the bat phone understood you" list shows one line per attempt with the heard text, confidence, best match, and what you did next; a call that ended without a contact shows the "No contact found" outcome in history.
18. **Check the report.**
    Run the report from a codespace terminal:

    ```bash
    npm run resolution:report
    ```

    Expected: the attempts from steps 5, 11, and 16 appear in order with heard text, confidence, top candidates with scores, decision, and caller response.

## Check keypad selection and voicemail

Also call an automated agent or phone menu if available: a machine verdict should use the same neutral automated-answer label, not claim voicemail or an AI-specific classification.

- **Speed dial:** note Mike's assigned code in Contacts. Confirm the add-contact selector hides taken codes. Call Bat Phone, enter Mike's code followed by `#`, and confirm the match. Expected: the correct contact is dialled, and this call has its own history entry.
- **Voicemail:** call the test contact again and let voicemail answer. Leave a short, recognizable message. Expected: the recording includes the greeting and your message, and the transcript appears in the app and email. Recording starts when the destination answers, including voicemail; it does not start during ringing. When answering-machine detection reports a machine, the outcome is "Automated answer" and its transcript speaker is "Automated system". Caller speech must not be presented as proof of a voicemail message. Detection is best effort, so record any classification mismatch separately from whether audio/transcription worked.

## Verify persistence by stopping and reopening

This section tests Codespaces only. The hosted database is Supabase and is independent of Codespace lifecycle or Worker deployments.

1. Wait until processing and email for the test calls have finished.
2. Note a saved contact's name and speed dial, and copy one completed call's page URL. Optionally take a screenshot for your own comparison.
3. At [github.com/codespaces](https://github.com/codespaces), choose **Stop codespace** for this environment. Closing the browser tab alone does not prove a stop/restart.
4. Reopen that **same codespace** from the list. Do not create a new one or choose Full Rebuild.
5. Run `npm run dev` again, confirm port 3000 is Public, and open the original HTTPS URL on your phone. Sign back in with the same Google account if necessary.
6. Expected: your phone is still configured, the saved contacts and speed dials remain, and the same call URL opens its transcript and recording. Record pass/fail below.

The devcontainer stores PostgreSQL data in the named `postgres_data` volume. Users, contacts, call records, and transcripts belong to that codespace's database; audio recordings stay at Twilio.

| Action                                   | Expected database behavior                                           |
| ---------------------------------------- | -------------------------------------------------------------------- |
| Close the browser tab                    | Preserved; the codespace can keep running until stopped or timed out |
| Stop and reopen the same codespace       | Preserved                                                            |
| Create another codespace                 | A separate, initially empty database                                 |
| Delete the codespace                     | Its local database is lost                                           |
| Full Rebuild or remove the Docker volume | Can remove this database; export a backup first                      |
| Run `npm run db:reset`                   | Intentionally drops, migrates, and reseeds the database              |

Do not use reset, volume deletion, or a full rebuild during the persistence check. Git commits back up code, not live database rows. See [Codespaces lifecycle](https://docs.github.com/en/codespaces/about-codespaces/understanding-the-codespace-lifecycle) and [full rebuild behavior](https://docs.github.com/en/codespaces/developing-in-a-codespace/rebuilding-the-container-in-a-codespace).

## Finish the rehearsal

- Confirm the app is running with the real Deepgram key and email dry-run is off.
- Record the outcome of each check with the commit (`git rev-parse --short HEAD`) and environment, including failed or skipped steps.
- Keep this codespace running for the live demo, or stop it to return later. Calls and post-call processing need a running app.
- If returning testing to your local machine or another environment, run `npm run twilio:configure` from that environment with its current public URL. Only one environment should own the number's callbacks at a time.
- Use the verified flow when demonstrating the product. The README overview video explains the experience; it does not replace a live integration check.
