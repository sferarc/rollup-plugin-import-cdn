# Resolution

`resolveId(key, importer)` in `src/index.ts` calls `resolveDependency(key, options)` in `src/load.ts` and returns the original `key` when a CDN answered, or `undefined` so Rollup's other resolvers take over. The module id Rollup sees is therefore the bare specifier or the URL as written, and `load` receives the same string.

## Importer handling

The plugin keeps a map from each id it resolved to the `response.url` its source came from, cleared in `buildStart` with the fetch memo. When `key` starts with `./`, `../`, `/` or `//` (`isRelativeReference` in `src/load.ts`), and the importer is in that map or is itself an `http(s)` URL, `resolveId` resolves `key` against that URL and fetches the result as a URL specifier. This covers dynamic imports, which `loadHook` leaves as written ([[import-rewriting]]), so `import("./chunk.js")` inside `react` becomes the chunk's CDN URL rather than a path under cwd. A protocol-relative `//host/x.js` takes the importer's protocol, after redirects (`src/index.test.ts`, "takes the protocol from the redirected importer URL"). Before this, `//` keys hit the `isForeignId` check (`path.posix.isAbsolute` is true for them) and were left unresolved, so the bundle kept a broken import. Any other importer, such as a local file, leaves relative and absolute keys to Rollup without a fetch.

## Which specifiers the plugin claims

`resolveDependencyUrls` decides, in this order:

1. A specifier starting with `/`, `.` or `file://` is local: no URLs, so the plugin leaves it to Rollup.
2. A specifier matching `^(http(s)?:)?//` is a URL and is fetched as is. Protocol-relative `//host/...` never gets here, since rule 1 claims it first; it is only fetched after `resolveId` resolves it against a CDN importer.
3. Anything else is a package name. Each entry of `priority` (default `["skypack"]`) yields one URL: `"skypack"` gives `https://cdn.skypack.dev/<key>`, and a function gives `fn(key, version)`.

Outside the importer case above, a path without a leading `./` is treated as a package name.

## Version pinning

`splitSpecifier` in `src/load.ts` splits a bare specifier into the package name (`pkg` or `@scope/pkg`) and the rest. `pinnedVersion` looks up `versions` by the exact specifier first, then by the package name, so a pin on `react-dom` applies to `react-dom/client`. A specifier that carries its own version (`react-dom@18/client`) only takes an exact-specifier pin. The skypack builder puts the version after the package name, `https://cdn.skypack.dev/react-dom@18.2.0/client`, and leaves a specifier with its own version unchanged. Custom CDN functions get the same version as their second argument and build the URL themselves (`src/load.test.ts`, "should place the version for %s after the package name", "should pass the pinned version to a custom CDN resolver").

These URLs end the version with `/` or the string end, so `isPinnedUrl` matches them and the `cache` option applies ("should cache a subpath pinned through its package name").

## Fallback

`resolveDependency` tries the URLs in order and returns the first whose `fetchImpl` call and `text()` do not throw, recording `response.url` so redirects are followed for later rewriting ([[import-rewriting]]). A failure is logged with `console.debug`; when every URL fails it warns `Could not resolve dependency` and returns `null` (`src/load.test.ts`, "should try multiple CDNs in priority order", "should return null when all CDNs fail").

Adding a built-in CDN means extending `AvailableCDNs` in `src/types.ts` and the `parseCDN` map in `src/load.ts`. Skypack is the only one today.
