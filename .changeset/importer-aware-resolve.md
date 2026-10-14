---
"rollup-plugin-import-cdn": patch
---

Resolve relative and root-relative dynamic imports inside CDN modules against the URL the module was served from, instead of letting Rollup look for them on disk.
