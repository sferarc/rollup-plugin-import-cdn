---
"rollup-plugin-import-cdn": patch
---

Warn when an on-disk cache entry cannot be read, is not valid JSON or has the wrong shape, and when writing an entry fails, naming the cache file and the CDN URL. A missing entry stays silent, and every cache failure still falls back to a fetch.
