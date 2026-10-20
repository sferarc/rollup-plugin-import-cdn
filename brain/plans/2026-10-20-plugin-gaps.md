# Plugin gaps, next fixes

Triage of the gaps in [[architecture/overview]] ("Things the code does not do") and the non-coverage in [[development/testing]], read on 2026-10-20 at `f64db93`. Each item is one small pull request. Order is by risk to users, then by cost. Nothing here is started.

## Test gaps first

Cheapest and they guard the options users already rely on.

1. **Rollup 3 in CI.** `package.json` accepts `rollup` `^3.0.0 || ^4.0.0`, but the suite only runs against the catalog pin. Add a CI job or matrix leg that installs the lowest Rollup 3 and runs `pnpm test`. If it cannot pass, narrow the peer range instead of leaving it unverified.
2. **The on-disk cache inside a real build.** `cache` is tested through `resolveDependency` and one `import.meta.url` build; add a `rollup()` build in `src/rollup.test.ts` that fills the cache, then builds again with a `fetchImpl` that throws and expects the same output.
3. **Multiple entry points and CJS output.** Add one `rollup()` build with two entries sharing a CDN module (one chunk, one fetch) and one with `format: "cjs"`, both in `src/rollup.test.ts`.
4. **Watch mode.** `buildStart` clears the memo and `moduleUrls`; add a `rollup.watch` test that a rebuild refetches and still resolves relative imports.
5. **`bundle.write()`.** Cover it with the multi-entry build from item 3 so output reaches disk without a second fetch.

## Behaviour gaps

6. **Only `skypack` is built in.** `availableCDNs` has one name, so every other CDN needs a `priority` function. Decide whether to add named entries (candidates: `esm.sh`, `jsdelivr`) or document the function form in `README.md`. Adding a name changes the option surface, so check it against [[architecture/resolution]] first.
7. **Unverified fetched code.** Only URLs in `integrity` are checked. A helper that prints the SRI value for a URL, or a documented recipe in `README.md`, would make the option usable without hand-hashing. No change to the build behaviour.
8. **Node only.** `src/load.ts` imports `node:crypto`, `node:fs/promises` and `node:path`. Splitting the cache into a lazily imported module would let the plugin load in a non-Node Rollup build when `cache` is unset. Worth doing only if someone asks; record the decision in `brain/decisions/` either way.

## Not planned

- Rewriting bare specifiers inside CDN modules: left as written on purpose so `versions` and `priority` apply (#15).
- Caching unpinned URLs: ranges and tags can change, so `cache` stays limited to exact versions.

## Open

- Whether the first release happens before or after items 1 to 3 waits on the owner ([[decisions/2026-10-08-release-off-until-enabled]]).
