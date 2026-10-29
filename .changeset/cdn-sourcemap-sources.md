---
"rollup-plugin-import-cdn": patch
---

Name each CDN module in an output sourcemap by the URL it was served from. Rollup resolved the module id against the working directory, so `sources` held paths such as `../https:/cdn.skypack.dev/...` or `../lodash` that no tool could open. A `sourcemapPathTransform` set in the output options still applies to local sources.
