---
"rollup-plugin-import-cdn": patch
---

Resolve relative imports against the requested CDN URL when a custom `fetchImpl` returns a response with an empty `url`, instead of leaving them unresolved, and use the WHATWG `URL` API in place of the deprecated `url.resolve`.
