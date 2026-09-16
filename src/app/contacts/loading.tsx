function Skeleton({ className }: { className: string }) {
  return <div className={`bg-muted animate-pulse rounded ${className}`} />;
}

export default function ContactsLoading() {
  return (
    <div className="container mx-auto max-w-screen-2xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-6 sm:space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3 sm:space-y-4">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Contacts
            </h1>
            <p className="text-muted-foreground text-base sm:text-lg">
              Call Bat Phone, then say a name or enter its speed dial followed
              by #.
            </p>
          </div>
          <Skeleton className="h-11 w-32" />
        </div>
        <div className="space-y-2" aria-hidden="true">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-5 w-28" />
        </div>
        <div
          className="bg-card hidden rounded-xl border md:block"
          aria-hidden="true"
        >
          <div className="text-muted-foreground grid grid-cols-4 border-b px-3 py-3 text-sm">
            <span>Name</span>
            <span>Phone number</span>
            <span>Speed dial</span>
            <span className="sr-only">Actions</span>
          </div>
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="grid h-16 grid-cols-4 items-center gap-4 border-b px-3 last:border-0"
            >
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-5 w-8" />
              <Skeleton className="h-11 w-24 justify-self-end" />
            </div>
          ))}
        </div>
        <ul className="space-y-4 md:hidden" aria-hidden="true">
          {[0, 1, 2].map((row) => (
            <li key={row} className="bg-card rounded-xl border p-4 sm:p-6">
              <div className="flex justify-between gap-4">
                <div className="space-y-2">
                  <Skeleton className="h-6 w-36" />
                  <Skeleton className="h-5 w-32" />
                </div>
                <Skeleton className="h-14 w-20" />
              </div>
              <div className="mt-3 flex gap-4 border-t pt-2">
                <Skeleton className="h-11 w-12" />
                <Skeleton className="h-11 w-16" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
