---
"rollup-plugin-import-cdn": patch
---

With `cache` set, log each fetched URL that is not pinned to an exact version at debug level, as `Not caching <url>: it is not pinned to an exact version, so every build fetches it`, once per build. One build with `logLevel: "debug"` lists the imports, including esm.sh ranges and `/node/` polyfills, that still need the network.
