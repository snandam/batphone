import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-100 items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        <h1 className="text-xl font-semibold sm:text-2xl">
          There is nothing at this address.
        </h1>
        <Button asChild variant="outline" className="cursor-pointer">
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </div>
  );
}
