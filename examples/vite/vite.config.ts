import { fileURLToPath } from "node:url";
import { importCdn } from "rollup-plugin-import-cdn";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		importCdn({
			// Resolved from this file, so the committed cache is used whatever the working directory.
			cache: fileURLToPath(new URL(".cdn-cache", import.meta.url)),
			versions: { preact: "10.19.3" },
		}),
	],
});
