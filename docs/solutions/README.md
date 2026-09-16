# Solutions

Write-ups of problems that took real investigation, filed by category so the next person finds them by symptom.
One problem per file: `docs/solutions/<category>/<YYYY-MM-DD>-<slug>.md`.

## Investigated issues

- [Google sign-in ends with a state error](integration-issues/2026-09-14-oauth-state-error-recovery.md)

- [Authenticated pages exceed the Cloudflare Worker resource limit](integration-issues/2026-09-16-workers-resource-limit.md)

Use a category describing the affected area; add one when none fits.

## Template

```markdown
---
module: <area of the code, e.g. auth, db, middleware>
tags: [<keyword>, <keyword>]
problem_type: <bug | outage | performance | security>
symptoms:
  - <what a person saw, in their words>
root_cause: <one sentence>
resolution_type: <code | config | docs | process>
severity: <low | medium | high>
---

# <Title as the symptom, not the fix>

## Symptom

What was observed, where, and how often.

## Investigation

What was checked, what ruled things out, what settled it.

## Root cause

## Fix

What changed, with file paths.

## Guardrail

The test, check, or rule that stops it recurring.
```
