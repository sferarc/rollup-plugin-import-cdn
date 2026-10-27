---
"rollup-plugin-import-cdn": patch
---

Point `import.meta.url` inside a CDN module at the URL it was served from under Vite too. Vite 8 does not apply Rollup's `resolveImportMeta` hook, so `new URL("./mod.wasm", import.meta.url)` in a package fetched from the CDN resolved against the output chunk in `vite build` and against the dev server in `vite dev`. The plugin now writes the URL into the module when it loads it under Vite; Rollup builds are unchanged.
