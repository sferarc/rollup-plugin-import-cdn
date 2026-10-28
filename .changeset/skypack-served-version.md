---
"rollup-plugin-import-cdn": patch
---

Treat a Skypack response for an exact version that serves a different version as a failed attempt. Skypack has been answering `react@18.2.0` with React 17.0.1; the plugin now tries the next CDN, fails the build naming the served version when none succeeds, and neither caches that response nor uses one cached by an earlier version.
