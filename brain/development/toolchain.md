# Toolchain

## Node and pnpm

`mise.toml` pins Node `26.10.0` and pnpm `12.10.1`, and `mise.lock` records their checksums per platform. `package.json` `packageManager` names the same pnpm. With mise installed, `mise install` in the repo root provides both. After changing a version in `mise.toml`, run `mise lock` and commit both files. `package.json` sets no `engines` field, so the supported Node range for consumers is unknown.

## Commands

From `package.json`:

```bash
pnpm install --frozen-lockfile
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

`tsconfig.json`: ES2020 target and lib, `module` ESNext, `moduleResolution` bundler, `strict`, `isolatedModules`. Relative imports carry no extension (`src/index.ts`). `biome.json`: tab indent, 100 columns, double quotes, the recommended preset with a few rules turned off.

## Dependencies

Versions live in the `catalog` of `pnpm-workspace.yaml` as exact versions, and `package.json` refers to them as `catalog:`. `catalogMode: strict` makes `pnpm add` refuse a version outside the catalog. The `overrides` there are security floors carried over from the SferaDev/SferaDev monorepo (comment in the file).
