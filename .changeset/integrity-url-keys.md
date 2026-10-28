---
"rollup-plugin-import-cdn": patch
---

Throw when the plugin is created with an `integrity` key that is not an absolute URL, such as `lodash` or `//cdn.skypack.dev/lodash@4.17.21`. Entries are matched against the URLs the plugin fetches, so such a key never matched and the module was bundled unchecked.
