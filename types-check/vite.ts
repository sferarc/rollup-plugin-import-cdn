import { importCdn } from "rollup-plugin-import-cdn";
import type { Plugin, UserConfig } from "vite";

export const plugin: Plugin = importCdn();

export const config: UserConfig = {
	plugins: [importCdn({ priority: ["esm.sh"], versions: { preact: "10.19.3" } })],
};
