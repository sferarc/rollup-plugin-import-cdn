---
"rollup-plugin-import-cdn": patch
---

With `integrity` set, log the `sha384-` value of each fetched or cached module that has no entry at debug level, as `No integrity entry for <url>: sha384-<digest>`. Setting `integrity: {}` and building once with `logLevel: "debug"` gives every value a module graph needs, including the files an entry module imports, instead of running `curl` per URL.
