---
"rollup-plugin-import-cdn": minor
---

Let a custom `priority` function return `undefined` to skip a specifier. The next entry is tried without a request, and a specifier every entry skips is left to the next plugin with no warning. Before, the function had to return a URL, and `undefined` was passed to `fetchImpl`, which with the global `fetch` failed as a network error and was warned about.
