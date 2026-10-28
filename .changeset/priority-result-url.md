---
"rollup-plugin-import-cdn": patch
---

Fail the build with a message naming the `priority` entry and the specifier when a custom `priority` function returns something other than an absolute URL or `undefined`. A relative path such as `"lib.js"` used to reach `fetch`, which rejected it as a network error, so the import was left unresolved behind a warning; with a `fetchImpl` that accepted it, the module's own relative imports could not be resolved.
