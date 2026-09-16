function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`bg-muted animate-pulse rounded ${className ?? ""}`} />
  );
}

export default function SetupLoading() {
  return (
    <div className="container mx-auto max-w-screen-2xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-8 sm:space-y-12">
        <div role="status" aria-label="Loading setup">
          <Skeleton className="h-10 w-3/4" />
        </div>
        <div
          className="bg-card space-y-6 rounded-xl border p-4 sm:p-6"
          aria-hidden="true"
        >
          <Skeleton className="h-6 w-3/4" />
          <div className="space-y-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-11 w-full max-w-xs" />
          </div>
          <Skeleton className="h-11 w-28" />
        </div>
      </div>
    </div>
  );
}
