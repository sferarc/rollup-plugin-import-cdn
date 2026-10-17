---
"rollup-plugin-import-cdn": patch
---

Read only the `versions` option's own entries. With any `versions` set, a package named after an `Object.prototype` member, such as `constructor`, was fetched from `constructor@function Object() { [native code] }`, and a custom `priority` function received that function as its version.
