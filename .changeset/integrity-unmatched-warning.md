---
"rollup-plugin-import-cdn": patch
---

Warn at the end of a build for each `integrity` entry that no URL fetched in that build matched. Bumping a version in `versions` without updating the `integrity` key that names the old URL left the new module unchecked with no sign of it; the warning names the stale key. The Vite dev server is skipped, since it loads modules on demand.
