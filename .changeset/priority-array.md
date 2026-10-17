---
"rollup-plugin-import-cdn": patch
---

Throw at construction when `priority` is not an array. A single CDN name such as `priority: "skypack"` or a lone function used to be accepted and then fail at the first import with `priorities.map is not a function`.
