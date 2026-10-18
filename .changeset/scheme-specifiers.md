---
"rollup-plugin-import-cdn": patch
---

Stop requesting specifiers with a scheme, such as `virtual:greeting` or `data:...`, from Skypack, which only serves npm package names. With this plugin listed before the plugin that owns a `virtual:` module, the build used to fail with HTTP 404 from `https://cdn.skypack.dev/virtual:greeting`. A custom `priority` function still receives these specifiers.
