# The default priority is esm.sh

Recorded 2026-11-01, from [#116](https://github.com/sferarc/rollup-plugin-import-cdn/issues/116). Taken by an agent under the owner's 2026-11-01 grant for product decisions, choosing the option the issue recommended; the owner may overrule it.

## Decision

From 0.5.0, `priority` defaults to `["esm.sh"]` instead of `["skypack"]` (`resolveDependencyUrls` in `src/load.ts`, `src/load.test.ts`, "should resolve package from esm.sh by default"). The release is a minor bump with a changeset that tells users how to keep Skypack: `priority: ["skypack"]`.

## Why

On 2026-10-26 and 2026-10-28 Skypack served `react@17.0.1` for `react@18.2.0`, `react@17.0.2` and `react-dom@18.2.0/client`, and answered 404 for `preact@10.24.0` ([[architecture/resolution]], "Skypack"). The plugin fails over when a pinned version comes back as another one, but an unpinned `import "react"` with the old default bundled React 17 without a word, and the README's first example used that default. esm.sh answers an unknown package, version or subpath with a 404 and serves a stub that re-exports one pinned build path, and the stub and its dependents import that same path, so a package is bundled once without `versions` ([[architecture/resolution]], "esm.sh").

## Cost

Users who rely on the default get different URLs: their `cache` entries are fetched again, and `integrity` keys written for `cdn.skypack.dev` no longer match, which the unmatched-entry warning names. esm.sh code imports some dependencies by range and Node polyfills by unpinned path, so an offline rebuild with `cache` still requests those unless `?deps=` pins them ([[architecture/resolution]], "esm.sh"). Users who set `priority` are not affected.

## How it could be undone by accident

A change to `resolveDependencyUrls` or the `PluginOptions.priority` doc comment in `src/types.ts` that restores `["skypack"]`, or a test fixture that relies on the default with Skypack URLs. Tests whose mock CDN has Skypack's URL shapes pass `priority: ["skypack"]` themselves, so they keep passing whatever the default is.

## What would reopen it

esm.sh serving a wrong version or a broken build for a pinned specifier, seen in the weekly live check ([[development/testing]]) or a user report, while Skypack has been fixed.
