---
"rollup-plugin-import-cdn": minor
---

Add `"esm.sh"` as a built-in `priority` entry. It builds `https://esm.sh/<name>@<version>/<subpath>` from `versions` the way `"skypack"` does, and skips specifiers with a scheme.
