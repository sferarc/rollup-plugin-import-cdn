# Import rewriting

`loadHook(key, options)` in `src/load.ts` fetches the module again ([[resolution]]), then rewrites its import specifiers so that every import inside CDN code is an absolute URL, which the plugin's own `resolveId` then claims on the next round.

## Steps

1. `await init()` and `parse(source)` from `es-module-lexer/minimal`. The minimal entry keeps the v2 record shape with `s` and `e` specifier offsets; see [[decisions/2026-09-14-es-module-lexer-minimal]].
2. For each import record, slice `source[s:e]`. If the characters around it are `(` and `)`, it is a dynamic `import()` and is left alone. A specifier that is already a URL is left alone too.
3. Every other specifier is replaced with `url.resolve(response.url, specifier)` from `node:url`, so relative and root-relative paths (Skypack's `/-/pkg@ver/...` form) resolve against the URL the module was actually served from.
4. Replacements are applied in order over a character array, with a running offset because each replacement changes the length.

The result is returned as the module code. A module with no imports comes back unchanged (`src/load.test.ts`, `src/integration.test.ts`).

## Why it is fragile

The rewrite depends on the lexer's offset semantics. es-module-lexer 3 changed the default entry's record fields, and with `s` and `e` undefined `slice` returned the whole module, so every import was replaced with the module source. Ten tests failed and the fix moved to the minimal entry (SferaDev/SferaDev#659, `CHANGELOG.md` 0.3.1). Any lexer upgrade should be checked against `src/load.test.ts` before merging.
