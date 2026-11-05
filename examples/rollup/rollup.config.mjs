import { fileURLToPath } from "node:url";
import { importCdn } from "rollup-plugin-import-cdn";

// Resolved from this file, so the build and the committed cache work from any working directory.
const here = (path) => fileURLToPath(new URL(path, import.meta.url));

export default {
	input: here("main.js"),
	output: { file: here("dist/bundle.js"), format: "esm" },
	plugins: [
		importCdn({
			cache: here(".cdn-cache"),
			versions: { "lodash-es": "4.17.21" },
		}),
	],
};
