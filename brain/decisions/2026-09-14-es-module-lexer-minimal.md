# Import offsets come from es-module-lexer/minimal

Recorded 2026-10-08, from SferaDev/SferaDev#659, `src/load.ts` and `CHANGELOG.md` 0.3.1.

## Decision

`src/load.ts` imports `init` and `parse` from `es-module-lexer/minimal` and calls `await init()`, rather than porting the rewrite to es-module-lexer 3's new record shape.

## Why

es-module-lexer 3.0.0 changed the default entry's import records to tagged unions with descriptive field names, so the `s` and `e` offsets the rewrite reads became `undefined`, and `slice(undefined, undefined)` replaced every import with the whole module source. 3.0.2 also made `init` a function, so `await init` initialised nothing. The minimal entry is the one upstream documents as v2-shaped, which kept behaviour identical. The built `dist/` keeps `es-module-lexer/minimal` external in both ESM and CJS (SferaDev/SferaDev#659).

## What would reopen it

es-module-lexer dropping or reshaping the minimal entry, or a rewrite of [[architecture/import-rewriting]] onto the new record shape.
