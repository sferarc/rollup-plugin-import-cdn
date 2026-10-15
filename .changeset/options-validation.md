---
"rollup-plugin-import-cdn": patch
---

Throw a clear error when `importCdn` is created with an unknown CDN name or invalid entry in `priority`, or with an empty `cache` directory, instead of failing later inside a Rollup stack trace. The missing-fetch error now says to run on a Node version with a global `fetch` or pass `fetchImpl`.
