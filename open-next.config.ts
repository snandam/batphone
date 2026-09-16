import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Authenticated pages and call state are dynamic. No remote ISR cache is needed.
export default defineCloudflareConfig();
