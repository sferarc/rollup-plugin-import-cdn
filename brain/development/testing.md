# Testing

`pnpm test` runs vitest with globals in a Node environment (`vitest.config.ts`) over `src/*.test.ts`. On 2026-10-15 the suite was 3 files and 107 tests (`it.each` cases counted separately), under a second.

| File | Covers |
| --- | --- |
| `src/index.test.ts` | `importCdn`: plugin name, the fetch fallback and the error without one, both hooks, `priority` and `versions`; fetch memoisation (one fetch for `resolveId` then `load`, a refetch after `buildStart`, #14); importer-relative specifiers (relative, root-relative and protocol-relative imports resolved against the CDN module's redirected URL, local importers left to Rollup, importer URLs forgotten after `buildStart`); foreign ids (`\0virtual`, `node:fs`, `fs`, Windows paths) skipped without a fetch |
| `src/load.test.ts` | `resolveDependency` ([[architecture/resolution]]) and `loadHook` ([[architecture/import-rewriting]]) directly, including the failure message that lists every attempted URL with its status or network error (#25) and the lex error that names the module and URL (#27); the on-disk cache in a temp directory: pinned URLs and subpaths served without a refetch, the cache shared between plugin instances, unpinned URLs, error responses and corrupt or malformed entries refetched, concurrent writes leaving one valid entry, a failed write removing its temporary file, nothing cached without the option (#21) |
| `src/integration.test.ts` | realistic module shapes against a mock CDN: scoped packages, dynamic imports, re-exports, fallback chains, network failures, malformed source; two real `rollup()` builds (#18, #20) |

Every test uses a mock `fetchImpl`; nothing touches the network. The `Integration: Rollup build` block runs `rollup()` with the plugin on a single CDN entry and checks the `es` chunks from `bundle.generate()`: one build bundles a dynamic import relative to a CDN module, the other bundles protocol-relative static and dynamic imports with no warnings. Multiple entry points, local files importing CDN packages, other output formats such as CJS, `bundle.write()`, watch mode and the on-disk cache inside a build stay untested. So do real CDNs and the network, and Rollup 3: `package.json` accepts `rollup` `^3.0.0 || ^4.0.0` as a peer, but the suite only runs against the catalog pin in `pnpm-workspace.yaml` (4.64.5 on 2026-10-15).

## Related

- [[ci]] for where the suite runs
