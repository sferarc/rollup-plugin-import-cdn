---
"rollup-plugin-import-cdn": patch
---

Bundle a CDN module once when it is reached both by a specifier that redirects to a URL and by that URL directly. Each used to become its own module, so the same code was bundled twice and module-level state such as a singleton was split between the copies. Two specifiers now share one module when they were served from the same final URL with an identical body.
