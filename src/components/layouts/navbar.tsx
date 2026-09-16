"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { House, Phone, UsersRound } from "lucide-react";

import { SignInButton } from "@/components/auth/sign-in-button";
import { UserMenu } from "@/components/auth/user-menu";
import { ThemeToggle } from "@/components/layouts/theme-toggle";
import { Logo } from "@/components/ui/logo";
import { NAV_LINKS, SESSION_NAV_LINKS } from "@/constants";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

const NAV_ICONS = { "/": House, "/contacts": UsersRound, "/calls": Phone };

/** Keep session reads client-side so the root layout stays static. */
export function Navbar() {
  const pathname = usePathname();
  const { data: session, isPending } = useSession();
  const user = session?.user
    ? {
        name: session.user.name,
        email: session.user.email,
        image: session.user.image ?? null,
      }
    : undefined;
  const links = [...NAV_LINKS, ...SESSION_NAV_LINKS];
  const showNavigation =
    Boolean(user) && pathname !== "/setup" && !pathname.startsWith("/setup/");
  const isActive = (href: string) =>
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      <a
        href="#main-content"
        className="bg-primary text-primary-foreground fixed top-2 left-2 z-[100] -translate-y-20 rounded-lg px-4 py-3 focus:translate-y-0"
      >
        Skip to content
      </a>
      <header className="bg-card/95 sticky top-0 z-50 w-full border-b backdrop-blur-sm">
        <div className="grid h-16 grid-cols-[1fr_auto] items-center gap-4 px-4 sm:h-18 sm:px-6 md:grid-cols-[1fr_auto_1fr] lg:px-8">
          <Link
            href="/"
            aria-label="Bat Phone home"
            className="focus-visible:ring-ring w-fit cursor-pointer rounded-md focus-visible:ring-2 focus-visible:outline-none"
          >
            <Logo />
          </Link>
          <nav
            aria-label="Main navigation"
            className="hidden items-center gap-1 md:flex"
          >
            {showNavigation &&
              links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isActive(link.href) ? "page" : undefined}
                  className={cn(
                    "focus-visible:ring-ring inline-flex min-h-11 cursor-pointer items-center rounded-lg px-5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                    isActive(link.href)
                      ? "bg-accent text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {link.label}
                </Link>
              ))}
          </nav>
          <div className="flex items-center justify-end gap-1 sm:gap-3">
            <ThemeToggle />
            <div className="flex min-h-11 min-w-11 items-center justify-end">
              {isPending ? null : user ? (
                <UserMenu user={user} />
              ) : (
                <SignInButton />
              )}
            </div>
          </div>
        </div>
      </header>
      {showNavigation && (
        <nav
          aria-label="Mobile navigation"
          className="bg-card fixed inset-x-0 bottom-0 z-50 grid grid-cols-3 border-t px-2 pb-[env(safe-area-inset-bottom)] md:hidden"
        >
          {links.map((link) => {
            const Icon = NAV_ICONS[link.href as keyof typeof NAV_ICONS];
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive(link.href) ? "page" : undefined}
                className={cn(
                  "focus-visible:ring-ring my-1 flex min-h-14 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl text-xs font-medium focus-visible:ring-2 focus-visible:outline-none",
                  isActive(link.href)
                    ? "bg-accent text-primary"
                    : "text-muted-foreground hover:bg-muted"
                )}
              >
                <Icon className="size-5" aria-hidden="true" />
                {link.label}
              </Link>
            );
          })}
        </nav>
      )}
    </>
  );
}
