# Release

Releases use changesets (`.changeset/config.json`, `.changeset/README.md`), and publishing is off until the owner turns it on.

## The flow

1. A change that should ship adds a changeset with `pnpm changeset`.
2. On a push to `main`, `.github/workflows/release.yml` runs `changesets/action`, which opens or updates a version pull request that bumps `package.json` and writes `CHANGELOG.md`.
3. Merging that pull request runs the workflow again, which runs `pnpm release` (`pnpm build && changeset publish`).

The action uses the `GIT_TOKEN` secret rather than `github.token`, because a version pull request merged by the Actions bot would push to `main` without triggering the workflow, and nothing would publish (comment in `release.yml`).

## Disabled until the owner enables it

The `release` job only runs when the repository variable `RELEASE_ENABLED` is `true`. Only the owner sets it; until then no version pull request is opened and nothing publishes. See [[decisions/2026-10-08-release-off-until-enabled]].

## Authentication

npm trusted publishing only: the job has `id-token: write`, and npm exchanges the OIDC token for a publish credential, so no npm token is stored (`release.yml`). `package.json` `publishConfig` sets public access and provenance. The trusted publisher on npmjs.com must name this repository and `release.yml`; whether it is configured is unknown from the repository. Trusted publishing needs npm 11.5.1 or newer, which comes from the Node in `mise.toml`.

## History

Before this repository existed the plugin lived in the SferaDev/SferaDev monorepo: `0.3.0` came with its migration there (SferaDev/SferaDev#18) and `0.3.1` with that monorepo's changesets version pull request (SferaDev/SferaDev#660). Versions up to `0.2.3` came from an earlier standalone repository (SferaDev/SferaDev#18 body, `npm view rollup-plugin-import-cdn time`). The tags `rollup-plugin-import-cdn@0.3.0` and `rollup-plugin-import-cdn@0.3.1` came across with the history. On 2026-10-08 npm's latest is `0.3.1` (`npm view rollup-plugin-import-cdn version`), matching `package.json`. The tag format a release from this repository will use is unknown until the first one runs.
