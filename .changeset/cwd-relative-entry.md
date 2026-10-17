---
"rollup-plugin-import-cdn": patch
---

Leave an entry given relative to the working directory, such as `input: "src/index.js"`, to Rollup when that file exists. It used to be treated as a package name and fetched from the CDN, so the build failed with HTTP 404.
