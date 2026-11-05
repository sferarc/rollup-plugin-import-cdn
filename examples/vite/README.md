# Vite example

A two file app, `index.html` and `main.js`, that imports `preact` by bare name and its hooks by esm.sh URL. Neither is installed: `importCdn()` in `vite.config.ts` fetches both from esm.sh at build time and bundles them with the app. `versions` pins `preact` to `10.19.3`, so every URL the build requests is pinned and served from `.cdn-cache`, which is committed. The build needs no network until a version changes.

From the repository root:

```bash
pnpm install
pnpm build
pnpm exec vite build examples/vite
```

`pnpm build` is needed because the config imports the plugin by its package name, which resolves to `dist/`. In your own project, `npm install rollup-plugin-import-cdn vite` replaces both steps.

After changing `versions` or the imports, delete `.cdn-cache` and build once with network access to refill it. The repository's tests build this example from the committed cache and fail if it requests anything (`src/examples.test.ts`).
