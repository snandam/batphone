import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";

// Force dynamic rendering - auth requires runtime environment variables
export const dynamic = "force-dynamic";

export const { POST, GET } = toNextJsHandler(auth);
