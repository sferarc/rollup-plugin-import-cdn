---
"rollup-plugin-import-cdn": patch
---

An entry id that cannot be a file name, such as a `virtual:` id with a segment over 255 characters, is now passed on to the next plugin instead of failing the build with `ENAMETOOLONG` from the check for a cwd-relative entry.
