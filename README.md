# rollup-plugin-import-cdn

Bundle ESM packages and URL imports from a CDN as if they were local code, so Rollup or Vite resolves, tree-shakes and bundles them instead of leaving them as external requests.

It is for builds that take packages from a CDN instead of `node_modules`: source that imports URLs such as `https://esm.sh/canvas-confetti`, sandboxes and playgrounds with no install step, and packages you would rather fetch as ESM than install. It works with Rollup 3 and 4, with Vite 8 in both `vite build` and `vite dev` (see [Vite](#vite)), and with Rolldown 1.2.16 and later (see [Rolldown](#rolldown)).

## Features

- **CDN imports:** bare names such as `lodash-es` and full URLs, fetched at build time and bundled with your code.
- **Tree-shaking:** CDN modules go through Rollup like local files, so unused exports are dropped.
- **Built-in CDNs:** esm.sh by default, with jsDelivr and Skypack also built in; `priority` sets which ones are tried and in what fallback order.
- **Custom resolvers:** a function in `priority` maps a specifier to any URL. See [Custom CDN](#custom-cdn).
- **Version pinning:** `versions` pins packages and their subpaths for reproducible builds. See [Version Pinning](#version-pinning).
- **Integrity:** `integrity` fails the build when fetched code does not match an SRI hash. See [Integrity](#integrity).
- **Fetch cache:** `cache` keeps responses for pinned URLs on disk, so later builds skip the network. See [Fetch Cache](#fetch-cache).

## When not to use it

- **Offline or network-free builds without `cache`.** Every build fetches every CDN module again unless `cache` is set, and only URLs pinned to an exact version are cached. Unpinned imports always hit the network.
- **Relying on `integrity` in `vite dev`.** Under the dev server, URL imports and the absolute URLs written into CDN modules are loaded by the browser straight from the CDN, so `integrity` does not check them. It covers `vite build` and Rollup builds.
- **Packages you already install.** A package in `node_modules` is better served from there; under Vite the plugin already prefers it.

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
// Resolved via esm.sh by default
import { debounce } from "lodash-es";

// Direct URL import
import confetti from "https://esm.sh/canvas-confetti";
```

[`examples/rollup`](examples/rollup) is a runnable Rollup build that imports `lodash-es/chunk` by bare name and `kebabCase` by esm.sh URL, with a pinned version and a committed `cache`, so it builds offline.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `cache` | none | Directory for an on-disk cache of responses from pinned URLs. See [Fetch Cache](#fetch-cache). |
| `fetchImpl` | global `fetch` | Function used for every request: `(url, { signal }) => Promise<{ ok, status, url, text() }>`; `signal` is passed only while `timeout` is enabled. `importCdn` throws `No fetch implementation found` when it is not set and no global `fetch` exists, and throws when it is set to anything other than a function. |
| `integrity` | none | SRI hashes that fetched code must match, keyed by URL. See [Integrity](#integrity). |
| `priority` | `["esm.sh"]` | CDNs to try, in order. Each entry is `"esm.sh"`, `"skypack"`, `"jsdelivr"` or a function returning a URL; any other entry throws when the plugin is created. Before 0.5.0 the default was `["skypack"]`; set `priority: ["skypack"]` to keep it. See [Custom CDN](#custom-cdn). |
| `timeout` | `30000` | Milliseconds each request may take, reading the body included, before it counts as a network error and the next CDN is tried. A failed or timed-out URL is not retried until the next build. `0` disables it; the largest accepted value is `2147483647`, the longest delay Node's `setTimeout` holds. The plugin aborts the `signal` it passes to `fetchImpl` and stops waiting even if `fetchImpl` ignores it. |
| `versions` | none | Versions to pin, keyed by package name or full specifier. Each value must be a non-empty string; anything else, or a `versions` that is not an object, throws when the plugin is created. See [Version Pinning](#version-pinning). |

### Version Pinning

```js
importCdn({
  versions: {
    react: "18.2.0",
    lodash: "4.17.21",
  },
});
```

A version set for a package also applies to its subpaths, and goes after the package name: with `versions: { "react-dom": "18.2.0" }`, `import "react-dom/client"` fetches `https://esm.sh/react-dom@18.2.0/client`. Scoped packages work the same way, so `@scope/pkg/sub` with `"@scope/pkg": "1.0.0"` fetches `https://esm.sh/@scope/pkg@1.0.0/sub`. An entry for the full specifier, such as `"react-dom/client"`, takes precedence over the package entry. A specifier that carries its own version, such as `react@17/jsx-runtime`, ignores `versions`. A query or fragment on the specifier is kept after the version: with `versions: { preact: "10.19.3" }`, `import "preact?dev"` fetches `https://esm.sh/preact@10.19.3?dev`, and `"jsdelivr"` puts it after `/+esm`.

The built-in `"skypack"`, `"esm.sh"` and `"jsdelivr"` entries apply the pin to their URLs. A custom `priority` function receives the version as its second argument and decides how to use it.

`"jsdelivr"` requests jsDelivr's ESM build, so `react-dom/client` pinned to `18.2.0` fetches `https://cdn.jsdelivr.net/npm/react-dom@18.2.0/client/+esm`. jsDelivr serves an unpinned package without redirecting to a version, while the modules it serves import their dependencies at an exact version, such as `/npm/react@19.3.1/+esm`. Pin every package you import through `"jsdelivr"`: otherwise `import "react"` and the React that `react-dom` imports are two URLs, and the bundle holds two copies.

### Fetch Cache

```js
importCdn({
  cache: "node_modules/.cache/import-cdn",
  versions: { lodash: "4.17.21" },
});
```

With `cache` set, responses for URLs pinned to an exact version are stored in that directory and reused by later builds. Unpinned URLs are always fetched.

A URL counts as pinned when its path contains `@` and a full `major.minor.patch` version, optionally followed by a prerelease suffix, a build suffix or both, ending at a `/` or the end of the path: `pkg@1.2.3`, `@scope/pkg@1.2.3/sub.js`, `pkg@1.2.3-beta.1`, `pkg@1.2.3+build` and `pkg@1.2.3-rc.1+build.5` are cached; `pkg@1.2`, `pkg@^1.2.3`, `pkg@~1.2.3` and `pkg@latest` are not. Skypack's own module paths, such as `/-/lodash@v4.17.21-<hash>/dist=es2019,mode=imports/optimized/lodash.js`, which a pinned Skypack URL imports for the actual code, are cached too, and so are the pinned URLs Skypack lists in its banner, such as `https://cdn.skypack.dev/pin/lodash@v4.17.21-<hash>/mode=imports/optimized/lodash.js`. The query string and fragment are ignored, so `pkg@1.2.3?dev` is cached under its full URL, while `pkg@latest?alias=dep@1.2.3` is not. A custom `priority` function must therefore put `@x.y.z` in the path for its responses to be cached; a version passed as a query parameter is not enough. esm.sh modules can import a dependency by range, such as `react-dom@18.2.0` importing `/scheduler@^0.23.0?target=es2022`, and Node polyfills such as `/node/process.mjs`; those URLs are not pinned, so they are fetched on every build. esm.sh's `deps` query pins such a dependency: with `versions: { "react-dom": "18.2.0" }`, `import "react-dom?deps=scheduler@0.23.2"` fetches `https://esm.sh/react-dom@18.2.0?deps=scheduler@0.23.2`, whose imports are all pinned. Each entry is written to a uniquely named temporary file and renamed into place, so concurrent builds sharing the directory leave one complete entry per URL.

### Integrity

```js
importCdn({
  versions: { lodash: "4.17.21" },
  integrity: {
    "https://esm.sh/lodash@4.17.21": "sha384-<base64 digest>",
  },
});
```

Each entry maps a URL to a [Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity) value: `sha256-`, `sha384-` or `sha512-` followed by the base64 digest of the module source. The key can be the URL the plugin requests or the URL the CDN redirects to. When the fetched source does not match, the build fails with the URL and the expected and actual digests; the plugin does not fall back to the next CDN. Several space-separated hashes are accepted, and as in browsers only those using the strongest listed algorithm count, any one of them matching. URLs without an entry are not checked. At the end of a build, each entry that no URL fetched in that build matched is reported as a Rollup warning naming its URL, so a key left at the old version after a bump in `versions` does not go unnoticed; with one `integrity` map shared by several builds, a build that does not import every listed URL warns for the rest. An invalid value throws when the plugin is created, and so does a key that is not an absolute URL, such as `lodash` or `//esm.sh/lodash@4.17.21`, since it could never match a fetched URL.

jsDelivr builds its `+esm` files on demand and advises against SRI for them, so a `"jsdelivr"` URL with an entry can fail the build after a rebuild on their side.

Compute a hash from the exact URL the plugin fetches:

```sh
curl -sL https://esm.sh/lodash@4.17.21 | openssl dgst -sha384 -binary | openssl base64 -A
```

To collect the values for a whole module graph, including the files an entry module imports, set `integrity: {}` and build once with `logLevel: "debug"`. For each module without an entry the plugin logs `No integrity entry for <url>: sha384-<digest>`, once for the requested URL and once for the URL it redirected to, if any, ready to copy into `integrity`. Nothing is logged for a module checked against an entry, or when `integrity` is not set.

The hash covers the module text as `fetchImpl`'s `text()` returns it, encoded as UTF-8. For a UTF-8 module without a byte order mark that is the file as served, so the command above gives the right value.

Entries from the [fetch cache](#fetch-cache) are checked too, so a modified cache file fails the build instead of being bundled. A cache file also records the URL the module was served from, which relative imports inside it resolve against. For a requested URL with an entry, that recorded URL is only trusted when it equals the requested URL or has an entry of its own; otherwise the module is fetched again. So when the requested URL redirects, list the final URL as well to keep it cached. A cache file can name any final URL, so with `cache` set, key entries by the requested URL: an entry keyed only by the final URL is checked on every fetch but not on a cache read.

### Custom CDN

```js
importCdn({
  priority: [
    (pkg, version) =>
      `https://cdn.example.com/${version ? pkg.replace(/^(@[^/]+\/)?[^/]+/, `$&@${version}`) : pkg}`,
    "esm.sh",
  ],
});
```

A custom function receives the specifier as written and, as its second argument, the version from `versions` that applies to it, if any. That includes a specifier with a scheme other than `http(s):`, such as `npm:react` or `virtual:x`, which the built-in entries skip because it is not an npm name.

A function must return an absolute URL or `undefined`; anything else, such as a relative path, fails the build. A function that returns `undefined` skips the specifier, and the next entry in `priority` is tried without a request. When every entry skips it, the import is left to the next plugin or to Rollup, with no fetch and no warning:

```js
importCdn({
  priority: [(key) => (key.startsWith("npm:") ? `https://esm.sh/${key.slice(4)}` : undefined)],
});
```

## Behaviour

- **Fallback.** Each CDN in `priority` is tried in turn. A non-OK response, a network error or a request that exceeds `timeout` moves on to the next one.
- **Failures.** A Skypack response redirected to `https://cdn.skypack.dev/error/build:...`, Skypack's answer for a package it cannot build, counts as a non-OK status even though it is HTTP 200, and so does a Skypack response for an exact version such as `react@18.2.0` whose code imports a different version of that package. The same goes for a jsDelivr `+esm` file that jsDelivr could not bundle, which it serves with HTTP 200 as a module that throws `Failed to bundle using ...`; the build error names jsDelivr's reason. So does any HTTP 200 response whose body is an HTML page (it starts with `<!doctype html>`, `<html>`, `<head>` or `<body>`), such as a captive portal or a CDN's error page, and such a page is never written to the [fetch cache](#fetch-cache). If no CDN succeeds and at least one answered with a non-OK status, the build fails with one line per attempted URL and its status or error, for example `Failed to fetch lodash-es from https://cdn.skypack.dev/lodash-es: HTTP 404`. If every attempt failed with a network error, the plugin emits a Rollup warning with the same lines and leaves the import for Rollup to handle. Each failed attempt is also logged at debug level, visible with `logLevel: "debug"`.
- **Transitive imports.** Relative, root-relative and protocol-relative static imports inside a CDN module are rewritten to absolute URLs, resolved against the URL the module was served from. Bare imports are left as written and go back through the plugin, so `versions` and `priority` apply to transitive dependencies too.
- **Dynamic imports.** A relative `import("./chunk.js")` inside a CDN module is resolved against the URL the module was served from, after redirects.
- **Sourcemaps.** With `output.sourcemap` set, a CDN module is listed in the map's `sources` under the URL it was served from, such as `https://esm.sh/react@18.2.0/es2022/react.mjs`, rather than a path under the working directory. Its source content is the module as bundled, with its imports rewritten. An `output.sourcemapPathTransform` of your own still runs for local sources and is not called for CDN ones. CDN modules are also put on the map's ignore list (`x_google_ignoreList`), as Rollup does for `node_modules`, so browser devtools skip them when stepping through code; this needs Rollup 3.16 or newer. Setting `output.sourcemapIgnoreList` yourself, to a function or `false`, replaces this for every source.

## Vite

`importCdn()` also works as a Vite plugin for `vite build`, tested with Vite 8.1 and later. It sets `enforce: "pre"`, since Vite's own resolver marks every URL import external; for a bare name it asks Vite's resolver first, so a package installed in `node_modules` is used from there and only names Vite cannot resolve are fetched. Inside CDN modules, `import.meta.url` becomes the CDN URL the module was served from under Vite as well, in `vite build` and `vite dev`; only the `import.meta.url` form is replaced, so a computed `import.meta["url"]` keeps Vite's value.

Under `vite dev`, a fetched package is served by the dev server at `/@id/<name>`, and bare imports inside it come back through the plugin. URL imports, and the absolute URLs the plugin writes into CDN modules for their relative imports, are left for the browser to load from the CDN, so `integrity` does not cover them in dev. A request that failed with a network error, a timeout, an HTTP 408, 429 or 5xx, or an HTML page is fetched again on the next page load rather than kept until the server restarts; any other status, such as a 404, is kept.

`importCdn()` is typed so that both Rollup's and Vite 8's `Plugin` types accept it, so a TypeScript `vite.config.ts` takes `plugins: [importCdn()]` without a cast.

`vite build --watch` rebuilds through the plugin like a fresh build: every CDN module is fetched again on each rebuild, as under `rollup --watch`. Set `cache` to read pinned URLs from disk instead.

[`examples/vite`](examples/vite) is a runnable Vite app that imports `preact` by bare name and by esm.sh URL, with pinned versions and a committed `cache`, so it builds offline.

## Rolldown

`importCdn()` works as a Rolldown plugin as well, tested with Rolldown 1.2.16 and later: pass it in `plugins` as with Rollup. Rolldown does not call Rollup's `resolveImportMeta` hook, so the plugin writes the served URL in place of `import.meta.url` inside CDN modules itself, as under Vite.

[`examples/rolldown`](examples/rolldown) is a runnable Rolldown build that imports `lodash-es` by bare name and by esm.sh URL, with pinned versions and a committed `cache`, so it builds offline.

## TypeScript

`tsc` checks your sources before the bundler runs, and it cannot see what the plugin fetches, so a CDN import fails with `TS2307: Cannot find module` until you give it types.

For a bare name such as `lodash-es`, install only its types as a dev dependency: `npm install -D @types/lodash-es`. TypeScript resolves `import { debounce } from "lodash-es"` to them while the code still comes from the CDN, since nothing installs `lodash-es` itself. For a package that ships its own types there is no types-only package, so type it as a URL import below; installing the package makes Vite use it from `node_modules` instead of the CDN.

For a URL import, declare the URL as a module in a `.d.ts` file your `tsconfig.json` includes, and re-export the types of the package it serves:

```ts
// cdn-modules.d.ts: no top-level import or export, or TypeScript reads these as augmentations and rejects the URLs.
declare module "https://esm.sh/canvas-confetti" {
  export { default } from "canvas-confetti";
}

// Any other esm.sh import, typed as `any`.
declare module "https://esm.sh/*";
```

Here `canvas-confetti` resolves to `@types/canvas-confetti`, installed as a dev dependency. The wildcard line is the fallback for URLs you have no types for; it accepts any use of them. [`types-check/cdn-imports.ts`](types-check/cdn-imports.ts) is checked against this pattern in CI.

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
