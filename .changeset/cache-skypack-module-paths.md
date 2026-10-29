---
"rollup-plugin-import-cdn": patch
---

Cache Skypack's module paths, such as `/-/lodash@v4.17.21-<hash>/dist=es2019,mode=imports/optimized/lodash.js`. With `cache` set only the stub a pinned Skypack URL returns was stored, and the code it imports was refetched on every build.
