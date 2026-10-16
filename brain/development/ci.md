# CI

`.github/workflows/ci.yml` runs on pushes to `main` and on every pull request. Two jobs, `Check` and `Test (minimum Node)`, both on `ubuntu-latest`: the repository is public, so it uses GitHub-hosted runners (comment in the workflow).

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

## Branch rules on `main`

The `main-default` ruleset, read from the GitHub API on 2026-10-08: `Check` is the one required status check, changes go through pull requests with squash or rebase merges, history is linear, and force pushes and deletion are blocked. That reading predates `Test (minimum Node)`; whether the ruleset now requires it too is unknown until the ruleset is read again.

## Related

- [[release]] runs on the same toolchain
