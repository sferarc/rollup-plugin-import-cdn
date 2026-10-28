---
"rollup-plugin-import-cdn": patch
---

Treat an HTML page served with HTTP 200, such as a captive portal or a CDN's soft error page, as a failed attempt. The plugin now tries the next CDN, fails the build naming the page URL when none succeeds, and neither caches that page under a pinned URL nor uses one cached by an earlier version, so one bad network no longer breaks every later build. Under `vite dev` such a response is fetched again on the next page load.
