---
"rollup-plugin-import-cdn": patch
---

Bundle URL imports under Vite. Vite's resolver ran before the plugin and marked every `https://` import external, so a direct URL import and the absolute URLs the plugin writes into CDN modules stayed as runtime imports instead of being bundled and tree-shaken. The plugin now sets `enforce: "pre"`; under Vite it still lets Vite resolve bare names first, so installed packages and Vite's own modules are unchanged, and it only loads ids it resolved itself, so another plugin's virtual module no longer reaches the CDN.
