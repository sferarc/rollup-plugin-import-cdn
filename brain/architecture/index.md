# Architecture

The plugin is a Rollup plugin with three hooks, `buildStart`, `resolveId` and `load`, over about 540 lines of non-test source in `src/` on 2026-10-16 (`index.ts`, `load.ts`, `integrity.ts`, `types.ts`). Start with [[overview]].

## Start here

- [[overview]]: the module map, the public surface, and what the plugin does not do

## The core

- [[resolution]]: which specifiers the plugin claims and how each becomes a list of CDN URLs
- [[import-rewriting]]: how `load` rewrites the specifiers inside a fetched module to absolute URLs
