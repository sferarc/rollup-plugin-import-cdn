import type { InputOptions, Plugin } from "rolldown";
import { importCdn } from "rollup-plugin-import-cdn";

export const plugin: Plugin = importCdn();

export const options: InputOptions = {
	plugins: [importCdn({ priority: ["esm.sh"], versions: { preact: "10.19.3" } })],
};
