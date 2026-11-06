# Rolldown example

A Rolldown build of `main.js`, which imports `lodash-es/capitalize` by bare name and `uniq` by esm.sh URL. Neither is installed: `importCdn()` in `rolldown.config.mjs` fetches both from esm.sh at build time and bundles them, so `dist/bundle.js` imports nothing. The config is the same as the [Rollup example](../rollup)'s: Rolldown takes the plugin in `plugins` unchanged. `versions` pins `lodash-es` to `4.17.21`, and the pin applies to its `capitalize` subpath, so every URL the build requests is pinned and served from `.cdn-cache`, which is committed. The build needs no network until a version changes.

From the repository root:

```bash
pnpm install
pnpm build
pnpm exec rolldown -c examples/rolldown/rolldown.config.mjs
node examples/rolldown/dist/bundle.js
```

`pnpm build` is needed because the config imports the plugin by its package name, which resolves to `dist/`. In your own project, `npm install rollup-plugin-import-cdn rolldown` replaces both steps.

After changing `versions` or the imports, delete `.cdn-cache` and build once with network access to refill it. The repository's tests build this example from the committed cache and fail if it requests anything (`src/examples.test.ts`).
