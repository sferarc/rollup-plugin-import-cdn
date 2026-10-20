---
"rollup-plugin-import-cdn": patch
---

Resolve a relative import inside a CDN module by its string value, so an escaped specifier such as `"./\u00fc.js"` fetches `%C3%BC.js` instead of `/u00fc.js`, and a `'` in a single-quoted specifier no longer breaks the rewritten import.
