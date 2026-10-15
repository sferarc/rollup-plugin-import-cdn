---
"rollup-plugin-import-cdn": patch
---

Only trust a version pinned in the URL path when deciding what to cache, ignore cache entries whose `url` is not an http(s) URL, and give each cache write its own temporary file so concurrent builds sharing a cache directory do not collide.
