---
"rollup-plugin-import-cdn": patch
---

Leave every dynamic `import()` in CDN modules untouched. One with spaces inside the parentheses or with import attributes, such as `import("./x.js", { with: { type: "json" } })`, was rewritten with its quotes inside the URL, which made the module fail to parse.
