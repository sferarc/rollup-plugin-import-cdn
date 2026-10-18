---
"rollup-plugin-import-cdn": patch
---

Keep `import.meta.url` in a CDN module pointed at its served URL on a rebuild from Rollup's cache, as in watch mode. The rebuild reused Rollup's cached resolutions, skipped the plugin's `resolveId` for unchanged modules, and left `import.meta.url` naming the output chunk again.
