---
"rollup-plugin-import-cdn": patch
---

Type `importCdn()` so that Vite 8's `Plugin` type accepts it. It returned Rollup's `Plugin` type, whose hook context Vite 8 (typed against Rolldown) does not match, so a TypeScript `vite.config.ts` needed `importCdn() as unknown as PluginOption`. The cast is no longer needed, and the plugin is still assignable to Rollup 3 and 4's `Plugin`.
