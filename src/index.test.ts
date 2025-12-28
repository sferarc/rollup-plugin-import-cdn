import { describe, expect, it, vi } from "vitest";
import { importCdn } from "./index";
import type { FetchImpl } from "./types";

const createMockFetch = (responses: Record<string, string>): FetchImpl => {
	return async (url: string) => {
		const content = responses[url];
		if (!content) {
			throw new Error(`Not found: ${url}`);
		}
		return {
			ok: true,
			url,
			text: async () => content,
		};
	};
};

describe("importCdn", () => {
	it("should create a rollup plugin with correct name", () => {
		const plugin = importCdn({
			fetchImpl: createMockFetch({}),
		});

		expect(plugin.name).toBe("plugin-import-cdn");
	});

	it("should throw error when no fetch implementation available", () => {
		const originalFetch = globalThis.fetch;
		// @ts-expect-error - intentionally removing fetch
		globalThis.fetch = undefined;

		expect(() => importCdn()).toThrow(
			"A fetch implementation is required for plugin-import-cdn to work.",
		);

		globalThis.fetch = originalFetch;
	});

	it("should use global fetch when available", () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			url: "https://cdn.skypack.dev/test",
			text: async () => "export const test = true;",
		});

		const originalFetch = globalThis.fetch;
		globalThis.fetch = mockFetch as unknown as typeof fetch;

		const plugin = importCdn();
		expect(plugin.name).toBe("plugin-import-cdn");

		globalThis.fetch = originalFetch;
	});

	it("should use provided fetchImpl over global fetch", async () => {
		const customFetch = createMockFetch({
			"https://cdn.skypack.dev/custom": 'export const custom = "yes";',
		});

		const plugin = importCdn({ fetchImpl: customFetch });

		const resolveId = plugin.resolveId as (id: string) => Promise<string | undefined>;
		const result = await resolveId("custom");

		expect(result).toBe("custom");
	});

	describe("resolveId hook", () => {
		it("should resolve CDN package names", async () => {
			const plugin = importCdn({
				fetchImpl: createMockFetch({
					"https://cdn.skypack.dev/lodash": 'export const _ = "lodash";',
				}),
			});

			const resolveId = plugin.resolveId as (id: string) => Promise<string | undefined>;
			const result = await resolveId("lodash");

			expect(result).toBe("lodash");
		});

		it("should return undefined for local imports", async () => {
			const plugin = importCdn({
				fetchImpl: createMockFetch({}),
			});

			const resolveId = plugin.resolveId as (id: string) => Promise<string | undefined>;

			expect(await resolveId("./local")).toBeUndefined();
			expect(await resolveId("/absolute")).toBeUndefined();
			expect(await resolveId("../parent")).toBeUndefined();
		});

		it("should return undefined for unresolvable packages", async () => {
			vi.spyOn(console, "warn").mockImplementation(() => {});

			const plugin = importCdn({
				fetchImpl: createMockFetch({}),
			});

			const resolveId = plugin.resolveId as (id: string) => Promise<string | undefined>;
			const result = await resolveId("nonexistent");

			expect(result).toBeUndefined();
		});
	});

	describe("load hook", () => {
		it("should load module content from CDN", async () => {
			const moduleContent = "export const value = 42;";
			const plugin = importCdn({
				fetchImpl: createMockFetch({
					"https://cdn.skypack.dev/my-package": moduleContent,
				}),
			});

			const load = plugin.load as (id: string) => Promise<string | undefined>;
			const result = await load("my-package");

			expect(result).toBe(moduleContent);
		});

		it("should transform relative imports to absolute URLs", async () => {
			const moduleContent = 'import { util } from "./util.js";\nexport { util };';
			const plugin = importCdn({
				fetchImpl: createMockFetch({
					"https://cdn.skypack.dev/my-package": moduleContent,
				}),
			});

			const load = plugin.load as (id: string) => Promise<string | undefined>;
			const result = await load("my-package");

			expect(result).toContain("https://cdn.skypack.dev/util.js");
		});
	});

	describe("options", () => {
		it("should respect custom priority", async () => {
			const plugin = importCdn({
				fetchImpl: createMockFetch({
					"https://esm.sh/react": "export const React = {};",
				}),
				priority: [(key) => `https://esm.sh/${key}`],
			});

			const resolveId = plugin.resolveId as (id: string) => Promise<string | undefined>;
			const result = await resolveId("react");

			expect(result).toBe("react");
		});

		it("should respect version pinning", async () => {
			const plugin = importCdn({
				fetchImpl: createMockFetch({
					"https://cdn.skypack.dev/react@18.2.0": "export const React = {};",
				}),
				versions: {
					react: "18.2.0",
				},
			});

			const resolveId = plugin.resolveId as (id: string) => Promise<string | undefined>;
			const result = await resolveId("react");

			expect(result).toBe("react");
		});
	});
});
