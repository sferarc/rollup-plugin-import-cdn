# An integrity mismatch fails the build

Recorded 2026-10-16, from #41 and `src/load.ts` `resolveDependency`.

## Decision

When `integrity` has an entry for the requested or final URL and the body does not match, `resolveDependency` throws. It does not record the mismatch as a failed attempt, does not try the next CDN in `priority`, and does not write the cache.

## Why

A mismatch means the content is not what the user pinned, not that the CDN is down (comment above the `verifyIntegrity` call in `src/load.ts`). Falling back would hand the build whatever the next CDN serves, and the next CDN's URL usually has no `integrity` entry of its own, so its body would be bundled unchecked and the build would pass ([[architecture/resolution]]).

## How it could be undone by accident

The `verifyIntegrity` call sits after the fetch `try`/`catch`, not inside it. Moving it into the `try`, for example while tidying the loop, would turn a mismatch into an ordinary failed attempt and fall through to the next CDN. "should throw on a mismatch instead of trying the next CDN" in `src/load.test.ts` fails if that happens.

## What would reopen it

A request for a fail-over mode on mismatch, which would need to be a separate, explicit option rather than a change to this default.
