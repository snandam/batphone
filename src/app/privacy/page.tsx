import type { Metadata } from "next";

import Link from "next/link";

import {
  LegalList,
  LegalPage,
  LegalSection,
  SupportContact,
} from "@/components/layouts/legal-page";
import { APP_NAME, SUPPORT_EMAIL } from "@/constants";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: `How ${APP_NAME} collects, uses, stores, and shares your data.`,
};

const LAST_UPDATED = "September 16, 2026";

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      summary={`${APP_NAME} records the calls you place through it and sends you the transcript. This page explains what that involves for your data.`}
      updated={LAST_UPDATED}
    >
      <LegalSection title="Who we are">
        <p>
          {APP_NAME} is operated by the person or team that runs this deployment
          (&quot;we&quot;). Questions about this policy go to{" "}
          <SupportContact email={SUPPORT_EMAIL} />.
        </p>
      </LegalSection>

      <LegalSection title="What we collect">
        <p>
          <strong>From your Google account.</strong> When you sign in with
          Google we receive your name, email address, profile picture, and
          Google account identifier. We request only the basic sign-in scopes
          (email, profile, and OpenID). We do not access your Gmail, Contacts,
          Calendar, Drive, or any other Google data.
        </p>
        <p>
          <strong>From you, during setup.</strong> Your first and last name, the
          mobile number you verify by SMS, your time zone, and the contacts you
          save: their names, phone numbers, and speed-dial codes.
        </p>
        <p>
          <strong>From your calls.</strong> For each call you place through{" "}
          {APP_NAME} we store the number you called from, the contact you
          selected, the words you spoke or typed while selecting a contact, the
          time, duration, and outcome of the call, an audio recording of the
          conversation, and a transcript of that recording.
        </p>
        <p>
          <strong>Automatically.</strong> Session records including your IP
          address and browser user agent, and a log of the events our telephony
          provider sends us about each call.
        </p>
      </LegalSection>

      <LegalSection title="The people you call">
        <p>
          The person you call does not need an account and never visits this
          site. Their phone number, their voice, and anything their voicemail
          plays are captured in the recording and transcript, which are stored
          in your account. Recording starts when they or their voicemail
          answers. You are responsible for telling them the call is recorded and
          for obtaining any consent the law where you or they are located
          requires. See the{" "}
          <Link className="underline" href="/terms">
            terms of service
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection title="How we use it">
        <LegalList
          items={[
            "To sign you in and show your name and picture in the app.",
            "To recognise you by caller ID when you dial the shared number, and to match what you say to your saved contacts.",
            "To connect and record the call, transcribe the recording, and email you the transcript with a link to the call page.",
            "To show your call history and play back recordings to you.",
            "To keep the service working: detecting repeated callbacks, recovering interrupted processing, and investigating failures.",
          ]}
        />
        <p>
          We do not sell your data, use it for advertising, or use it to train
          machine learning models. Our use of information received from Google
          APIs follows the{" "}
          <a
            className="underline"
            href="https://developers.google.com/terms/api-services-user-data-policy"
            rel="noreferrer"
            target="_blank"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
      </LegalSection>

      <LegalSection title="Who we share it with">
        <p>
          We share data only with the providers that run the service, and only
          the data each one needs.
        </p>
        <LegalList
          items={[
            "Google, for sign-in.",
            "Twilio, which owns the phone number, connects and records your calls, stores the audio recordings, sends the SMS verification code, and delivers the transcript email.",
            "Deepgram, which converts the recording into a transcript and powers speech recognition when you say a contact's name.",
            "Cloudflare, which hosts the application and queues post-call work.",
            "Supabase, which hosts the PostgreSQL database.",
          ]}
        />
        <p>
          We do not share your data with anyone else unless the law requires it.
        </p>
      </LegalSection>

      <LegalSection title="Where it lives and how long">
        <p>
          Your profile, contacts, call history, transcripts, and event log live
          in our database for as long as your account exists. Audio recordings
          are stored by Twilio, and the app only streams them to you after
          checking that the call belongs to your account.
        </p>
        <p>
          You can edit or remove your contacts and your verified phone number in
          the app at any time. To delete your account, your call history, or
          specific recordings, email us and we will remove them from our
          database and from Twilio. Deleting your account does not by itself
          remove the recordings held at Twilio, so please ask for those
          explicitly if you want them gone.
        </p>
      </LegalSection>

      <LegalSection title="Security">
        <p>
          All traffic to the site uses HTTPS. Every callback from our telephony
          provider is signature checked before we act on it. Recordings and
          transcripts are only ever served to the signed-in account that placed
          the call. Sign-in is restricted to an allowlist of accounts and
          domains that we control.
        </p>
      </LegalSection>

      <LegalSection title="Changes and contact">
        <p>
          If this policy changes we will update the date at the top of this
          page. Questions and deletion requests go to{" "}
          <SupportContact email={SUPPORT_EMAIL} />.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
