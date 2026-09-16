"use client";

import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import { useDeploymentSkewReload } from "@/lib/deployment-skew";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Log error to console in structured format (client-side)
  const logError = useCallback(
    (err: Error & { digest?: string }) =>
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          event: "global_error_boundary",
          service:
            process.env.NEXT_PUBLIC_APP_NAME?.toLowerCase().replace(
              /\s+/g,
              "-"
            ) || "app",
          environment: process.env.NODE_ENV || "development",
          error_message: err.message,
          error_digest: err.digest,
          error_stack: err.stack,
        })
      ),
    []
  );
  const isSkew = useDeploymentSkewReload(error, logError);

  return (
    <html lang="en">
      <body className="bg-background text-foreground flex min-h-screen items-center justify-center p-4">
        <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
          <h1 className="text-xl font-semibold sm:text-2xl">
            {isSkew
              ? "A new version is ready, so refresh to continue."
              : "Something went wrong."}
          </h1>
          {process.env.NODE_ENV === "development" && (
            <pre className="bg-muted w-full overflow-auto rounded-md p-4 text-left text-sm">
              {error.message}
            </pre>
          )}
          {isSkew ? (
            <Button
              className="cursor-pointer"
              onClick={() => window.location.reload()}
            >
              Refresh
            </Button>
          ) : (
            <Button className="cursor-pointer" onClick={reset}>
              Try again
            </Button>
          )}
        </div>
      </body>
    </html>
  );
}
