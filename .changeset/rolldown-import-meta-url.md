---
"rollup-plugin-import-cdn": patch
---

Support standalone Rolldown. Rolldown never calls `resolveImportMeta`, so `import.meta.url` inside a CDN module named the output chunk instead of the CDN URL; the plugin now inlines the served URL there, as it already did under Vite 8. `package.json` declares Rolldown `^1.2.16` in `compatiblePackages` for the Vite plugin registry.
