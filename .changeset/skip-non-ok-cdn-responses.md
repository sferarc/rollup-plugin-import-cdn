---
"rollup-plugin-import-cdn": patch
---

Skip a CDN that answers with a non-OK status instead of returning its error page as the module source, so `priority` falls through to the next CDN as it does when a fetch throws.
