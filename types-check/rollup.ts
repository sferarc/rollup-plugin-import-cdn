// tsconfig.json here resolves the package to dist, so CI checks the published types on Rollup 3.0.
import type { InputOptions, Plugin } from "rollup";
import { importCdn } from "rollup-plugin-import-cdn";

export const plugin: Plugin = importCdn();

export const options: InputOptions = {
	plugins: [importCdn({ priority: ["esm.sh"], versions: { preact: "10.19.3" } })],
};
