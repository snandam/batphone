import Link from "next/link";

import { APP_NAME } from "@/constants";

export function Footer() {
  return (
    <footer className="text-muted-foreground w-full px-4 pt-5 pb-[calc(6rem+env(safe-area-inset-bottom))] text-xs sm:px-6 sm:pt-6 md:pb-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 sm:pt-5">
        <p>
          {APP_NAME} <span aria-hidden="true">·</span> 2026
        </p>
        <nav aria-label="Legal">
          <ul className="flex items-center gap-4">
            <li>
              <Link className="hover:text-foreground" href="/privacy">
                Privacy
              </Link>
            </li>
            <li>
              <Link className="hover:text-foreground" href="/terms">
                Terms
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
