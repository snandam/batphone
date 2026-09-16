function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`bg-muted animate-pulse rounded ${className ?? ""}`} />
  );
}

export default function AccountLoading() {
  return (
    <div className="container mx-auto max-w-screen-2xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-8 sm:space-y-12">
        <div className="space-y-3 sm:space-y-4">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
            Account
          </h1>
          <p className="text-muted-foreground text-base sm:text-lg">
            Your Google account and your number.
          </p>
        </div>

        <div className="divide-border divide-y border-y" aria-hidden="true">
          {["w-40", "w-56", "w-36"].map((width) => (
            <div key={width} className="flex justify-between py-2.5">
              <Skeleton className="h-4 w-16" />
              <Skeleton className={`h-4 ${width}`} />
            </div>
          ))}
        </div>

        <Skeleton className="h-5 w-40" aria-hidden="true" />
      </div>
    </div>
  );
}
