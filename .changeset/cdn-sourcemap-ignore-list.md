---
"rollup-plugin-import-cdn": patch
---

Put CDN modules on the output sourcemap's ignore list, as Rollup does for `node_modules`, so browser devtools skip them when stepping through code. Applies when `output.sourcemapIgnoreList` is unset, on Rollup 3.16 or newer and under Vite; a `sourcemapIgnoreList` of your own still decides for every source.
