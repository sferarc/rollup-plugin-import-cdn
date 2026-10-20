# Plugin gaps, next fixes

Triage of the gaps in [[architecture/overview]] ("Things the code does not do") and the non-coverage in [[development/testing]], read on 2026-10-20 at `f64db93`. Each item is one small pull request. Order is by risk to users, then by cost. Nothing here is started.

## Test gaps first

Cheapest and they guard the options users already rely on.

1. **Rollup 3 in CI.** `package.json` accepts `rollup` `^3.0.0 || ^4.0.0`, but the suite only runs against the catalog pin. Add a CI job or matrix leg that installs the lowest Rollup 3 and runs `pnpm test`. Tests that need newer Rollup (`logLevel` and `onLog` in `src/rollup.test.ts` arrived in 3.25) must be gated or skipped first, so a red run reflects the plugin and not the suite. If the plugin itself fails, narrow the peer range instead of leaving it unverified.
2. **The on-disk cache inside a real build.** `cache` is tested only through `resolveDependency` and `src/load.test.ts`, never inside a `rollup()` build (the `import.meta.url` rebuild test uses Rollup's own `cache`, not the plugin option); add a `rollup()` build in `src/rollup.test.ts` that fills the cache, then builds again with a `fetchImpl` that throws and expects the same output.
3. **Multiple entry points and CJS output.** Add one `rollup()` build with two entries sharing a CDN module (one chunk, one fetch) and one with `format: "cjs"`, both in `src/rollup.test.ts`.
4. **Watch mode.** `buildStart` clears the memo, `moduleUrls` and `modulesByUrl`; add a `rollup.watch` test that a rebuild refetches, still resolves relative imports and still dedupes a module reached by name and by URL.
5. **`bundle.write()`.** Cover it with the multi-entry build from item 3 so output reaches disk without a second fetch.

## Behaviour gaps

6. **Only `skypack` is built in.** `availableCDNs` has one name, so every other CDN needs a `priority` function. Decide whether to add named entries (candidates: `esm.sh`, `jsdelivr`) or document the function form in `README.md`. Adding a name changes the option surface, so check it against [[architecture/resolution]] first.
7. **Unverified fetched code.** Only URLs in `integrity` are checked. A helper that prints the SRI value for a URL, or a documented recipe in `README.md`, would make the option usable without hand-hashing. No change to the build behaviour.
8. **Node only.** Node built-ins load at import time in `src/load.ts` (`node:crypto`, `node:fs/promises`, `node:path`), `src/integrity.ts` (`node:crypto`) and `src/index.ts` (`node:fs`, `node:module`, `node:path`). Running outside Node means moving the cache behind a lazy import, using WebCrypto for integrity, and replacing the entry stat and builtin list in `src/index.ts`. Worth doing only if someone asks; record the decision in `brain/decisions/` either way.

## Not planned

- Rewriting bare specifiers inside CDN modules: left as written on purpose so `versions` and `priority` apply (#15).
- Caching unpinned URLs: ranges and tags can change, so `cache` stays limited to exact versions.

## Open

- Whether the first release happens before or after items 1 to 3 waits on the owner ([[decisions/2026-10-08-release-off-until-enabled]]).
