# Toolchain

## Node and pnpm

`mise.toml` pins exact Node and pnpm versions (read the file rather than a copy here, which drifts), and `mise.lock` records their checksums per platform. `package.json` `packageManager` names the same pnpm. With mise installed, `mise trust` (once per clone, since mise refuses an untrusted `mise.toml`) and then `mise install` in the repo root provide both. After changing a version in `mise.toml`, run `mise lock` and commit both files.

## Supported Node range

`package.json` declares `engines.node` `>=22.12.0`, and CI's `Test (minimum Node)` job runs `pnpm test` on exactly that version (it reads the value from `package.json`, so change it in one place).

- The source alone needs Node 18.17: Rollup 4 requires `>=18.0.0` (its `engines` field), global `fetch` is unflagged from 18.0.0 and stable from 21.0.0, and `URL.canParse` (`src/load.ts`) arrived in 19.9.0 and 18.17.0. `node:crypto` `createHash`/`randomUUID`, `node:fs/promises` and `AbortController` are all older.
- The floor is 22.12.0 because that is the oldest Node the suite can run on: vitest 5 declares `^22.12.0 || ^24.0.0 || >=26.0.0`. A range below it could not be tested. Node 18 and 20 are also past end of life (2025-04-30 and 2026-04-30, nodejs.org/en/about/previous-releases).

Raise the floor when vitest or Rollup raise theirs.

## Commands

From `package.json`:

```bash
pnpm install --frozen-lockfile
pnpm check             # everything CI's Check job runs, in order; run before a PR
pnpm lint              # biome check, read-only
pnpm fix               # biome check --write
pnpm knip              # unused files, exports and dependencies
pnpm typecheck         # tsc --noEmit
pnpm test              # vitest run
pnpm build             # bunchee, emits dist/index.{mjs,cjs,d.ts}
pnpm is-tree-shakable  # checks the built package
pnpm changeset         # describe a change for the next release
```

`pnpm install` runs lefthook's postinstall (`allowBuilds` in `pnpm-workspace.yaml`), which installs the hooks in `lefthook.yml`: a pre-commit Biome fix on staged files, and a commit-msg check that refuses Claude Code attribution.

## Build

`bunchee` reads `package.json` `exports` and writes ESM, CJS and declarations to `dist/`. It emits declarations through the TypeScript 6 JavaScript API, which TypeScript 7 dropped, so the catalog carries `@typescript/typescript6` as a shim next to `typescript` 7 (`pnpm-workspace.yaml` comment). `knip.json` ignores that shim because nothing imports it by name. Remove it once bunchee builds declarations on TypeScript 7 alone.

## TypeScript and style

`tsconfig.json`: ES2020 target and lib, `module` ESNext, `moduleResolution` bundler, `strict`, `isolatedModules`, and since #36 `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`, `noImplicitReturns`, `noImplicitOverride` and `noFallthroughCasesInSwitch`. Under `noUncheckedIndexedAccess` an array or record index reads as possibly `undefined`, which is why `src/integrity.ts` writes `hashes[0]!`. Relative imports carry no extension (`src/index.ts`). `biome.json`: tab indent, 100 columns, double quotes, the recommended preset with a few rules turned off.

## Dependencies

Versions live in the `catalog` of `pnpm-workspace.yaml` as exact versions, and `package.json` refers to them as `catalog:`. `catalogMode: strict` makes `pnpm add` refuse a version outside the catalog. The `overrides` there are security floors carried over from the SferaDev/SferaDev monorepo (comment in the file).
