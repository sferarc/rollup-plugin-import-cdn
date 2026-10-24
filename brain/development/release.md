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

npm trusted publishing only: the job has `id-token: write`, and npm exchanges the OIDC token for a publish credential, so no npm token is stored (`release.yml`). `package.json` `publishConfig` sets public access and provenance. The trusted publisher on npmjs.com must name this repository and `release.yml`; whether it is configured is unknown from the repository, and creating it is an owner step on npmjs.com. Trusted publishing needs npm 11.5.1 or newer, which comes from the Node in `mise.toml`. The workflow is ready on the repository side: `id-token: write`, `publishConfig.provenance`, and a mise-action pin at v5.2.1.

## History

Before this repository existed the plugin lived in the SferaDev/SferaDev monorepo: `0.3.0` came with its migration there (SferaDev/SferaDev#18) and `0.3.1` with that monorepo's changesets version pull request (SferaDev/SferaDev#660). Versions up to `0.2.3` came from an earlier standalone repository (SferaDev/SferaDev#18 body, `npm view rollup-plugin-import-cdn time`). The tags `rollup-plugin-import-cdn@0.3.0` and `rollup-plugin-import-cdn@0.3.1` came across with the history. On 2026-10-08 npm's latest is `0.3.1` (`npm view rollup-plugin-import-cdn version`), matching `package.json`.

## First release

On 2026-10-23 the 33 pending changesets in `.changeset/` (every `.md` file there but `README.md`) are all `minor` or `patch` (the `minor` ones are `fetch-cache.md`, `fetch-timeout.md`, `integrity-option.md` and `esm-sh-builtin.md`), and `changeset status` reports one `minor` bump for `rollup-plugin-import-cdn`, so the first run with `RELEASE_ENABLED` on opens a version pull request for `0.4.0`.

The tag format is `v<version>`, for example `v0.4.0`. `@changesets/cli` tags `<name>@<version>` only for monorepo tools and `v<version>` for a `root` tool (`gitTags.mjs`), and `@manypkg/get-packages` reports this repository as `root`. The older `rollup-plugin-import-cdn@0.3.x` tags came from the monorepo.

Order for the owner: create the npm trusted publisher for this repository and `release.yml`, then set `RELEASE_ENABLED` to `true`. Setting the variable starts nothing by itself: the first run needs the next push to `main` or a `workflow_dispatch` of `release.yml`. The `GIT_TOKEN` secret that `release.yml` uses already exists as an org secret visible to this repository.
