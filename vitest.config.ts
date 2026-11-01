import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		// live/ talks to the real CDNs and has its own config, vitest.live.config.ts.
		include: ["src/**/*.test.ts"],
		restoreMocks: true,
	},
});
