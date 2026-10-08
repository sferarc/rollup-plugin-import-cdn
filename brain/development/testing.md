# Testing

`pnpm test` runs vitest with globals in a Node environment (`vitest.config.ts`) over `src/*.test.ts`. On 2026-10-08 the suite was 3 files and 39 tests, under a second.

| File | Covers |
| --- | --- |
| `src/index.test.ts` | `importCdn`: plugin name, the fetch fallback and the error without one, both hooks, `priority` and `versions` |
| `src/load.test.ts` | `resolveDependency` ([[architecture/resolution]]) and `loadHook` ([[architecture/import-rewriting]]) directly |
| `src/integration.test.ts` | realistic module shapes against a mock CDN: scoped packages, dynamic imports, re-exports, fallback chains, network failures, malformed source |

Every test uses a mock `fetchImpl`; nothing touches the network. No test runs a real `rollup()` build, so how Rollup itself calls the hooks (entry points, importers) is untested. Most mocks throw on a miss; the non-OK status path is covered by two tests in `src/load.test.ts` that return `ok: false` ("should skip a CDN that answers with a non-OK status" and "should return null when every CDN answers with a non-OK status").

## Related

- [[ci]] for where the suite runs
