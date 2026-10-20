---
"rollup-plugin-import-cdn": patch
---

Resolve escape sequences in a relative import specifier of a CDN module before rewriting it. The lexer reports the raw text between the quotes, so `"./a.js"` was resolved as `./a.js`, which URL parsing turns into `//u0061.js`, and the import pointed at the wrong URL. The rewritten URL also has quotes, backticks and backslashes percent-encoded so it cannot end the string literal it is written into.
