---
"rollup-plugin-import-cdn": minor
---

Default `priority` to `["esm.sh"]` instead of `["skypack"]`. Skypack served React 17 for `import "react"` and for pinned React 18 and 19 versions, while esm.sh answers an unknown version with a 404 and serves pinned builds. Builds that rely on the default now fetch from `https://esm.sh/`, so `cache` entries are fetched again and `integrity` keys for `cdn.skypack.dev` URLs no longer match. Set `priority: ["skypack"]` to keep the old behaviour.
