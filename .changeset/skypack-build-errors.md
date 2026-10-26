---
"rollup-plugin-import-cdn": patch
---

Treat a Skypack build error as a failed attempt. Skypack answers a package it cannot build with HTTP 200 and a module that throws on import; the plugin now tries the next CDN, fails the build naming the error URL when none succeeds, and neither caches that response nor uses one cached by an earlier version.
