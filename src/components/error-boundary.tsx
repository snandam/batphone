"use client";

import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import { useDeploymentSkewReload } from "@/lib/deployment-skew";

interface ErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export function ErrorBoundary({ error, reset }: ErrorBoundaryProps) {
  // Log error to your error reporting service
  const logError = useCallback(
    (err: Error) => console.error("Error:", err),
    []
  );
  const isSkew = useDeploymentSkewReload(error, logError);

  return (
    <div className="flex min-h-100 items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        <h1 className="text-xl font-semibold sm:text-2xl">
          {isSkew
            ? "A new version is ready, so refresh to continue."
            : "Something went wrong."}
        </h1>
        {process.env.NODE_ENV === "development" && (
          <pre className="bg-muted w-full overflow-auto rounded-md p-3 text-left text-xs sm:p-4 sm:text-sm">
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
    </div>
  );
}
