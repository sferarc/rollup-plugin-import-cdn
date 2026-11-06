---
"rollup-plugin-import-cdn": patch
---

Resolve relative `url()` and `@import` references in a stylesheet served from a CDN (a URL whose path ends in `.css`) against the URL it was served from, so `vite build` no longer fails on `@import "./base.css"` and fonts and images referenced as `url(fonts/x.woff2)` keep pointing at the CDN instead of the app. Such a stylesheet is no longer run through the JavaScript lexer, which rejected ordinary CSS such as `calc(100% / 3)`.
