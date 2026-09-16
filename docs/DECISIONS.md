# Why Bat Phone is built this way

Bat Phone starts with a narrow product promise: call one number, name a saved contact, have an ordinary phone conversation, and receive its recording and transcript afterwards.
The important engineering choices follow from keeping that promise understandable and recoverable in a small proof of concept.
This document explains the reasoning behind those choices and how the implementation changed during review.

The [original implementation plan](plans/2026-09-11-001-feat-bat-phone-plan.md) preserves the requirements, alternatives, dependencies, acceptance examples, and proposed work units.
That historical snapshot also contains amendments and superseded assumptions; it is a planning record, not proof that every proposed check ran or every guarantee was achieved.
The [architecture overview](ARCHITECTURE.md) describes the current system, [setup](SETUP.md) explains how to run it, and the [manual end-to-end checklist](MANUAL_E2E.md) covers live verification separately.

## Start with the interaction, then choose the infrastructure

The product combines Google sign-in, a configured caller number, personal contacts, voice or keypad selection, automatic recording, call history, and emailed transcripts with metadata.
Transcripts arrive after the call, and GitHub Codespaces provides a reproducible development environment.
Those requirements leave considerable freedom over the implementation, but they do not require a browser softphone, a native mobile app, an open-ended voice assistant, or live transcription.

The browser therefore handles preparation and follow-up: verify a number, manage contacts, read transcripts, and play recordings.
The conversation itself happens through the ordinary telephone network.
The recipient needs neither an account nor the website.
Keeping that boundary clear avoids turning a small internal calling tool into a second communications client.

The working criteria were:

- Preserve the required user journey, including a usable fallback when speech recognition fails.
- Keep setup and operation manageable in a single Codespace.
- Spend implementation effort on webhook order, ownership, and recovery rather than unnecessary services.
- Make decisions observable and testable without placing a billed call for every test.
- Distinguish a successful local check from evidence that external providers and a real phone worked together.

These are integration and product criteria, not a benchmark claiming one vendor is universally faster, cheaper, or more accurate.

## Plan the risky dependencies before the screens

The original plan grouped work into foundation, web setup, telephony, post-call processing and UI, then documentation and hardening.
It placed the public webhook URL and Twilio account checks early because an unreachable Codespaces endpoint would invalidate the calling workflow regardless of how polished the screens were.
Schema and state rules came before webhook orchestration; verified phone setup and contacts came before caller identification and resolution.

The plan also described acceptance examples for unknown callers, ambiguous names, repeated confirmation callbacks, recordings arriving before dial callbacks, failed transcription, and authenticated playback.
That made failure behavior part of the design rather than a collection of exceptions added after a happy-path demo.
The examples explain what needed proving; their presence in a document does not establish that the manual checks passed.

## One application, with development and hosted runtimes

The choice was to keep React pages, authenticated server actions, Twilio route handlers, and post-call orchestration in one Next.js application.

A separate Python or Node service was a plausible alternative, but this workflow did not need a distinct runtime.
It would have added another process, configuration boundary, and deployment target before offering a concrete benefit to this workflow.
An offline-first PWA was also unnecessary for a workflow whose calls and transcripts depend on the server and external providers.

Codespaces retains one Node process, so stopping it interrupts webhook handling and can interrupt post-call processing. The hosted deployment now runs the same Next.js application through OpenNext on Cloudflare Workers, with durable queue processing described below.
A caller who dials while the application is down would otherwise hear Twilio's generic "application error", so the configure script installs a voice fallback URL served by Twilio's free hosted Echo Twimlet that says Bat Phone is unavailable.
Twimlets are a Twilio Labs service without a formal support commitment, which is why `TWILIO_FALLBACK_TWIML_URL` can replace it with a TwiML Bin or any other static TwiML URL.
Domain modules remain separate from the route handlers so they can be tested independently and invoked from either runtime.
See [the pipeline](../src/lib/batphone/pipeline.ts), [background scheduling](../src/lib/batphone/after.ts), and [Codespaces setup](SETUP.md).

## Cloudflare for a stable demo, Supabase for managed PostgreSQL

Codespaces remains the reproducible development and testing route. It is not the always-available demo: stopping that environment removes its webhook endpoint. Cloudflare supplies a stable custom domain without depending on a developer's terminal.

OpenNext adapts the Next.js application to Workers. This introduces a build adapter, Worker bindings, and runtime compatibility work rather than making the Node deployment portable without changes. Authenticated pages exceeded the initial free-tier CPU budget in live testing; the deployed configuration uses Workers Paid and an explicit 1,000 ms CPU limit. This is an observed deployment constraint, not a throughput benchmark or a latency promise.

Supabase supplies managed PostgreSQL while Better Auth continues to handle Google sign-in and sessions. Keeping the same relational schema and Drizzle migrations avoids replacing the application with Supabase Auth or its HTTP Data API. Supabase API keys are not database credentials: migrations and Hyperdrive connect using PostgreSQL credentials.

Hyperdrive pools connections to Supabase with origin certificate verification; query caching is disabled for current session and call-state reads. The application creates database clients within the current Worker request, including queue invocations, and closes them after streamed responses finish. This avoids reusing a socket owned by a different request. It adds a connectivity dependency and configuration surface, but keeps connection setup appropriate to an ephemeral runtime. Hyperdrive is optional infrastructure, not a second database. Supabase also offers connection pooling; this deployment deliberately connects Hyperdrive to the direct PostgreSQL endpoint instead of stacking two poolers. Codespaces uses its Node connection pool directly.

See [deployment and credentials](DEPLOYMENT.md), [the Worker entry point](../worker.ts), and [database lifetime management](../src/db/primary.ts). Codespaces continues to run its own PostgreSQL container; it needs neither Supabase nor Cloudflare credentials.

## Twilio Gather and a deterministic contact matcher

The voice task is a constrained selection: find one entry in the caller's saved contacts.
The implementation uses Twilio Gather to collect speech or keypad input, supplies contact-name hints, and resolves the returned text locally.
The [matcher](../src/lib/batphone/matcher.ts) combines normalization, spelling similarity, phonetic comparison, and nickname equivalence.
It returns a match, an ambiguous result, or no match.

Streaming audio to a separate recognition service or introducing an LLM into this selection step would add a live service boundary and more failure behavior.
Those alternatives could become useful for open-ended instructions, but that is beyond the current interaction.
The deterministic choice makes a particular input and contact list reproducible in a test; it does not make speech recognition infallible.
There is no recorded head-to-head accuracy or latency experiment establishing that this approach outperforms an LLM.

Confirmation before dialing reduces the consequence of a mistaken match.
Ambiguity prompts and speed-dial codes give callers another route when names are hard to distinguish.
Resolution attempts preserve recognized text, candidates, decisions, and caller responses so real misses can become regression cases.
See [matcher tests](../src/lib/batphone/matcher.test.ts) and the [resolution report](../scripts/resolution-report.ts).

## Batch transcription with recording channels

The transcript is needed after the conversation, so the app waits for a completed recording instead of maintaining a live transcription stream.
Twilio is instructed to record from answer in dual-channel mode.
The implemented [Deepgram adapter](../src/lib/batphone/transcription.ts) submits audio to Nova-3 with multichannel processing when two channels are available, then stores timestamped utterances in a reduced transcript shape.

This fits the desired transcript: caller and contact labels can follow the recording channels rather than requiring the app to infer identity from generic speaker labels.
The implementation also handles single-channel or apparently mixed results without pretending the speakers are reliably separated.
That fallback is important: the useful outcome is an honest transcript, not a confident but unsupported label.

Whisper/OpenAI transcription, AssemblyAI, and Twilio transcription services were candidates in the planning comparison.
Deepgram was selected for the fit between the chosen recording format and the implemented adapter.
The repository does not contain comparative recordings, error-rate measurements, or equivalent implementations for those alternatives.
It therefore does not establish that they cannot handle this use case or that Deepgram is the cheapest choice.

Audio is fetched by the server using Twilio credentials and submitted as audio bytes.
Playback goes through an authenticated app route, and email links to the call page.
That keeps provider credentials out of links given to the browser or recipient.
See [media retrieval](../src/lib/batphone/twilio-media.ts), [transcription tests](../src/lib/batphone/transcription.test.ts), and [the recording route](../src/app/api/calls/[id]/recording.mp3/route.ts).

## Twilio Email through a small provider interface

The planning comparison considered SendGrid, Postmark, and Amazon SES alongside Twilio Email.
The implementation uses Twilio Email with the existing Twilio account credentials and a configured sender domain.
That reduced provider setup for a project already depending on Twilio for calling and number verification.

This was an account and integration decision, not a measured deliverability advantage.
The [mailer interface](../src/lib/batphone/mailer.ts) separates message composition and pipeline state from the specific HTTP send operation.
Switching to another provider would still require implementing its adapter, configuring credentials and sender authentication, and checking delivery; it is not automatically validated by having an interface.

The app records an accepted send response as sent.
It does not track subsequent delivery, spam placement, or bounces.
Opening the actual message in the recipient's inbox belongs in the manual verification log.
No historical pricing or introductory-credit claim is needed to explain this choice; operating requirements and billing guidance belong in [setup](SETUP.md).

## PostgreSQL stores the coordination as well as the data

Users, verified numbers, contacts, calls, resolution attempts, and webhook events must survive application restarts.
PostgreSQL supports the constraints and conditional updates used to coordinate the workflow.
Drizzle provides the application schema and committed migrations.

In-memory state would disappear when the process stops; a simple file store would require additional coordination to handle concurrent callbacks safely.
SQLite was another database option; PostgreSQL fits the concurrent webhook processing and transactional updates used here. The devcontainer runs it alongside the app, so Codespaces setup needs no separate hosted database account.

Unique constraints protect per-user contact names and speed dials, verified-number ownership, and call identifiers.
Conditional updates claim work from an expected status; completion writes check a claim token so a superseded worker cannot overwrite the newer result.
Contact names and numbers are snapshotted on calls so later contact edits do not rewrite call history.
See [schemas](../src/db/schema/), [repository operations](../src/lib/batphone/calls-repo.ts), and [database setup](DB_SETUP.md).

## Post-response processing, with explicit recovery

Recording retrieval, transcription, and email can take longer than a webhook response should.
The Node/Codespaces path persists the recording reference and uses Next.js `after()` to continue processing after responding.
This avoided introducing a queue and worker into the initial Codespaces setup.

`after()` is process-local scheduling, not a durable job queue.
A process exit can interrupt work, and the database cannot atomically commit an external email send with its own status update.
Claims and sent timestamps reduce repeated work in ordinary callback handling, but they are not an exactly-once email guarantee.
In particular, a stale email claim can represent a message already sent before the app recorded success; retry requires acknowledging the duplicate risk.
Cloudflare deployment added atomic lease-expiry checks to stale claim takeover and guarded metadata-email claims, preventing concurrent workers from taking the same active work. The external-send/database-write gap still prevents exactly-once delivery guarantees.

Recovery review found two gaps in the original approach: a saved transcript could be stranded before email began, and a recording still processing could be treated as absent.
The current implementation allows email retry from `transcribed`, preserves pending recordings during resync, and reopens a previously absent call when a completed recording arrives.
Replayed completed callbacks can resume interrupted scheduling, while late absent callbacks cannot overwrite an already stored recording.
These behaviors are covered by [pipeline tests](../src/lib/batphone/pipeline.test.ts), [repository tests](../src/lib/batphone/calls-repo.test.ts), and [recording callback tests](../src/app/api/twilio/recording/route.test.ts).

Retry and Resync remain user-triggered recovery tools. The Cloudflare path now awaits durable queue acceptance and resumes interrupted jobs from persisted state, while Node/Codespaces retains process-local scheduling. There is no transactional outbox or general scheduled recovery sweep.
Cloudflare Queues supplies persistent job scheduling for the hosted path. Uncertain email sends remain subject to manual review, and exhausted deliveries are retained in a failed-job queue.
The queue consumer invokes the same persisted-state dispatcher through the Worker handler. Queue messages carry versioned job types and call identifiers, not transcripts or credentials. Active leases delay redelivery; uncertain email sends are acknowledged for manual review rather than automatically resent. Known provider failures remain visible for explicit retry. This provides durable dispatch, not automatic recovery from every failure or an exactly-once external send.

## Product review changed the presentation and contact choices

Onboarding is now a server-gated sequence: confirm editable Google-prefilled names and verify a mobile number, then save the first contact, then enter home. A persisted completion timestamp survives later contact deletion, and unfinished accounts resume their current setup step. Names used in voice greetings come from the confirmed profile, not an inference from the email address.

The initial home screen emphasized the Bat Phone number and a short description of the flow.
Review shifted the interface toward the user's next useful action: complete setup, add a contact, call Bat Phone, or inspect a recent conversation.
Call history now uses compact entries emphasizing identity, time, duration, outcome, and transcript access.
Detailed resolution and provider information belongs inside call detail, where it helps explain a specific problem.
See [history](../src/app/calls/page.tsx), [history entries](../src/app/calls/call-list-item.tsx), and [call detail](../src/app/calls/[id]/call-detail.tsx).

Speed-dial allocation also evolved.
An earlier proposal used a forward-only counter so deleted codes would never be reused.
The current behavior assigns the lowest free code, permits a user-selected available code, and releases a code when its contact is deleted.
The form offers a bounded set of available suggestions and a custom entry; server validation and a database uniqueness constraint enforce availability.
This favors practical code selection while retaining an explicit uniqueness rule.
See [allocation](../src/lib/batphone/speed-dial.ts), [contact actions](../src/actions/contacts/index.ts), and [the form](../src/app/contacts/contact-form.tsx).

Call lifecycle and post-call processing are also separated in presentation: a terminal inbound callback persists the hang-up time so the UI can stop saying the call is in progress while the recording and transcript are still processing. The Verify adapter uses native fetch with a ten-second timeout across Node and Workers; provider errors become recoverable form feedback.

These changes are responses to product review, not evidence of a measured usability study.
Answering-machine detection is another extension recorded in the amended plan. A later real call to an automated agent exposed an overstatement: machine detection plus caller speech had been labeled as a voicemail message. The current presentation says "Automated answer" and "Automated system"; neither the AMD verdict nor caller speech establishes the type of automation or that a message was left.

## What the evidence does and does not establish

Source and automated tests show how the implemented boundaries behave for exercised inputs: ownership checks, matching, state transitions, callback replay, recovery, and presentation.
They do not prove a current Twilio account configuration, Google redirect URI, sender domain, or phone network path works in a fresh Codespace.
Hosted live testing has confirmed Google sign-in and SMS phone verification. A real call persisted its recording reference and transcript, with an email send accepted by the provider. Actual inbox receipt and a manual recording-playback check are separate evidence and are not established by those records. The fresh Codespaces end-to-end rehearsal remains pending. The [manual end-to-end checklist](MANUAL_E2E.md) lists the remaining checks.

The remaining proof-of-concept boundaries are deliberate but consequential: caller ID is trusted after setup verification, recordings remain with Twilio, transcripts and numbers lack application-level encryption, and email acceptance is not inbox delivery.
Codespaces must remain running for calls and process-local work. The hosted demo depends on Workers, Supabase, Hyperdrive, Queues, and the external providers; durable dispatch does not remove capacity, retention, or uncertain-delivery limits.
The [architecture limitations](ARCHITECTURE.md#limitations-of-the-proof-of-concept) and [live verification procedure](MANUAL_E2E.md) are the places to assess those limits before extending the deployment.
