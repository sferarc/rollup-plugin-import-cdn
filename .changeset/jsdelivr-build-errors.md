---
"rollup-plugin-import-cdn": patch
---

Treat a jsDelivr `+esm` file that jsDelivr could not bundle as a failed attempt. jsDelivr serves it with HTTP 200 as a module that throws `Failed to bundle using ...`, so the build used to pass and the bundle threw at runtime. The plugin now tries the next CDN, fails the build with jsDelivr's reason when none succeeds, and neither caches that module under a pinned URL nor uses one cached by an earlier version.
