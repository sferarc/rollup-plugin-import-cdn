# Architecture

The plugin is a Rollup plugin built around `resolveId` and `load`, with `buildStart`, `buildEnd`, `resolveImportMeta` and `outputOptions` beside them and the Vite-only `enforce` and `configResolved` (the list is in [[overview]], from `src/index.ts`), over about 840 lines of non-test source in `src/` on 2026-10-30 (`index.ts`, `load.ts`, `integrity.ts`, `types.ts`, `wc -l`). Start with [[overview]].

## Start here

- [[overview]]: the module map, the public surface, and what the plugin does not do

## The core

- [[resolution]]: which specifiers the plugin claims and how each becomes a list of CDN URLs
- [[import-rewriting]]: how `load` rewrites the specifiers inside a fetched module to absolute URLs
