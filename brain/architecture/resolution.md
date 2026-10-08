# Resolution

`resolveId(key)` in `src/index.ts` calls `resolveDependency(key, options)` in `src/load.ts` and returns the original `key` when a CDN answered, or `undefined` so Rollup's other resolvers take over. The module id Rollup sees is therefore the bare specifier or the URL as written, and `load` receives the same string.

## Which specifiers the plugin claims

`resolveDependencyUrls` decides, in this order:

1. A specifier starting with `/`, `.` or `file://` is local: no URLs, so the plugin leaves it to Rollup.
2. A specifier matching `^(http(s)?:)?//` is a URL and is fetched as is. Protocol-relative `//host/...` counts.
3. Anything else is a package name. Each entry of `priority` (default `["skypack"]`) yields one URL: `"skypack"` gives `https://cdn.skypack.dev/<key>` plus `@<version>` when `versions[key]` is set, and a function gives `fn(key)`.

The importer is not consulted, so a path without a leading `./` is treated as a package name. `versions` is looked up by the exact specifier, so a pin on `react` does not apply to `react/jsx-runtime`. A custom CDN function receives only the key, never the pinned version (`src/load.ts`).

## Fallback

`resolveDependency` tries the URLs in order and returns the first whose `fetchImpl` call and `text()` do not throw and whose response has `ok` set, recording `response.url` so redirects are followed for later rewriting ([[import-rewriting]]). A failure is logged with `console.debug`; when every URL fails it warns `Could not resolve dependency` and returns `null` (`src/load.test.ts`, "should try multiple CDNs in priority order", "should return null when all CDNs fail"). A non-OK status, such as a 404 error page, is treated the same as a thrown fetch ("should skip a CDN that answers with a non-OK status").

Adding a built-in CDN means extending `AvailableCDNs` in `src/types.ts` and the `parseCDN` map in `src/load.ts`. Skypack is the only one today.
