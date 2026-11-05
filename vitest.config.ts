import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	// examples/ imports the plugin by its package name, which would otherwise need a built dist/.
	resolve: {
		alias: {
			"rollup-plugin-import-cdn": fileURLToPath(new URL("./src/index.ts", import.meta.url)),
		},
	},
	test: {
		environment: "node",
		// live/ talks to the real CDNs and has its own config, vitest.live.config.ts.
		include: ["src/**/*.test.ts"],
		restoreMocks: true,
	},
});
