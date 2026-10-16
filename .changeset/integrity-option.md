---
"rollup-plugin-import-cdn": minor
---

Add an `integrity` option that maps CDN URLs to Subresource Integrity hashes. A fetched or cached module whose source does not match fails the build, so a compromised CDN or a modified cache file cannot slip into the bundle.
