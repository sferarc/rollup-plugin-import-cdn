---
"rollup-plugin-import-cdn": patch
---

Reject a `timeout` above 2147483647 when the plugin is created. Node runs a longer `setTimeout` after 1ms, so a value such as `Number.MAX_SAFE_INTEGER` timed out every request at once and failed over through every CDN.
