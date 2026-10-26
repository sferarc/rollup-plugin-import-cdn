---
"rollup-plugin-import-cdn": patch
---

Retry a failed CDN request on the next page load under `vite dev`. The dev server runs `buildStart` once, so a network error or timeout was kept for the whole session and every reload failed to resolve the import until the server restarted.
