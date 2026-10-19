---
"rollup-plugin-import-cdn": patch
---

Reject a `fetchImpl` that is not a function when the plugin is created. A string or object used to pass and fail every request as a network error, so each CDN import was only warned about and left out of the bundle as an unresolved import.
