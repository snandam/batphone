function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`bg-muted animate-pulse rounded ${className ?? ""}`} />
  );
}

export default function CallLoading() {
  return (
    <div className="container mx-auto max-w-screen-2xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <div
        className="mx-auto max-w-2xl space-y-6 sm:space-y-8"
        aria-hidden="true"
      >
        <Skeleton className="h-11 w-20" />
        <div className="space-y-5 sm:space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-56 sm:h-10" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-5 w-48" />
          </div>

          <div className="bg-card space-y-3 rounded-2xl border p-4 sm:p-6">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-5 w-full" />
          </div>

          <div className="bg-card space-y-4 rounded-2xl border p-4 sm:p-6">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-12 w-full rounded-full" />
          </div>

          <div className="bg-card space-y-4 rounded-2xl border p-4 sm:p-6">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-5/6" />
            <Skeleton className="h-5 w-2/3" />
          </div>

          <div className="bg-card space-y-4 rounded-2xl border p-4 sm:p-6">
            <Skeleton className="h-3 w-16" />
            <div className="divide-border divide-y border-y">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex justify-between py-2.5">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-40" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
