---
"rollup-plugin-import-cdn": minor
---

Add `"jsdelivr"` as a built-in `priority` entry. It builds `https://cdn.jsdelivr.net/npm/<name>@<version>/<subpath>/+esm` from `versions` the way `"skypack"` does, and skips specifiers with a scheme.
