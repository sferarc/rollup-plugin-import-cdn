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
| `fetchImpl` | global `fetch` | Function used for every request: `(url) => Promise<{ ok, status, url, text() }>`. `importCdn` throws `No fetch implementation found` when it is not set and no global `fetch` exists. |
| `priority` | `["skypack"]` | CDNs to try, in order. Each entry is `"skypack"` or a function returning a URL; any other entry throws when the plugin is created. See [Custom CDN](#custom-cdn). |
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

With `cache` set, responses for URLs pinned to an exact version (`pkg@1.2.3`) are stored in that directory and reused by later builds. Unpinned URLs are always fetched. The check is on the URL path, so a custom `priority` function must put `@x.y.z` in the path for its responses to be cached; a version passed as a query parameter is not enough.

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

- **Fallback.** Each CDN in `priority` is tried in turn. A non-OK response or a network error moves on to the next one.
- **Failures.** If no CDN succeeds and at least one answered with a non-OK status, the build fails with one line per attempted URL and its status or error, for example `Failed to fetch lodash-es from https://cdn.skypack.dev/lodash-es: HTTP 404`. If every attempt failed with a network error, the plugin emits a Rollup warning with the same lines and leaves the import for Rollup to handle. Each failed attempt is also logged at debug level, visible with `logLevel: "debug"`.
- **Transitive imports.** Relative, root-relative and protocol-relative static imports inside a CDN module are rewritten to absolute URLs, resolved against the URL the module was served from. Bare imports are left as written and go back through the plugin, so `versions` and `priority` apply to transitive dependencies too.
- **Dynamic imports.** A relative `import("./chunk.js")` inside a CDN module is resolved against the URL the module was served from, after redirects.

## Documentation

For full documentation including configuration options, API reference, and examples, see the [documentation](https://sferadev.com/docs/packages/rollup-plugin-import-cdn).

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
