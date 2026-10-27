---
"rollup-plugin-import-cdn": patch
---

Under `vite dev`, also retry a CDN request that answered HTTP 408, 429 or 5xx on the next page load. Only network errors and timeouts were retried, so a CDN outage that returned 503 kept failing the import until the server restarted. A 404 is still kept for the server's lifetime.
