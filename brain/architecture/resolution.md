# Resolution

`resolveId(key, importer)` in `src/index.ts` calls `resolveDependency(key, options)` in `src/load.ts` and returns `dependency.name` when a CDN answered, or `undefined` so Rollup's other resolvers take over. `dependency.name` is the key `resolveDependency` was given: the bare specifier or URL as written, or, in the importer case below, the absolute URL the key resolved to (`src/index.test.ts`, "resolves a relative dynamic import against the CDN module's URL"). `load` receives that id and fetches it again through `loadHook`, which the per-build fetch memo answers without a second request (#14, "fetches a module once for resolveId followed by load").

## Importer handling

The plugin keeps a map from each id it resolved to the `response.url` its source came from, cleared in `buildStart` with the fetch memo. When `key` starts with `./`, `../`, `/` or `//` (`isRelativeReference` in `src/load.ts`), and the importer is in that map or is itself an `http(s)` URL, `resolveId` resolves `key` against that URL and fetches the result as a URL specifier. This covers dynamic imports, which `loadHook` leaves as written ([[import-rewriting]]), so `import("./chunk.js")` inside `react` becomes the chunk's CDN URL rather than a path under cwd. A protocol-relative `//host/x.js` takes the importer's protocol, after redirects (`src/index.test.ts`, "takes the protocol from the redirected importer URL"). Before this, `//` keys hit the `isForeignId` check (`path.posix.isAbsolute` is true for them) and were left unresolved, so the bundle kept a broken import. Any other importer, such as a local file, leaves relative and absolute keys to Rollup without a fetch.

## Which specifiers the plugin claims

`isForeignId` in `src/index.ts` (#14) runs first: `resolveId` and `load` return `undefined` without a fetch for an id that starts with `\0` (another plugin's virtual module) or `node:`, names a Node builtin (`builtinModules`), or is a posix or win32 absolute path (`src/index.test.ts`, "skips %s without fetching" for `\0virtual`, `node:fs`, `fs` and `C:\a\b.js`). The one exception is the importer case above, which `resolveId` checks before `isForeignId`, so a relative or root-relative key whose importer has a known URL is still resolved. `load` has no importer and always applies the check; the `https:` ids that case produces pass it.

For the remaining keys, `resolveDependencyUrls` in `src/load.ts` decides, in this order:

1. A specifier starting with `/`, `.` or `file://` is local: no URLs, so the plugin leaves it to Rollup.
2. A specifier matching `^(http(s)?:)?//` is a URL and is fetched as is. Protocol-relative `//host/...` never gets here, since rule 1 claims it first; it is only fetched after `resolveId` resolves it against a CDN importer.
3. Anything else is a package name. Each entry of `priority` (default `["skypack"]`) yields one URL: `"skypack"` gives `https://cdn.skypack.dev/<key>`, and a function gives `fn(key, version)`.

Outside the importer case above, a path without a leading `./` is treated as a package name.

## Version pinning

`splitSpecifier` in `src/load.ts` splits a bare specifier into the package name (`pkg` or `@scope/pkg`) and the rest. `pinnedVersion` looks up `versions` by the exact specifier first, then by the package name, so a pin on `react-dom` applies to `react-dom/client`. A specifier that carries its own version (`react-dom@18/client`) only takes an exact-specifier pin. The skypack builder puts the version after the package name, `https://cdn.skypack.dev/react-dom@18.2.0/client`, and leaves a specifier with its own version unchanged. Custom CDN functions get the same version as their second argument and build the URL themselves (`src/load.test.ts`, "should place the version for %s after the package name", "should pass the pinned version to a custom CDN resolver").

These URLs end the version with `/` or the string end, so `isPinnedUrl` matches them and the `cache` option applies ("should cache a subpath pinned through its package name").

## Fallback

`resolveDependency` tries the URLs in order. When `cache` is set and the URL matches `isPinnedUrl`, `readCache` runs before the fetch and a valid entry returns its `url` and `main` without one; after a successful fetch, `writeCache` stores them (#7, `src/load.test.ts`, "should not refetch a pinned URL on the next resolve", "should not cache error responses").

A missing cache file is silent. Any other read failure (invalid JSON, `EACCES`, `EISDIR`) or an entry without an http(s) `url` and a string `main` emits one warning naming the cache file, the CDN URL and the reason, then falls through to the fetch. A failed write warns the same way and removes its temporary file. No cache failure throws (#29, "should resolve without output when the cache entry is missing", "should warn once and refetch when the cache entry is not JSON", "should warn and leave no temporary file when the cache directory cannot be created"). Before #29 read failures were silent and write failures went to `console.debug`.

Warnings and debug messages go through a `Logger` (`warn`, `debug`) that `resolveDependency` and `loadHook` take as an optional last argument and drop when omitted. The plugin passes one wired to the hook context: `this.warn`, which Rollup tags with `code: "PLUGIN_WARNING"` and `plugin: "plugin-import-cdn"` and routes to `onwarn`/`onLog`, and `this.debug`, skipped on Rollup 3 before 3.25 where it does not exist (`src/index.ts` `contextLogger`). Every failed attempt, HTTP or network, is logged at debug level before the next CDN is tried. No `console` call remains in `src/` outside tests ("reports CDN network errors through Rollup's log handlers" in `src/rollup.test.ts`, "should drop debug messages on a Rollup without this.debug" in `src/index.test.ts`). Before this, both warnings used `console.warn` and bypassed Rollup's log handlers.

Otherwise it calls `fetchImpl`. The first OK response whose `text()` does not throw wins, and its `response.url` is recorded so redirects are followed for later rewriting ([[import-rewriting]]). Every other attempt is recorded with its URL and reason, and the next URL is tried: `HTTP <status>` for a non-OK response (#6, 803e533), or the thrown error's message with its `cause` message in parentheses, since undici's `fetch failed` keeps the DNS, TLS or proxy reason there ("should try multiple CDNs in priority order", "should fall back to the next CDN when one responds with an error").

When no URL succeeds and any CDN answered non-OK, it throws an error with one `[rollup-plugin-import-cdn] Failed to fetch <name> from <url>: <reason>` line per attempt, network failures included, and `cause` set to the last thrown error; the build fails ("should throw naming the URL and status when the CDN responds with an error", "should throw listing every attempt when HTTP and network failures mix"). Only when every attempt threw does it warn `Could not resolve dependency <name>`, through the logger above, followed by the same lines and return `null` ("should return null when all CDNs fail", "should warn with every URL and the underlying cause when all CDNs are unreachable"). Before #25, thrown errors went to `console.debug`, the warning named no URL, and the thrown error named only the last non-OK URL.

Adding a built-in CDN means extending `AvailableCDNs` in `src/types.ts` and the `parseCDN` map in `src/load.ts`. Skypack is the only one today.
