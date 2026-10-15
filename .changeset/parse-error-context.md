---
"rollup-plugin-import-cdn": patch
---

Name the module and the URL it was fetched from when its source cannot be lexed, and say so when the CDN returned an HTML page instead of a module. The lexer's error stays available as `cause`.
