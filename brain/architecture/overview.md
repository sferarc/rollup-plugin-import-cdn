# Overview

rollup-plugin-import-cdn lets Rollup import ESM packages and URLs from a CDN and process them like local code, so they take part in tree-shaking (`README.md`). It is published to npm as `rollup-plugin-import-cdn`, dual ESM and CJS (`package.json` `exports`), with Rollup 3 or 4 as a peer dependency and `es-module-lexer` as its only runtime dependency.

## Module map

| File | Role |
| --- | --- |
| `src/index.ts` | `importCdn(options)`: picks a fetch implementation, wraps it in a per-build memo (the `responses` map), and returns the plugin object named `plugin-import-cdn` with `buildStart`, `resolveId` and `load`. `buildStart` clears the memo and `moduleUrls`, the map from module id to the URL it was served from that `resolveId` uses to resolve relative imports inside a CDN module ([[resolution]]). `isForeignId` matches `\0` virtual ids, `node:` and builtin modules, and absolute paths; `load` skips those ids, and so does `resolveId` unless the id is relative to a CDN importer |
| `src/load.ts` | `resolveDependency` ([[resolution]]) and `loadHook` ([[import-rewriting]]) |
| `src/types.ts` | `PluginOptions`, `FetchImpl`, `AvailableCDNs`, `Dependency`; all re-exported from `src/index.ts` |

## Options

`PluginOptions` in `src/types.ts`:

- `fetchImpl`: optional. Defaults to the global `fetch`; `importCdn` throws if neither exists (`src/index.ts`, `src/index.test.ts`).
- `priority`: CDNs to try in order, each `"skypack"` or a function from specifier to URL. Defaults to `["skypack"]`.
- `versions`: a map from package name or full specifier to version. The built-in `skypack` entry inserts it after the package name, and custom `priority` functions receive it as their second argument ([[resolution]]).
- `cache`: optional directory. When set, a response for a URL containing an exact `@x.y.z` is stored as `<sha256 of the URL>.json` (`url` after redirects, and `main`) and read back instead of fetching; read and write failures fall back to a fetch (`src/load.ts`, `src/load.test.ts`).

## Things the code does not do

Read from `src/index.ts` and `src/load.ts` on 2026-10-15:

- No cache across builds unless `cache` is set, and then only for versioned URLs. Within a build, the memo in `importCdn` fetches each URL once, so `resolveId` and `load` share one response, and `buildStart` clears it so the next build fetches again (`src/index.test.ts`: "fetches a module once for resolveId followed by load", "refetches after buildStart").
- A non-OK response from one CDN moves on to the next. When no CDN succeeds and at least one answered non-OK, the build fails with an error listing every attempted URL with its HTTP status or network error; when every attempt was a network error, the plugin warns with the same list and leaves the id unresolved (`src/load.test.ts`).
- `src/load.ts` imports `node:url`, so the plugin runs where Rollup runs on Node, not in a browser build of Rollup.
