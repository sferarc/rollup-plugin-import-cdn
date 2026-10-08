# Overview

rollup-plugin-import-cdn lets Rollup import ESM packages and URLs from a CDN and process them like local code, so they take part in tree-shaking (`README.md`). It is published to npm as `rollup-plugin-import-cdn`, dual ESM and CJS (`package.json` `exports`), with Rollup 3 or 4 as a peer dependency and `es-module-lexer` as its only runtime dependency.

## Module map

| File | Role |
| --- | --- |
| `src/index.ts` | `importCdn(options)`: picks a fetch implementation and returns the plugin object named `plugin-import-cdn` with `resolveId` and `load` |
| `src/load.ts` | `resolveDependency` ([[resolution]]) and `loadHook` ([[import-rewriting]]) |
| `src/types.ts` | `PluginOptions`, `FetchImpl`, `AvailableCDNs`, `Dependency`; all re-exported from `src/index.ts` |
| `src/utils.ts` | the `PartialBy` type helper that makes `fetchImpl` optional |

## Options

`PluginOptions` in `src/types.ts`:

- `fetchImpl`: optional. Defaults to the global `fetch`; `importCdn` throws if neither exists (`src/index.ts`, `src/index.test.ts`).
- `priority`: CDNs to try in order, each `"skypack"` or a function from specifier to URL. Defaults to `["skypack"]`.
- `versions`: a map from specifier to version, applied only to the built-in `skypack` entry.

## Things the code does not do

Read from `src/load.ts` on 2026-10-08, not covered by a test:

- No cache. `resolveId` fetches a module to resolve it and `load` fetches it again.
- `response.ok` is never read. Only a thrown fetch moves on to the next CDN, so an error page served with a 404 status would be returned as the module source. The tests' mock fetch throws on a miss (`src/integration.test.ts`), so this path is untested.
- `src/load.ts` imports `node:url`, so the plugin runs where Rollup runs on Node, not in a browser build of Rollup.
