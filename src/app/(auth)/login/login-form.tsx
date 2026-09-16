"use client";

import { useCallback, useState } from "react";

import { Loader2 } from "lucide-react";

import { GoogleIcon } from "@/components/icons/google";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { APP_NAME } from "@/constants";
import { signIn } from "@/lib/auth-client";

interface LoginFormProps {
  callbackUrl?: string;
  /** Message to show on first render (from the OAuth error redirect). */
  initialError?: string;
}

export function LoginForm({ callbackUrl, initialError }: LoginFormProps) {
  const [socialLoading, setSocialLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError ?? null);

  const handleGoogleSignIn = useCallback(async () => {
    setError(null);
    setSocialLoading("google");
    try {
      // Route through /auth/callback so the final navigation to the
      // destination is a smooth client-side router.replace() instead
      // of a hard server-side 302 redirect (which causes a page jump).
      // Without an explicit callback the landing page asks the server
      // where to go, so first-time users complete their profile and phone verification.
      const oauthCallback = callbackUrl
        ? `/auth/callback?next=${encodeURIComponent(callbackUrl)}`
        : "/auth/callback";
      // On failure (for example an account that is not allowlisted) Better
      // Auth appends `?error=<reason>` to this URL; page.tsx turns it into
      // the message shown above the button.
      const errorCallback = callbackUrl
        ? `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`
        : "/login";

      const result = await signIn.social({
        provider: "google",
        callbackURL: oauthCallback,
        errorCallbackURL: errorCallback,
        disableRedirect: true,
      });
      const url = result.data?.url;
      if (!result.error && url) {
        window.location.href = url;
        return;
      }
      // Better Auth normally returns HTTP/API errors rather than throwing.
      // Always release the button when no redirect will happen.
      setError("Couldn’t start Google sign-in. Please try again.");
      setSocialLoading(null);
    } catch {
      setError("Sign-in did not complete. Try again.");
      setSocialLoading(null);
    }
  }, [callbackUrl]);

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center sm:gap-8">
        <Logo showText={false} size="lg" />
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {APP_NAME}
          </h1>
          <p className="text-muted-foreground text-base sm:text-lg">
            Sign in with your Google account.
          </p>
        </div>

        {error && (
          <p role="alert" className="text-destructive text-sm sm:text-base">
            {error}
          </p>
        )}

        <Button
          size="lg"
          className="w-full cursor-pointer sm:w-auto"
          onClick={handleGoogleSignIn}
          disabled={!!socialLoading}
        >
          {socialLoading === "google" ? (
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          ) : (
            <GoogleIcon className="size-5" />
          )}
          Continue with Google
        </Button>
      </div>
    </div>
  );
}
