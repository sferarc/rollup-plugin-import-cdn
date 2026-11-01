---
"rollup-plugin-import-cdn": patch
---

Cache Skypack's pinned URLs, such as `https://cdn.skypack.dev/pin/lodash@v4.17.21-<hash>/mode=imports/optimized/lodash.js`. With `cache` set only the module that URL imports was stored, so every build fetched the pinned URL again and an offline build failed on it.
