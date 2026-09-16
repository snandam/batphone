"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import type { NavUser } from "@/constants";
import { cn, getInitials } from "@/lib/utils";

// Hydration-safe mounted check (React Compiler friendly)
const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

interface UserAvatarProps {
  user: NavUser;
  className?: string;
  textClassName?: string;
}

export function UserAvatar({
  user,
  className,
  textClassName = "text-xs",
}: UserAvatarProps) {
  const mounted = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );
  // Track which image URL was successfully preloaded
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);

  // Only attempt to load the image on the client — never in server HTML.
  useEffect(() => {
    if (!user.image) return;

    const img = new Image();
    img.src = user.image;
    img.onload = () => setLoadedSrc(user.image);
    // on error: do nothing — initials remain
  }, [user.image]);

  // Derived: only show the image if it matches the current prop AND was
  // preloaded. When user.image becomes null (photo removed, or a different
  // user), this is null without a setState inside the effect, so a removed
  // photo never lingers.
  const imgSrc = user.image && loadedSrc === user.image ? loadedSrc : null;

  // SSR: neutral circle, no text, so the server HTML never shows initials
  // that then flip. Client: initials, or the photo once loaded.
  const showInitials = mounted && !imgSrc;

  return (
    <span
      className={cn(
        "text-primary-foreground relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        mounted ? "bg-primary" : "bg-muted",
        className
      )}
    >
      {showInitials && (
        <span className={cn("font-medium select-none", textClassName)}>
          {getInitials(user.name)}
        </span>
      )}
      {imgSrc && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={imgSrc}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </span>
  );
}
