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

### Version Pinning

```js
importCdn({
  versions: {
    react: "18.2.0",
    lodash: "4.17.21",
  },
});
```

A version set for a package also applies to its subpaths, and goes after the package name: with `versions: { "react-dom": "18.2.0" }`, `import "react-dom/client"` fetches `https://cdn.skypack.dev/react-dom@18.2.0/client`. Scoped packages work the same way, so `@scope/pkg/sub` with `"@scope/pkg": "1.0.0"` fetches `https://cdn.skypack.dev/@scope/pkg@1.0.0/sub`. An entry for the full specifier, such as `"react-dom/client"`, takes precedence over the package entry.

### Fetch Cache

```js
importCdn({
  cache: "node_modules/.cache/import-cdn",
  versions: { lodash: "4.17.21" },
});
```

With `cache` set, responses for URLs pinned to an exact version (`pkg@1.2.3`) are stored in that directory and reused by later builds. Unpinned URLs are always fetched.

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

## Documentation

For full documentation including configuration options, API reference, and examples, see the [documentation](https://sferadev.com/docs/packages/rollup-plugin-import-cdn).

## Development

The toolchain is pinned in `mise.toml`. With [mise](https://mise.jdx.dev) installed:

```bash
mise install
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Add a changeset with `pnpm changeset` for any change that should be released.

## License

ISC
