---
"rollup-plugin-import-cdn": patch
---

Reuse the responses of URLs pinned to an exact version across watch rebuilds and repeated builds of the same plugin instance, even without `cache`, so `rollup --watch` and `vite build --watch` no longer fetch the pinned part of the CDN graph again on every change. Unpinned URLs and failed requests are still fetched on each build, and `integrity` is still checked every build.
