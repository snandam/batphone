"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import type { ContactSummary } from "@/actions/contacts";
import { ContactForm } from "@/app/contacts/contact-form";

export function FirstContactForm({ contacts }: { contacts: ContactSummary[] }) {
  const router = useRouter();
  const [continuing, setContinuing] = useState(false);
  if (continuing)
    return (
      <p role="status" className="text-sm sm:text-base">
        Opening your Bat Phone…
      </p>
    );
  return (
    <ContactForm
      contacts={contacts}
      showHeading={false}
      submitLabel="Save and finish setup"
      onSaved={() => {
        setContinuing(true);
        router.replace("/");
      }}
    />
  );
}
