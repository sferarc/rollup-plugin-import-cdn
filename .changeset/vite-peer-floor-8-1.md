---
"rollup-plugin-import-cdn": patch
---

Raise the optional Vite peer range to `^8.1.0`. On Vite 8.0.x a `sourcemap: true` build does not name CDN modules by their served URL or put them on the ignore list, and the `vite build --watch` test saw no rebuild within 30 seconds.
