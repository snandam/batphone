---
module: cloudflare-deployment
tags: [cloudflare, cpu, nextjs, onboarding]
problem_type: outage
symptoms:
  - Google sign-in was followed by Error 1102 on an authenticated page.
root_cause: The Workers Free CPU allowance was below the observed CPU time for authenticated Next.js rendering.
resolution_type: config
severity: high
---

# Authenticated pages fail with Worker exceeded resource limits

## Investigation

Public health, readiness, and login-page checks had passed after deployment. A user then reported an unknown error after Google sign-in and a Cloudflare Error 1102 page.

Live traces showed successful authenticated renders using approximately 80–90 ms of CPU. An attempt to set a 1,000 ms limit returned Cloudflare API error `100328`, explicitly identifying the account as Free and refusing a custom CPU setting. Code review found no obvious onboarding redirect loop or cross-request database client reuse.

## Fix

Enable Workers Paid and set `limits.cpu_ms` to `1000` in [wrangler.jsonc](../../../wrangler.jsonc). Immediately after the subscription change, the API still reported Free; after propagation it accepted and returned the saved limit.

A temporary authenticated account then exercised session lookup, the incomplete-profile redirect, and repeated setup renders with prefilled names. Those checks passed without Error 1102, and the temporary account and session were removed. They tested authenticated rendering, not a complete Google OAuth exchange.

## Guardrail

The [deployment guide](../../DEPLOYMENT.md) requires Workers Paid and documents the configured CPU limit. Smoke checks must include an authenticated onboarding page; public readiness alone is insufficient.

Error 1102 can also indicate memory exhaustion. If it recurs, inspect the invocation outcome and resource usage before assuming the same cause. The CPU setting does not change the Worker's memory limit. [Cloudflare Error 1102](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1102/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
