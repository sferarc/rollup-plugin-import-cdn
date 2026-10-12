---
"rollup-plugin-import-cdn": patch
---

Leave `import.meta` in CDN modules untouched. It was rewritten to a URL such as `https://cdn.skypack.dev/import.meta`, which made any module that reads `import.meta.url` fail to parse.
