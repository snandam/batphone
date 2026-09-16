"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Relative baseURL: the browser always talks to the origin the page was
 * served from. Baking NEXT_PUBLIC_APP_URL in here sent auth requests to
 * whatever origin the build happened to know about (localhost when the
 * build-arg was forgotten, the load balancer hostname when the site moved
 * to a custom domain), so cookies were set for the wrong host.
 */
export const authClient = createAuthClient({
  baseURL: "",
});

export const { signIn, signOut, useSession } = authClient;
