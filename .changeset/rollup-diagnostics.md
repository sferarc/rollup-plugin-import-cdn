---
"rollup-plugin-import-cdn": patch
---

Report warnings through Rollup instead of `console.warn`, so `onwarn` and `onLog` can filter them or turn them into errors. Each failed CDN attempt is also logged at debug level (`logLevel: "debug"`, Rollup 3.25 or later) before the next CDN is tried.
