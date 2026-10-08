# Architecture

The plugin is a Rollup plugin with two hooks, `resolveId` and `load`, over about 120 lines of source in `src/`. Start with [[overview]].

## Start here

- [[overview]]: the module map, the public surface, and what the plugin does not do

## The core

- [[resolution]]: which specifiers the plugin claims and how each becomes a list of CDN URLs
- [[import-rewriting]]: how `load` rewrites the specifiers inside a fetched module to absolute URLs
