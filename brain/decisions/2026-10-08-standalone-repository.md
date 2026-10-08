# Standalone repository

Recorded 2026-10-08, from commit 35a4e7a.

## Decision

The plugin moved out of the SferaDev/SferaDev monorepo, where it had lived since SferaDev/SferaDev#18, into `sferarc/rollup-plugin-import-cdn`, so it can build, test and release on its own. The workspace configuration it inherited became local files (`biome.json`, `knip.json`, `lefthook.yml`, `pnpm-workspace.yaml`, `tsconfig.json`), and the toolchain moved to Node 26 and pnpm 12 through mise.

## Consequences

- History before 35a4e7a, including pull request numbers in commit subjects, refers to SferaDev/SferaDev, not this repository.
- The catalog and the security overrides in `pnpm-workspace.yaml` were carried over from the monorepo and are now maintained here.
- CI runs on GitHub-hosted runners because the repository is public (`.github/workflows/ci.yml`).
