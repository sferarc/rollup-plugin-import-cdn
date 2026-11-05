# Rollup example

A Rollup build of `main.js`, which imports `lodash-es/chunk` by bare name and `kebabCase` by esm.sh URL. Neither is installed: `importCdn()` in `rollup.config.mjs` fetches both from esm.sh at build time and bundles them, so `dist/bundle.js` imports nothing. `versions` pins `lodash-es` to `4.17.21`, and the pin applies to its `chunk` subpath, so every URL the build requests is pinned and served from `.cdn-cache`, which is committed. The build needs no network until a version changes.

From the repository root:

```bash
pnpm install
pnpm build
pnpm exec rollup -c examples/rollup/rollup.config.mjs
node examples/rollup/dist/bundle.js
```

`pnpm build` is needed because the config imports the plugin by its package name, which resolves to `dist/`. In your own project, `npm install rollup-plugin-import-cdn rollup` replaces both steps.

After changing `versions` or the imports, delete `.cdn-cache` and build once with network access to refill it. The repository's tests build this example from the committed cache and fail if it requests anything (`src/examples.test.ts`).
