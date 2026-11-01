# Release is off until the owner enables it

Recorded 2026-10-08, from `.github/workflows/release.yml` and commit 35a4e7a.

## Decision

The `release` job carries `if: vars.RELEASE_ENABLED == 'true'`, so no version pull request opens and nothing publishes until the owner sets that repository variable. When it runs, it authenticates to npm through trusted publishing only, with no stored npm token.

## Why

The first release from this repository is the owner's decision (comment in `release.yml`). Trusted publishing means the only thing that can publish is this workflow on this repository, and there is no long-lived token to leak.

## Consequences

- Changesets merged before the variable is set accumulate and ship together in the first version pull request.
- Sessions and contributors never set `RELEASE_ENABLED`, publish, tag or bump the version by hand.
- The trusted publisher on npmjs.com has to name this repository and `release.yml`, or the publish step fails to authenticate. It does: `0.4.0` published through it with provenance ([[development/release]]).

## What would reopen it

The owner enabling releases, at which point this note records that date. The owner enabled them on 2026-11-01 with a `workflow_dispatch` of `release.yml`, and `0.4.0` published the same day ([[development/release]], "First release"). The gate stays in `release.yml`, so unsetting the variable turns publishing off again.
