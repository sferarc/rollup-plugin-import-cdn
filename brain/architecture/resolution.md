# Resolution

`resolveId(key, importer)` in `src/index.ts` calls `resolveDependency(key, options)` in `src/load.ts` and returns the original `key` when a CDN answered, or `undefined` so Rollup's other resolvers take over. The module id Rollup sees is therefore the bare specifier or the URL as written, and `load` receives the same string.

## Importer handling

The plugin keeps a map from each id it resolved to the `response.url` its source came from, cleared in `buildStart` with the fetch memo. When `key` starts with `./`, `../` or a single `/`, and the importer is in that map or is itself an `http(s)` URL, `resolveId` resolves `key` against that URL and fetches the result as a URL specifier. This covers dynamic imports, which `loadHook` leaves as written ([[import-rewriting]]), so `import("./chunk.js")` inside `react` becomes the chunk's CDN URL rather than a path under cwd. Any other importer, such as a local file, leaves relative and absolute keys to Rollup without a fetch.

## Which specifiers the plugin claims

`resolveDependencyUrls` decides, in this order:

1. A specifier starting with `/`, `.` or `file://` is local: no URLs, so the plugin leaves it to Rollup.
2. A specifier matching `^(http(s)?:)?//` is a URL and is fetched as is. Protocol-relative `//host/...` counts.
3. Anything else is a package name. Each entry of `priority` (default `["skypack"]`) yields one URL: `"skypack"` gives `https://cdn.skypack.dev/<key>` plus `@<version>` when `versions[key]` is set, and a function gives `fn(key)`.

Outside the importer case above, a path without a leading `./` is treated as a package name. `versions` is looked up by the exact specifier, so a pin on `react` does not apply to `react/jsx-runtime`. A custom CDN function receives only the key, never the pinned version (`src/load.ts`).

## Fallback

`resolveDependency` tries the URLs in order and returns the first whose `fetchImpl` call and `text()` do not throw, recording `response.url` so redirects are followed for later rewriting ([[import-rewriting]]). A failure is logged with `console.debug`; when every URL fails it warns `Could not resolve dependency` and returns `null` (`src/load.test.ts`, "should try multiple CDNs in priority order", "should return null when all CDNs fail").

Adding a built-in CDN means extending `AvailableCDNs` in `src/types.ts` and the `parseCDN` map in `src/load.ts`. Skypack is the only one today.
