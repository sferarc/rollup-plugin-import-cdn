---
"rollup-plugin-import-cdn": patch
---

Apply `versions` to subpath and scoped specifiers by package name and place the version after the package name, so `react-dom/client` with `versions: { "react-dom": "18.2.0" }` resolves to `react-dom@18.2.0/client`. Custom CDN functions now receive the pinned version as a second argument.
