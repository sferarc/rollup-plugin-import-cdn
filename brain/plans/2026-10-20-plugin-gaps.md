# Plugin gaps, next fixes

Triage of the gaps in [[architecture/overview]] ("Things the code does not do") and the non-coverage in [[development/testing]], read on 2026-10-20 at `f64db93`. Each item is one small pull request. Order is by risk to users, then by cost. Items 2, 3 and 6 are done; the rest is not started.

## Test gaps first

Cheapest and they guard the options users already rely on.

1. **Rollup 3 in CI.** Done: the `Test (Rollup 3.0)` job runs the suite on Rollup 3.0.0 and the plugin passes, so the peer range stays. See [[development/ci]].
2. **The on-disk cache inside a real build.** Done: `src/rollup.test.ts` fills `cache` in one `rollup()` build, then rebuilds with a `fetchImpl` that throws and expects byte-identical output.
3. **Multiple entry points and CJS output.** Done: `src/rollup.test.ts` has a two-entry build where a shared CDN module lands in one non-entry chunk and is fetched once, and a `format: "cjs"` build with no `import`, `export` or URL left.
4. **Watch mode.** `buildStart` clears the memo, `moduleUrls` and `modulesByUrl`; add a `rollup.watch` test that a rebuild refetches, still resolves relative imports and still dedupes a module reached by name and by URL.
5. **`bundle.write()`.** Cover it with the two-entry build added for item 3 so output reaches disk without a second fetch.

## Behaviour gaps

6. **Only `skypack` is built in.** Done for `esm.sh`: `"esm.sh"` is a named entry, with the same version placement and scheme-key skipping as `skypack` ([[architecture/resolution]]). `jsdelivr` stays a `priority` function until its `/+esm` URL shape for subpaths is verified.
7. **Unverified fetched code.** Only URLs in `integrity` are checked. A helper that prints the SRI value for a URL, or a documented recipe in `README.md`, would make the option usable without hand-hashing. No change to the build behaviour.
8. **Node only.** Node built-ins load at import time in `src/load.ts` (`node:crypto`, `node:fs/promises`, `node:path`), `src/integrity.ts` (`node:crypto`) and `src/index.ts` (`node:fs`, `node:module`, `node:path`). Running outside Node means moving the cache behind a lazy import, using WebCrypto for integrity, and replacing the entry stat and builtin list in `src/index.ts`. Worth doing only if someone asks; record the decision in `brain/decisions/` either way.

## Not planned

- Rewriting bare specifiers inside CDN modules: left as written on purpose so `versions` and `priority` apply (#15).
- Caching unpinned URLs: ranges and tags can change, so `cache` stays limited to exact versions.

## Open

- Whether the first release happens before or after items 1 to 3 waits on the owner ([[decisions/2026-10-08-release-off-until-enabled]]).
