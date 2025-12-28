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

### Custom CDN

```js
importCdn({
  priority: [
    (pkg) => `https://esm.sh/${pkg}`,
    "skypack",
  ],
});
```

## Documentation

For full documentation including configuration options, API reference, and examples, see the [documentation](https://sferadev.com/docs/packages/rollup-plugin-import-cdn).

## License

ISC
