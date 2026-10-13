---
"rollup-plugin-import-cdn": patch
---

Leave bare specifiers in CDN modules untouched so they go back through `resolveId` and pick up the configured `versions` and `priority`. They were resolved against the module URL, which turned `import x from "react"` into a path under the importing package. The import rewrite also runs in linear time now, instead of copying the whole module once per import.
