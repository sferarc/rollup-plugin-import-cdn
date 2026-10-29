---
"rollup-plugin-import-cdn": patch
---

Keep the `versions` pin for a bare specifier with a query or fragment, such as `preact?dev`, and place the version before the query, so it resolves to `preact@10.19.3?dev` instead of dropping the pin. The `jsdelivr` entry puts the query after `/+esm`.
