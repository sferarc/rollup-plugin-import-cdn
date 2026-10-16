# rollup-plugin-import-cdn

Import ESM modules from URLs for local processing by Rollup, enabling tree-shaking on non-local resources.

## Features

- **CDN Imports** - Import npm packages directly from CDN URLs
- **Tree-shaking** - Full tree-shaking support for CDN modules
- **Multiple CDNs** - Support for Skypack with custom CDN fallback chains
- **Version Pinning** - Pin specific package versions for reproducible builds

## Installation

```bash
npm install rollup-plugin-import-cdn
```

## Quick Start

```js
import { importCdn } from "rollup-plugin-import-cdn";

export default {
  input: "src/index.js",
  output: { file: "dist/bundle.js", format: "esm" },
  plugins: [importCdn()],
};
```

Now you can import packages directly from URLs:

```js
// Resolved via Skypack by default
import { debounce } from "lodash-es";

// Direct URL import
import confetti from "https://esm.sh/canvas-confetti";
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `cache` | none | Directory for an on-disk cache of responses from pinned URLs. See [Fetch Cache](#fetch-cache). |
| `fetchImpl` | global `fetch` | Function used for every request: `(url, { signal }) => Promise<{ ok, status, url, text() }>`; `signal` is passed only while `timeout` is enabled. `importCdn` throws `No fetch implementation found` when it is not set and no global `fetch` exists. |
| `integrity` | none | SRI hashes that fetched code must match, keyed by URL. See [Integrity](#integrity). |
| `priority` | `["skypack"]` | CDNs to try, in order. Each entry is `"skypack"` or a function returning a URL; any other entry throws when the plugin is created. See [Custom CDN](#custom-cdn). |
| `timeout` | `30000` | Milliseconds each request may take, reading the body included, before it counts as a network error and the next CDN is tried. A failed or timed-out URL is not retried until the next build. `0` disables it. The plugin aborts the `signal` it passes to `fetchImpl` and stops waiting even if `fetchImpl` ignores it. |
| `versions` | none | Versions to pin, keyed by package name or full specifier. See [Version Pinning](#version-pinning). |

### Version Pinning

```js
importCdn({
  versions: {
    react: "18.2.0",
    lodash: "4.17.21",
  },
});
```

A version set for a package also applies to its subpaths, and goes after the package name: with `versions: { "react-dom": "18.2.0" }`, `import "react-dom/client"` fetches `https://cdn.skypack.dev/react-dom@18.2.0/client`. Scoped packages work the same way, so `@scope/pkg/sub` with `"@scope/pkg": "1.0.0"` fetches `https://cdn.skypack.dev/@scope/pkg@1.0.0/sub`. An entry for the full specifier, such as `"react-dom/client"`, takes precedence over the package entry. A specifier that carries its own version, such as `react@17/jsx-runtime`, ignores `versions`.

Only the built-in `"skypack"` entry applies the pin to its URL. A custom `priority` function receives the version as its second argument and decides how to use it.

### Fetch Cache

```js
importCdn({
  cache: "node_modules/.cache/import-cdn",
  versions: { lodash: "4.17.21" },
});
```

With `cache` set, responses for URLs pinned to an exact version are stored in that directory and reused by later builds. Unpinned URLs are always fetched.

A URL counts as pinned when its path contains `@` and a full `major.minor.patch` version, optionally followed by a prerelease suffix, a build suffix or both, ending at a `/` or the end of the path: `pkg@1.2.3`, `@scope/pkg@1.2.3/sub.js`, `pkg@1.2.3-beta.1`, `pkg@1.2.3+build` and `pkg@1.2.3-rc.1+build.5` are cached; `pkg@1.2`, `pkg@^1.2.3`, `pkg@~1.2.3` and `pkg@latest` are not. The query string and fragment are ignored, so `pkg@1.2.3?dev` is cached under its full URL, while `pkg@latest?alias=dep@1.2.3` is not. A custom `priority` function must therefore put `@x.y.z` in the path for its responses to be cached; a version passed as a query parameter is not enough. Each entry is written to a uniquely named temporary file and renamed into place, so concurrent builds sharing the directory leave one complete entry per URL.

### Integrity

```js
importCdn({
  versions: { lodash: "4.17.21" },
  integrity: {
    "https://cdn.skypack.dev/lodash@4.17.21": "sha384-<base64 digest>",
  },
});
```

Each entry maps a URL to a [Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity) value: `sha256-`, `sha384-` or `sha512-` followed by the base64 digest of the module source. The key can be the URL the plugin requests or the URL the CDN redirects to. When the fetched source does not match, the build fails with the URL and the expected and actual digests; the plugin does not fall back to the next CDN. Several space-separated hashes are accepted, and as in browsers only those using the strongest listed algorithm count, any one of them matching. URLs without an entry are not checked, and an invalid value throws when the plugin is created.

Compute a hash from the exact URL the plugin fetches:

```sh
curl -sL https://cdn.skypack.dev/lodash@4.17.21 | openssl dgst -sha384 -binary | openssl base64 -A
```

The hash covers the module text as `fetchImpl`'s `text()` returns it, encoded as UTF-8. For a UTF-8 module without a byte order mark that is the file as served, so the command above gives the right value.

Entries from the [fetch cache](#fetch-cache) are checked too, so a modified cache file fails the build instead of being bundled. A cache file also records the URL the module was served from, which relative imports inside it resolve against. For a requested URL with an entry, that recorded URL is only trusted when it equals the requested URL or has an entry of its own; otherwise the module is fetched again. So when the requested URL redirects, list the final URL as well to keep it cached. A cache file can name any final URL, so with `cache` set, key entries by the requested URL: an entry keyed only by the final URL is checked on every fetch but not on a cache read.

### Custom CDN

```js
importCdn({
  priority: [
    (pkg, version) => `https://esm.sh/${pkg}${version ? `?version=${version}` : ""}`,
    "skypack",
  ],
});
```

A custom function receives the specifier as written and, as its second argument, the version from `versions` that applies to it, if any.

## Behaviour

- **Fallback.** Each CDN in `priority` is tried in turn. A non-OK response, a network error or a request that exceeds `timeout` moves on to the next one.
- **Failures.** If no CDN succeeds and at least one answered with a non-OK status, the build fails with one line per attempted URL and its status or error, for example `Failed to fetch lodash-es from https://cdn.skypack.dev/lodash-es: HTTP 404`. If every attempt failed with a network error, the plugin emits a Rollup warning with the same lines and leaves the import for Rollup to handle. Each failed attempt is also logged at debug level, visible with `logLevel: "debug"`.
- **Transitive imports.** Relative, root-relative and protocol-relative static imports inside a CDN module are rewritten to absolute URLs, resolved against the URL the module was served from. Bare imports are left as written and go back through the plugin, so `versions` and `priority` apply to transitive dependencies too.
- **Dynamic imports.** A relative `import("./chunk.js")` inside a CDN module is resolved against the URL the module was served from, after redirects.

## Documentation

This README is the reference for the plugin's options and behaviour. The [CHANGELOG](CHANGELOG.md) lists changes by release.

## Development

The toolchain is pinned in `mise.toml`. With [mise](https://mise.jdx.dev) installed:

```bash
mise trust    # once per clone: mise refuses an untrusted mise.toml
mise install
pnpm install
pnpm check
```

`pnpm check` runs the same steps as CI's `Check` job, in the same order, and stops at the first failure: lint, hook config, knip, typecheck, test, build and the tree-shaking check.

Add a changeset with `pnpm changeset` for any change that should be released.

## License

ISC
