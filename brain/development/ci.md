# CI

`.github/workflows/ci.yml` runs on pushes to `main` and on every pull request. Three jobs, `Check`, `Test (minimum Node)` and `Test (Rollup 3.0)`, all on `ubuntu-latest`: the repository is public, so it uses GitHub-hosted runners (comment in the workflow).

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

`pnpm check` in `package.json` chains steps 3 to 9 for local runs. The workflow keeps them as separate named steps so a failure names the failing check; change both together.

## Minimum Node job

`Test (minimum Node)` (#43) reads `engines.node` from `package.json`, strips the `>=`, sets it as `MISE_NODE_VERSION`, runs `mise install` (the action's own install uses `--locked`, which refuses a Node that `mise.lock` does not list), asserts `node --version` matches, then runs `pnpm install --frozen-lockfile` and `pnpm test`. It does not lint, build or typecheck. It is a separate job so the required `Check` name stays as it is (comment in the workflow); see [[toolchain]] for why the floor is where it is.

Actions are pinned to full commit SHAs with the version in a trailing comment, which the sferarc organisation requires. Update both together.

## Shift runner and the SWC cache

On the self-hosted shift runner, `pnpm build` used to fail before reaching the source: `@swc/core` refused to load its native addon with `ERR_SWC_NATIVE_CACHE` because `/home/runner/.cache` had a parent writable by another user without trusted sticky protection, and `pnpm is-tree-shakable` then failed with "No entry point" because there was no `dist/` (issue #5). GitHub-hosted CI was not affected.

On 2026-10-23 a brain-maintenance shift ran all seven checks of `pnpm check` on the shift runner, `pnpm build` and `pnpm is-tree-shakable` included, and all passed. That shift recorded no run link. On 2026-10-24 a bug-shift session ran `pnpm check` again on the shift runner, on this branch, and all seven checks passed (207 tests in 5 files, see #77). Shifts run the whole of `pnpm check` again. Which change fixed it, the shift workflow setting `SWC_NATIVE_BINDING_CACHE` or a change to the runner, is unknown from this repository. If `ERR_SWC_NATIVE_CACHE` comes back, the fix belongs in the shift workflow, not here.

## Rollup 3 job

`Test (Rollup 3.0)` installs the lowest Rollup the peer range accepts and runs `pnpm test`. `catalogMode: strict` rejects `pnpm add rollup@3.0.0`, so the job rewrites the `rollup` line of `pnpm-workspace.yaml` with `sed`, runs `pnpm install --no-frozen-lockfile` and asserts `rollup --version` is 3.0.0. Nothing is committed, so the catalog pin stays on Rollup 4. It does not lint, typecheck or build (`tsc` fails on Rollup 3.0.0 over `logLevel`, `onLog` and `attributes`, so do not add a typecheck step here), and it is a separate job so it adds no time to `Check`.

The suite passed on Rollup 3.0.0 apart from the `onLog` test, which `src/rollup.test.ts` skips below 3.25 (`it.skipIf` on `VERSION` from `rollup`). No change to the peer range was needed. Run it locally the same way: edit the catalog line, `pnpm install --no-frozen-lockfile`, `pnpm exec vitest run`, then `git checkout pnpm-workspace.yaml pnpm-lock.yaml`.

## Branch rules on `main`

The `main-default` ruleset, read from the GitHub API on 2026-10-08: `Check` is the one required status check, changes go through pull requests with squash or rebase merges, history is linear, and force pushes and deletion are blocked. That reading predates `Test (minimum Node)` and `Test (Rollup 3.0)`; whether the ruleset now requires either is unknown until the ruleset is read again.

## Related

- [[release]] runs on the same toolchain
