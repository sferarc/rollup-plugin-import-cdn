# Testing

`pnpm test` runs vitest with globals in a Node environment (`vitest.config.ts`) over `src/*.test.ts`. On 2026-10-15 the suite was 3 files and 78 tests, about a second.

| File | Covers |
| --- | --- |
| `src/index.test.ts` | `importCdn`: plugin name, the fetch fallback and the error without one, both hooks, `priority` and `versions` |
| `src/load.test.ts` | `resolveDependency` ([[architecture/resolution]]) and `loadHook` ([[architecture/import-rewriting]]) directly |
| `src/integration.test.ts` | realistic module shapes against a mock CDN: scoped packages, dynamic imports, re-exports, fallback chains, network failures, malformed source. Its `Rollup build` block runs real `rollup()` builds: a relative dynamic import, a CDN 404 failing the build, one fetch for a module shared by two importers, a rejected fetch memoized within a build and retried on the next one (the watch-rebuild path through `buildStart`), and a rejected `response.text()` leaving the import unresolved rather than empty |

Every test uses a mock `fetchImpl`; nothing touches the network. Only the `Rollup build` block exercises how Rollup itself calls the hooks (entry points, several importers, a reused plugin instance); the other files call the hooks directly.

## Related

- [[ci]] for where the suite runs
