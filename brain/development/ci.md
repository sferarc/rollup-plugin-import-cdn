# CI

`.github/workflows/ci.yml` runs on pushes to `main` and on every pull request. One job, `Check`, on `ubuntu-latest`: the repository is public, so it uses GitHub-hosted runners (comment in the workflow).

## Steps

1. `jdx/mise-action` installs Node and pnpm from `mise.toml`, verified against `mise.lock`.
2. `pnpm install --frozen-lockfile`
3. `pnpm lint`
4. `pnpm exec lefthook validate`. CI never commits, so this checks only that `lefthook.yml` loads.
5. `pnpm knip`
6. `pnpm typecheck`
7. `pnpm test`
8. `pnpm build`
9. `pnpm is-tree-shakable`, because consumers rely on unused exports being dropped from their bundles.

Actions are pinned to full commit SHAs with the version in a trailing comment, which the sferarc organisation requires. Update both together.

## Branch rules on `main`

The `main-default` ruleset, read from the GitHub API on 2026-10-08: `Check` is the one required status check, changes go through pull requests with squash or rebase merges, history is linear, and force pushes and deletion are blocked.

## Related

- [[release]] runs on the same toolchain
