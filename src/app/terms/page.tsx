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
  title: "Terms of service",
  description: `The rules for using ${APP_NAME}.`,
};

const LAST_UPDATED = "September 16, 2026";

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      summary={`By signing in to ${APP_NAME} you agree to these terms. They are short because the service is simple: you call people through it, and it records and transcribes those calls.`}
      updated={LAST_UPDATED}
    >
      <LegalSection title="The service">
        <p>
          {APP_NAME} lets you dial one shared phone number from your verified
          mobile, choose one of your saved contacts by voice or keypad, and be
          connected to them. The conversation is recorded from the moment they
          or their voicemail answer, transcribed after the call, and emailed to
          you. Your call history and recordings are available in the app.
        </p>
      </LegalSection>

      <LegalSection title="Who can use it">
        <p>
          Sign-in is limited to Google accounts we have approved. You must be at
          least 18 years old and use your own mobile number. A verified number
          can belong to only one account.
        </p>
      </LegalSection>

      <LegalSection title="Recording consent is your responsibility">
        <p>
          Every call placed through {APP_NAME} is recorded. Laws on recording
          phone calls differ by country and by state, and some require the
          consent of everyone on the call. Before you use the service you must
          confirm that recording is lawful where you and the person you are
          calling are located, and you must give any notice and obtain any
          consent that the law requires. You are solely responsible for
          complying with those laws.
        </p>
      </LegalSection>

      <LegalSection title="What you may not do">
        <LegalList
          items={[
            "Call emergency services. The shared number cannot reach 911, 112, 999, or any other emergency number. Use your phone's normal dialler.",
            "Use the service to harass, threaten, deceive, or spam anyone, or to make unsolicited marketing calls.",
            "Record a call where doing so is unlawful or where you lack the required consent.",
            "Save contacts or place calls on behalf of someone who has not authorised you to do so.",
            "Attempt to access another user's contacts, calls, recordings, or transcripts, or to interfere with the service or its providers.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Your data">
        <p>
          Your contacts, recordings, and transcripts belong to you. You give us
          permission to store and process them, and to pass them to the
          providers named in our{" "}
          <Link className="underline" href="/privacy">
            privacy policy
          </Link>
          , only as needed to run the service. You can ask us to delete them at
          any time.
        </p>
      </LegalSection>

      <LegalSection title="Availability and changes">
        <p>
          The service is provided as is. Calls depend on our telephony,
          transcription, hosting, and email providers, and any of them can fail.
          A call may not connect, a recording may be missing or incomplete, and
          a transcript may contain errors or be delayed. Do not rely on{" "}
          {APP_NAME} for anything where a missed or misheard call would cause
          harm. We may change, suspend, or shut down the service, or remove your
          access, at any time.
        </p>
      </LegalSection>

      <LegalSection title="Fees">
        <p>
          We do not charge you for using the service at this time. Your mobile
          carrier may charge you for the call to the shared number.
        </p>
      </LegalSection>

      <LegalSection title="Liability">
        <p>
          To the fullest extent the law allows, we are not liable for any loss
          or damage arising from your use of the service, from a call that did
          not connect or was not recorded, from errors in a transcript, or from
          your failure to comply with recording laws. Nothing in these terms
          limits liability that cannot be limited by law.
        </p>
      </LegalSection>

      <LegalSection title="Changes and contact">
        <p>
          If these terms change we will update the date at the top of this page.
          Continuing to use the service after a change means you accept the new
          terms. Questions go to <SupportContact email={SUPPORT_EMAIL} />.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
