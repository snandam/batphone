"use client";

import { useEffect } from "react";

import { useRouter } from "next/navigation";

import { Loader2 } from "lucide-react";

/**
 * Client component that performs a smooth client-side navigation after auth.
 * Used by the login page when a session already exists (e.g., returning from OAuth).
 * Shows an inline spinner while navigating — avoids the hard server-side redirect flicker.
 */
export function AuthRedirect({ to }: { to: string }) {
  const router = useRouter();

  useEffect(() => {
    router.replace(to);
  }, [to, router]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
    </div>
  );
}
