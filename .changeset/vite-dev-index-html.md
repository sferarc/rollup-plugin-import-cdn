---
"rollup-plugin-import-cdn": patch
---

Stop fetching `index.html` from the CDN when `vite dev` starts in a root without one. Vite resolves `index.html` as an entry at startup, and the plugin treated it as a package name and requested it from every CDN in `priority`. Ids ending in `.html` that are not URLs are now left to other resolvers.
