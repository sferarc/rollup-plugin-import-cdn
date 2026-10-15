# Import rewriting

`loadHook(key, options)` in `src/load.ts` fetches the module again ([[resolution]]), then rewrites its import specifiers so that every import inside CDN code is an absolute URL, which the plugin's own `resolveId` then claims on the next round.

## Steps

1. `await init()` and `parse(source)` from `es-module-lexer/minimal`. The minimal entry keeps the v2 record shape with `s` and `e` specifier offsets; see [[decisions/2026-09-14-es-module-lexer-minimal]].
2. Records with `d === -2` are `import.meta`, whose span is the expression rather than a specifier, and are skipped. Before this check `import.meta.url` was rewritten to `https://cdn.skypack.dev/import.meta.url` (`src/load.test.ts`, "should leave import.meta untouched").
3. Records with `d > -1` are dynamic `import()` and are left alone: their span is the whole argument, quotes included. The check used to be whether the characters around the span were `(` and `)`, which missed `import( "./x.js" )` and `import("./x.js", { with: ... })` and rewrote them to `import(https://cdn.skypack.dev/%22./x.js%22 ...)`, which is not valid JavaScript (`src/load.test.ts`, "should leave dynamic imports untouched"). For each static import record, slice `source[s:e]`; a specifier with a scheme (`https://...`) or a bare package name is left alone too.
4. Every other specifier is replaced with `url.resolve(response.url, specifier)` from `node:url`, so relative, root-relative (Skypack's `/-/pkg@ver/...` form) and protocol-relative (`//host/...`) specifiers resolve against the URL the module was actually served from (`src/load.test.ts`, "should resolve protocol-relative specifiers against the response URL's protocol").
5. Replacements are applied in order over a character array, with a running offset because each replacement changes the length.

The result is returned as the module code. A module with no imports comes back unchanged (`src/load.test.ts`, `src/integration.test.ts`).

## Why it is fragile

The rewrite depends on the lexer's offset semantics. es-module-lexer 3 changed the default entry's record fields, and with `s` and `e` undefined `slice` returned the whole module, so every import was replaced with the module source. Ten tests failed and the fix moved to the minimal entry (SferaDev/SferaDev#659, `CHANGELOG.md` 0.3.1). Any lexer upgrade should be checked against `src/load.test.ts` before merging.
