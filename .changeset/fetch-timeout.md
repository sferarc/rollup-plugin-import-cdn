---
"rollup-plugin-import-cdn": minor
---

Add a `timeout` option, 30 seconds by default, so a CDN that accepts the connection but never answers fails over to the next CDN in `priority` instead of stalling the build. Set it to `0` to wait indefinitely as before.
