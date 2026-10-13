---
"rollup-plugin-import-cdn": patch
---

Fetch each CDN module once per build instead of once in `resolveId` and again in `load`, and skip Rollup virtual ids, Node builtins and absolute paths without contacting the CDN.
