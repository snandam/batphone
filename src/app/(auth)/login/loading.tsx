import { Logo } from "@/components/ui/logo";
import { APP_NAME } from "@/constants";

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`bg-muted animate-pulse rounded ${className ?? ""}`} />
  );
}

/**
 * The login page awaits searchParams and the session, so it streams. Without
 * a route-level fallback the navbar renders first and the form pops in.
 */
export default function LoginLoading() {
  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center sm:gap-8">
        <Logo showText={false} size="lg" />
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {APP_NAME}
          </h1>
          <p className="text-muted-foreground text-base sm:text-lg">
            Sign in with your work Google account.
          </p>
        </div>
        <Skeleton className="h-10 w-full sm:w-56" />
      </div>
    </div>
  );
}
