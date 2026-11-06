# CI

`.github/workflows/ci.yml` runs on pushes to `main` and on every pull request. Five jobs, `Check`, `Test (minimum Node)`, `Test (Rollup 3.0)`, `Test (Vite 8.1)` and `Test (Rollup beta)`, all on `ubuntu-latest`: the repository is public, so it uses GitHub-hosted runners (comment in the workflow).

## Check steps

1. `jdx/mise-action` installs Node and pnpm from `mise.toml`, verified against `mise.lock`.
2. `pnpm install --frozen-lockfile`
3. `pnpm lint`
4. `pnpm exec lefthook validate`. CI never commits, so this checks only that `lefthook.yml` loads.
5. `pnpm knip`
6. `pnpm typecheck`
7. `pnpm test`
8. `pnpm build`
9. `pnpm is-tree-shakable`, because consumers rely on unused exports being dropped from their bundles.
10. `pnpm audit --prod --audit-level high` (#196), below.

`pnpm check` in `package.json` chains steps 3 to 9 for local runs. The workflow keeps them as separate named steps so a failure names the failing check; change both together. Step 10 stays out of `pnpm check`: its result depends on the advisory database, not on the code.

## Runtime advisories

The last `Check` step fails on a high or critical advisory in `dependencies` and `optionalDependencies`, the tree the package ships, so an advisory there blocks every pull request and release until it is bumped or accepted. Dev dependencies and moderate or lower advisories do not fail it. Dependabot security updates stay off; dependency bumps keep coming from HQ's updater (sferarc/hq#989).

Accepted advisories go in `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`, one GHSA per line with a comment giving the reason and the condition that ends the exception. pnpm reads that list itself, so the CI step passes no `--ignore`: on pnpm 12.16.1, `pnpm audit --ignore <GHSA>` also writes the GHSA into `pnpm-workspace.yaml`, so use it only to add an entry, then add the comment. The list was empty when the step landed, since `pnpm audit --prod` found no advisories on 2026-11-06.

Checked on pnpm 12.16.1 on 2026-11-06 against a scratch lockfile holding `lodash@4.17.20`: the step exited 1 on its two high advisories with `ignoreGhsas: []`, and 0 once both were listed, with two moderate advisories still reported.

## Minimum Node job

`Test (minimum Node)` (#43) reads `engines.node` from `package.json`, strips the `>=`, sets it as `MISE_NODE_VERSION`, runs `mise install` (the action's own install uses `--locked`, which refuses a Node that `mise.lock` does not list), asserts `node --version` matches, then runs `pnpm install --frozen-lockfile` and `pnpm test`. It does not lint, build or typecheck. It is a separate job so the required `Check` name stays as it is (comment in the workflow); see [[toolchain]] for why the floor is where it is.

Actions are pinned to full commit SHAs with the version in a trailing comment, which the sferarc organisation requires. Update both together.

## Shift runner and the SWC cache

On the self-hosted shift runner, `pnpm build` used to fail before reaching the source: `@swc/core` refused to load its native addon with `ERR_SWC_NATIVE_CACHE` because `/home/runner/.cache` had a parent writable by another user without trusted sticky protection, and `pnpm is-tree-shakable` then failed with "No entry point" because there was no `dist/` (issue #5). GitHub-hosted CI was not affected.

On 2026-10-23 a brain-maintenance shift ran all seven checks of `pnpm check` on the shift runner, `pnpm build` and `pnpm is-tree-shakable` included, and all passed. That shift recorded no run link. Shifts run the whole of `pnpm check` again. Which change fixed it, the shift workflow setting `SWC_NATIVE_BINDING_CACHE` or a change to the runner, is unknown from this repository. If `ERR_SWC_NATIVE_CACHE` comes back, the fix belongs in the shift workflow, not here.

## Rollup 3 job

`Test (Rollup 3.0)` installs the lowest Rollup the peer range accepts and runs `pnpm test`. `catalogMode: strict` rejects `pnpm add rollup@3.0.0`, so the job rewrites the `rollup` line of `pnpm-workspace.yaml` with `sed`, runs `pnpm install --no-frozen-lockfile` and asserts `rollup --version` is 3.0.0. Nothing is committed, so the catalog pin stays on Rollup 4. It does not lint or typecheck the project (`tsc` fails on Rollup 3.0.0 over `logLevel`, `onLog` and `attributes` in the tests, so do not add `pnpm typecheck` here), and it is a separate job so it adds no time to `Check`. After the tests it runs `pnpm build` and `pnpm exec tsc -p types-check`, whose `tsconfig.json` extends the root one with `paths` cleared, so `types-check/rollup.ts` imports the package by its own name from `dist/index.d.ts` and checks that the published `importCdn()` type is a Rollup 3.0.0 `Plugin` (#178). Making `debug` required in the built `HookContext` failed `tsc -p types-check` locally on Rollup 3.0.0 on 2026-11-05, since Rollup 3.0 has no `this.debug`, while Rollup 4 accepted it.

The suite passed on Rollup 3.0.0 apart from the `onLog` test, which `src/rollup.test.ts` skips below 3.25 (`it.skipIf` on `VERSION` from `rollup`). No change to the peer range was needed. Run it locally the same way: edit the catalog line, `pnpm install --no-frozen-lockfile`, `pnpm exec vitest run`, `pnpm build`, `pnpm exec tsc -p types-check`, then `git checkout pnpm-workspace.yaml pnpm-lock.yaml`.

## Vite 8.1 job

`Test (Vite 8.1)` (#164) runs the suite on the lowest Vite the optional peer range accepts, the same way as the Rollup 3 job: `sed` rewrites the `vite` catalog line to 8.1.0, `pnpm install --no-frozen-lockfile`, a check that `vite --version` starts with `vite/8.1.0`, then `pnpm test`. vitest's own `vite` dependency dedupes to the pinned version, so vitest runs on it too. It then runs `pnpm build` and `pnpm exec tsc -p types-check` as the Rollup 3 job does (#183), so `types-check/vite.ts` checks that the published `importCdn()` type is a Vite 8.1.0 `Plugin` and fits `UserConfig.plugins`. `types-check/rolldown.ts` does the same for Rolldown's `Plugin` and `InputOptions`; the catalog Rolldown is the `compatiblePackages` floor, so both jobs check it there. Every file in `types-check/` compiles in both jobs. On 2026-11-05 all three files passed against `dist` on Vite 8.1.0 and on Rollup 3.0.0, and each failed with `name` typed as `number` in the built `ImportCdnPlugin`.

The range was `^8.0.0` (#157) and is now `^8.1.0`. On 2026-11-05, Vite 8.0.0 and 8.0.16 failed two tests in `src/vite.test.ts`: "names a CDN module in the sourcemap by the URL it was served from", where `sources` kept cwd-relative paths such as `../../<cwd>/pkg-a` and nothing was on the ignore list, so the `outputOptions` sourcemap hook had no effect ([[architecture/import-rewriting]]); and "rebuilds under vite build --watch", which saw no rebuild within 30 seconds. Whether the watch failure also happens on Linux, or only with macOS polling, is unknown. Vite 8.1.0, 8.2.0, 8.3.0 and 8.3.5 passed every test in that file and `src/examples.test.ts`, and 8.1.0 passed the whole suite.

Locally on macOS, every `src/vite.test.ts` test fails on Vite 8.0.x and 8.1.x when the temp root sits under the default `TMPDIR`, a `/var/folders` path behind the `/var` to `/private/var` symlink: a plain `vite build` without the plugin fails there too (`vite:build-html` emits `../../private/var/...` as a file name), so it is a Vite bug, fixed by 8.2.0. Set `TMPDIR` to a path with no symlink, such as one under `/private/tmp`, to run the suite on 8.1.0 locally. `ubuntu-latest` has no such symlink.

## Rollup beta job

`Test (Rollup beta)` (#188) runs the suite on the version behind Rollup's `beta` dist-tag, read with `npm view rollup@beta version` on each run, so a regression in the next major shows before it ships. It pins the catalog the way the Rollup 3 job does, asserts `rollup --version`, then runs `pnpm test`, `pnpm build` and `pnpm exec tsc -p types-check`. It is not a required check, so an upstream beta regression never blocks a pull request. On 2026-11-05, with `5.0.0-2`, all three passed locally; `pnpm typecheck` fails there only in `src/test-utils.ts`, because Rollup 5 requires `importerAttributes` in the `resolveId` options and passes `load` an options argument, so the job leaves it out. Widening the peer range to Rollup 5 waits on 5.0.0 (#189).

## Live CDN

`.github/workflows/live-cdn.yml` runs `pnpm test:live` ([[testing]], "Live check") on Mondays at 06:17 UTC and on `workflow_dispatch`, on `ubuntu-latest` (#115). It is a separate workflow, not a job in `ci.yml`, so a CDN outage never fails a pull request. When a scheduled run fails, the last steps mint a sferarc-hq App token with `issues: write` (from the org secrets `HQ_APP_ID` and `HQ_APP_PRIVATE_KEY`, as in `release.yml`) and open an issue titled "Live CDN check failed" labelled `product:rollup-plugin-import-cdn`, `bug`, `p2` and `ready`, or comment the run link on the one already open (#124). Lanes take only `ready` issues opened by SferaDev or the sferarc-hq or pgbeam-hq Apps, so the `github.token` issue it filed before, authored by `github-actions[bot]` and without `ready`, would never have been picked up. A manual run only shows its result in the Actions tab.

## Branch rules on `main`

The `main-default` ruleset, read from the GitHub API on 2026-10-08: changes go through pull requests with squash or rebase merges, history is linear, and force pushes and deletion are blocked. Read again on 2026-11-05, its required status checks are `Check`, `Approved stack` and `No Claude attribution`, so none of the `Test (...)` jobs is required.

## Related

- [[release]] runs on the same toolchain
