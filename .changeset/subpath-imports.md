---
"rollup-plugin-import-cdn": patch
---

Stop requesting package.json subpath imports such as `#internal` from Skypack. A specifier starting with `#` is never an npm package name, and the plugin used to request `https://cdn.skypack.dev/#internal`, which drops everything after `#` as a URL fragment, so the build failed or bundled the wrong response instead of leaving the import to the plugin listed after it. A custom `priority` function still receives these specifiers.
