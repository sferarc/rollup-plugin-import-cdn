# Release

Releases use changesets (`.changeset/config.json`, `.changeset/README.md`), and publishing has been on since the owner enabled it on 2026-11-01.

## The flow

1. A change that should ship adds a changeset with `pnpm changeset`.
2. On a push to `main`, `.github/workflows/release.yml` runs `changesets/action`, which opens or updates a version pull request that bumps `package.json` and writes `CHANGELOG.md`.
3. Merging that pull request runs the workflow again, which runs `pnpm release` (`pnpm build && changeset publish`).

The action uses a `sferarc-hq` App token rather than `github.token`, because a version pull request merged by the Actions bot would push to `main` without triggering the workflow, and nothing would publish (comment in `release.yml`). The first step mints it with `actions/create-github-app-token` from the org secrets `HQ_APP_ID` and `HQ_APP_PRIVATE_KEY`, scoped to this repository with `contents` and `pull-requests` write, so version commits and the version pull request are authored by `sferarc-hq[bot]`. An App token, unlike `github.token`, still triggers `pull_request` workflows, so the version pull request gets the required `Check` job.

## Enabled by the owner

The `release` job only runs when the repository variable `RELEASE_ENABLED` is `true`, and only the owner sets it. Push runs of `release.yml` up to 883691a were skipped; the owner's `workflow_dispatch` on 883691a at 06:39 UTC on 2026-11-01 ran the job (run 41281716355), so the variable has been `true` since then. See [[decisions/2026-10-08-release-off-until-enabled]].

## Authentication

npm trusted publishing only: the job has `id-token: write`, and npm exchanges the OIDC token for a publish credential, so no npm token is stored (`release.yml`). `package.json` `publishConfig` sets public access and provenance. The trusted publisher on npmjs.com names this repository and `release.yml`: the `0.4.0` publish authenticated through it, and `npm view rollup-plugin-import-cdn@0.4.0 dist.attestations` reports SLSA v1 provenance. Changing it is an owner step on npmjs.com. Trusted publishing needs npm 11.5.1 or newer, which comes from the Node in `mise.toml`. The workflow is ready on the repository side: `id-token: write`, `publishConfig.provenance`, and the `jdx/mise-action` step that installs that Node (its pinned version is in `release.yml`, which the weekly action update moves).

## History

Before this repository existed the plugin lived in the SferaDev/SferaDev monorepo: `0.3.0` came with its migration there (SferaDev/SferaDev#18) and `0.3.1` with that monorepo's changesets version pull request (SferaDev/SferaDev#660). Versions up to `0.2.3` came from an earlier standalone repository (SferaDev/SferaDev#18 body, `npm view rollup-plugin-import-cdn time`). The tags `rollup-plugin-import-cdn@0.3.0` and `rollup-plugin-import-cdn@0.3.1` came across with the history. On 2026-10-08 npm's latest is `0.3.1` (`npm view rollup-plugin-import-cdn version`), matching `package.json`.

## First release

`0.4.0`, published on 2026-11-01, is the first release from this repository. The first run with `RELEASE_ENABLED` on opened the version pull request #113, which consumed all 54 pending changesets (six of them `minor`, the rest `patch`), bumped `package.json` to `0.4.0` and wrote `CHANGELOG.md`. Merging it at 07:08 UTC ran `release.yml` again on d1e99cd (run 41283574924), which published `0.4.0` to npm at 07:09 UTC, pushed the `v0.4.0` tag and created the `v0.4.0` GitHub release.

The tag format is `v<version>`, as `v0.4.0` shows. `@changesets/cli` tags `<name>@<version>` only for monorepo tools and `v<version>` for a `root` tool (`gitTags.mjs`), and `@manypkg/get-packages` reports this repository as `root`. The older `rollup-plugin-import-cdn@0.3.x` tags came from the monorepo.

The owner steps were tracked in [#111](https://github.com/sferarc/rollup-plugin-import-cdn/issues/111): the npm trusted publisher first, then `RELEASE_ENABLED`, which starts nothing by itself, so the first run needed a push to `main` or a `workflow_dispatch`.
