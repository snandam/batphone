"use client";

import { useEffect } from "react";

import { useRouter } from "next/navigation";

import { Loader2 } from "lucide-react";

import { resolvePostLoginDestination } from "@/actions/user/onboarding";
import { isSafePath } from "@/lib/safe-path";

/**
 * OAuth callback landing page.
 * Better Auth redirects here after processing the OAuth callback.
 * This page does a smooth client-side navigation to the final destination
 * via router.replace — avoiding the hard 302 page jump.
 *
 * With an explicit safe `next` the destination is known immediately.
 * Otherwise the server decides: first-time users without a verified phone
 * number go to /setup, everyone else goes home.
 */
export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let fallback: number | undefined;

    const navigate = (destination: string) => {
      if (cancelled) return;
      router.replace(destination);
      // Safety net: the soft navigation intermittently never commits right
      // after OAuth (observed in production about 1 in 10 sign-ins), leaving
      // the user on this spinner although the session is valid. Fall back to
      // a hard navigation. If router.replace commits first, this page
      // unmounts and the cleanup cancels the timer.
      fallback = window.setTimeout(() => {
        window.location.replace(destination);
      }, 2500);
    };

    const next = new URLSearchParams(window.location.search).get("next");
    if (isSafePath(next)) {
      navigate(next);
    } else {
      resolvePostLoginDestination(null).then(navigate, () => navigate("/"));
    }

    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
    };
  }, [router]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        <p className="text-muted-foreground text-sm">Signing you in…</p>
      </div>
    </div>
  );
}
