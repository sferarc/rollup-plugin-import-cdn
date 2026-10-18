---
"rollup-plugin-import-cdn": patch
---

Point `import.meta.url` inside a CDN module at the URL the module was served from. Bundled, it used to name the output chunk, so `new URL("./mod.wasm", import.meta.url)` in a package fetched from the CDN resolved to a file next to the bundle instead of the CDN. `import.meta.url` in local modules is unchanged.
