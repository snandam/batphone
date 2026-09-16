function Skeleton({ className }: { className: string }) {
  return <div className={`bg-muted animate-pulse rounded ${className}`} />;
}

export default function CallsLoading() {
  return (
    <div className="container mx-auto max-w-screen-2xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-5 sm:space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <p className="text-primary text-xs font-semibold tracking-widest uppercase">
              Your conversations
            </p>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Calls
            </h1>
            <p className="text-muted-foreground text-sm sm:text-base">
              Find a conversation. Pick up where you left off.
            </p>
          </div>
          <Skeleton className="h-11 w-40" />
        </div>
        <div
          className="flex h-11 items-center justify-between"
          aria-hidden="true"
        >
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div
          className="bg-card divide-y overflow-hidden rounded-2xl border"
          aria-hidden="true"
        >
          {[0, 1, 2, 3, 4].map((row) => (
            <div
              key={row}
              className="grid gap-3 px-4 py-4 sm:grid-cols-[1fr_auto] sm:gap-5 sm:px-6 sm:py-5"
            >
              <div className="space-y-2">
                <Skeleton className="h-6 w-36" />
                <Skeleton className="h-4 w-52" />
              </div>
              <div className="flex justify-between gap-2 sm:flex-col sm:items-end">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-28" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
