import type { ReactNode } from "react";

interface LegalPageProps {
  title: string;
  summary: string;
  updated: string;
  children: ReactNode;
}

/**
 * Shell for the public legal pages (/privacy, /terms). Google's OAuth
 * consent screen links to these, so they must render without a session and
 * stay readable on a phone.
 */
export function LegalPage({
  title,
  summary,
  updated,
  children,
}: LegalPageProps) {
  return (
    <article className="container mx-auto max-w-screen-2xl px-4 py-10 sm:px-6 sm:py-16 lg:px-8">
      <div className="mx-auto max-w-2xl">
        <header className="mb-10 border-b pb-8">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h1>
          <p className="text-muted-foreground mt-3 text-base leading-relaxed">
            {summary}
          </p>
          <p className="text-muted-foreground mt-3 text-sm">
            Last updated {updated}
          </p>
        </header>
        <div className="space-y-10">{children}</div>
      </div>
    </article>
  );
}

interface LegalSectionProps {
  title: string;
  children: ReactNode;
}

export function LegalSection({ title, children }: LegalSectionProps) {
  return (
    <section className="space-y-3 text-sm leading-relaxed sm:text-base">
      <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

/**
 * Where to send questions and deletion requests. Renders a mailto link when
 * NEXT_PUBLIC_SUPPORT_EMAIL is set; otherwise generic wording so a
 * deployment without one still has a coherent page.
 */
export function SupportContact({ email }: { email: string }) {
  if (!email) {
    return <span>the operator of this deployment</span>;
  }
  return (
    <a className="underline" href={`mailto:${email}`}>
      {email}
    </a>
  );
}
