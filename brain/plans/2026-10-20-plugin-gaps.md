# Plugin gaps, next fixes

Triage of the gaps in [[architecture/overview]] ("Things the code does not do") and the non-coverage in [[development/testing]], read on 2026-10-20 at `f64db93`. Each item is one small pull request. Order is by risk to users, then by cost. Items 1 to 8 are done.

## Test gaps first

Cheapest and they guard the options users already rely on.

1. **Rollup 3 in CI.** Done: the `Test (Rollup 3.0)` job runs the suite on Rollup 3.0.0 and the plugin passes, so the peer range stays. See [[development/ci]].
2. **The on-disk cache inside a real build.** Done: `src/rollup.test.ts` fills `cache` in one `rollup()` build, then rebuilds with a `fetchImpl` that throws and expects byte-identical output.
3. **Multiple entry points and CJS output.** Done: `src/rollup.test.ts` has a two-entry build where a shared CDN module lands in one non-entry chunk and is fetched once, and a `format: "cjs"` build with no `import`, `export` or URL left.
4. **Watch mode (done).** `buildStart` clears the memo, `moduleUrls` and `modulesByUrl`; `src/rollup.test.ts` has a `rollup.watch` test that a rebuild refetches the CDN modules and keeps one copy of a module reached by name and by URL. Watch always runs with Rollup's `cache` on, so `resolveId` runs again only for the entry; the `buildStart` reset is covered by the two-build test, not by watch.
5. **`bundle.write()` (done).** Covered with a two-entry build in `src/rollup.test.ts`: both entries and the shared chunk reach disk with one fetch per URL.

## Behaviour gaps

6. **Only `skypack` is built in.** Done for `esm.sh` and `jsdelivr`: `"esm.sh"` is a named entry, with the same version placement and scheme-key skipping as `skypack` ([[architecture/resolution]]). `jsdelivr` followed once its `/+esm` URL shape for subpaths was checked against the live CDN ([[architecture/resolution]], "jsDelivr").
7. **Unverified fetched code.** Done since #41: the "Integrity" section of `README.md` has a `curl` and `openssl` recipe whose output equals the `sha384` digest the plugin computes (checked on 2026-10-21), and a mismatch error prints the actual digest. A helper is not needed.
8. **Node only.** Done: Node built-ins load at import time in `src/load.ts` (`node:crypto`, `node:fs/promises`, `node:path`), `src/integrity.ts` (`node:crypto`) and `src/index.ts` (`node:fs`, `node:module`, `node:path`). Running outside Node means moving the cache behind a lazy import, using WebCrypto for integrity, and replacing the entry stat and builtin list in `src/index.ts`. Decided on 2026-10-21 not to do this until someone asks: [[decisions/2026-10-21-node-only]].

## Not planned

- Rewriting bare specifiers inside CDN modules: left as written on purpose so `versions` and `priority` apply (#15).
- Caching unpinned URLs: ranges and tags can change, so `cache` stays limited to exact versions.

## Open

Nothing. Items 1 to 3 merged before any release, so the question of releasing before or after them no longer applies. The first release still waits on the owner ([[decisions/2026-10-08-release-off-until-enabled]], [[development/release]]).
