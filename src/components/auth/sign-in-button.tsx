"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SignInButton({ className }: { className?: string }) {
  const pathname = usePathname();

  // Preserve current page so user returns here after login
  const loginUrl =
    pathname && pathname !== "/" && pathname !== "/login"
      ? `/login?callbackUrl=${encodeURIComponent(pathname)}`
      : "/login";

  return (
    <Button
      asChild
      size="sm"
      className={cn("min-w-20 cursor-pointer", className)}
    >
      <Link href={loginUrl}>Sign in</Link>
    </Button>
  );
}
