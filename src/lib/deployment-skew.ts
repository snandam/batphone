import { useEffect, useRef } from "react";

/**
 * Deployment skew recovery.
 *
 * After a deploy, browsers still holding the previous bundle throw
 * "Failed to find Server Action" or "Could not find the module". An error
 * boundary's reset() re-renders the same stale tree, so "Try again" can never
 * work; the user has to know to hard-refresh. This detects those errors,
 * auto-reloads at most MAX_AUTO_RELOADS times per minute (tracked in
 * sessionStorage), and otherwise tells the user to refresh.
 */

export interface BoundaryError extends Error {
  digest?: string;
}

interface ReloadState {
  count: number;
  timestamp: number;
}

export const MAX_AUTO_RELOADS = 2;

const RELOAD_STORAGE_KEY = "app-skew-reload";
const RELOAD_WINDOW_MS = 60_000;
const SKEW_MESSAGE_PATTERNS = [
  "failed to find server action",
  "could not find the module",
  "couldn't find the module",
];

export function isServerActionSkewError(error: BoundaryError): boolean {
  const message = error.message?.toLowerCase() ?? "";

  return SKEW_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern));
}

export function useDeploymentSkewReload(
  error: BoundaryError,
  logError: (error: BoundaryError) => void
): boolean {
  const hasAttemptedReload = useRef(false);
  const isSkew = isServerActionSkewError(error);

  useEffect(() => {
    logError(error);

    if (!isSkew || hasAttemptedReload.current) {
      return;
    }

    hasAttemptedReload.current = true;
    attemptDeploymentSkewReload();
  }, [error, isSkew, logError]);

  return isSkew;
}

export function attemptDeploymentSkewReload({
  storage = globalThis.sessionStorage,
  reload = () => window.location.reload(),
}: {
  storage?: Storage | null | undefined;
  reload?: () => void;
} = {}): "reloaded" | "manual_refresh" {
  const reloadCount = getDeploymentSkewReloadCount(storage);

  if (reloadCount === null) {
    console.warn(
      "Deployment skew detected but sessionStorage is unavailable; showing manual refresh UI"
    );
    return "manual_refresh";
  }

  if (reloadCount >= MAX_AUTO_RELOADS) {
    console.warn(
      `Deployment skew detected but max auto-reloads (${MAX_AUTO_RELOADS}) reached; showing error UI`
    );
    return "manual_refresh";
  }

  const nextCount = incrementDeploymentSkewReloadCount(storage);
  if (nextCount === null) {
    console.warn(
      "Deployment skew detected but reload tracking could not be persisted; showing manual refresh UI"
    );
    return "manual_refresh";
  }

  console.info(
    `Detected deployment skew, reloading (attempt ${nextCount}/${MAX_AUTO_RELOADS})`
  );
  reload();
  return "reloaded";
}

function readReloadState(storage: Storage): ReloadState {
  try {
    const stored = storage.getItem(RELOAD_STORAGE_KEY);
    if (!stored) return { count: 0, timestamp: 0 };

    const parsed = JSON.parse(stored) as Partial<ReloadState>;
    if (
      typeof parsed.count !== "number" ||
      typeof parsed.timestamp !== "number"
    ) {
      return { count: 0, timestamp: 0 };
    }

    if (Date.now() - parsed.timestamp > RELOAD_WINDOW_MS) {
      return { count: 0, timestamp: 0 };
    }

    return { count: parsed.count, timestamp: parsed.timestamp };
  } catch {
    return { count: 0, timestamp: 0 };
  }
}

export function getDeploymentSkewReloadCount(
  storage: Storage | null | undefined = globalThis.sessionStorage
): number | null {
  if (!storage) return null;

  try {
    return readReloadState(storage).count;
  } catch {
    return null;
  }
}

export function incrementDeploymentSkewReloadCount(
  storage: Storage | null | undefined = globalThis.sessionStorage
): number | null {
  if (!storage) return null;

  try {
    const nextCount = readReloadState(storage).count + 1;
    storage.setItem(
      RELOAD_STORAGE_KEY,
      JSON.stringify({ count: nextCount, timestamp: Date.now() })
    );
    return nextCount;
  } catch {
    return null;
  }
}
