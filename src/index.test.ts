import { describe, expect, it, vi } from "vitest";
import { importCdn } from "./index";
import { fakeContext, hooks } from "./test-utils";
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
			"[rollup-plugin-import-cdn] No fetch implementation found. Run Rollup on a Node version with a global fetch, or pass one as the fetchImpl option.",
		);

		globalThis.fetch = originalFetch;
	});

	describe("option validation", () => {
		const fetchImpl = createMockFetch({});

		it("rejects an unknown CDN name in priority", () => {
			expect(() => importCdn({ fetchImpl, priority: ["unpkg" as never] })).toThrow(
				'[rollup-plugin-import-cdn] Unknown CDN "unpkg" in priority; expected one of: skypack, or a function (key) => url',
			);
		});

		it("rejects a priority entry that is neither a name nor a function", () => {
			expect(() => importCdn({ fetchImpl, priority: [42 as never] })).toThrow('Unknown CDN "42"');
		});

		it("rejects a priority that is not an array", () => {
			expect(() => importCdn({ fetchImpl, priority: "skypak" as never })).toThrow(
				'Unknown CDN "skypak"',
			);
		});

		it("accepts known names and functions", () => {
			expect(() =>
				importCdn({ fetchImpl, priority: ["skypack", (key) => `https://esm.sh/${key}`] }),
			).not.toThrow();
		});

		it("rejects an empty cache directory", () => {
			expect(() => importCdn({ fetchImpl, cache: "" })).toThrow("cache option");
		});

		it("rejects a non-string cache directory", () => {
			expect(() => importCdn({ fetchImpl, cache: true as never })).toThrow("cache option");
		});
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

		const { resolveId } = hooks(plugin);
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

			const { resolveId } = hooks(plugin);
			const result = await resolveId("lodash");

			expect(result).toBe("lodash");
		});

		it("should return undefined for local imports", async () => {
			const plugin = importCdn({
				fetchImpl: createMockFetch({}),
			});

			const { resolveId } = hooks(plugin);

			expect(await resolveId("./local")).toBeUndefined();
			expect(await resolveId("/absolute")).toBeUndefined();
			expect(await resolveId("../parent")).toBeUndefined();
		});

		it("should return undefined and warn through Rollup for unresolvable packages", async () => {
			const warn = vi.spyOn(console, "warn");
			const plugin = importCdn({
				fetchImpl: createMockFetch({}),
			});

			const { resolveId, logs } = hooks(plugin);
			const result = await resolveId("nonexistent");

			expect(result).toBeUndefined();
			expect(logs.warn).toHaveLength(1);
			expect(logs.warn[0]).toMatch(/^Could not resolve dependency nonexistent\n/);
			expect(logs.debug).toEqual([
				"Failed to fetch nonexistent from https://cdn.skypack.dev/nonexistent: Not found: https://cdn.skypack.dev/nonexistent",
			]);
			expect(warn).not.toHaveBeenCalled();
		});

		it("should drop debug messages on a Rollup without this.debug", async () => {
			const plugin = importCdn({
				fetchImpl: createMockFetch({}),
			});

			const { resolveId, logs } = hooks(plugin, fakeContext({ withDebug: false }));

			expect(await resolveId("nonexistent")).toBeUndefined();
			expect(logs.warn).toHaveLength(1);
			expect(logs.debug).toEqual([]);
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

			const { load } = hooks(plugin);
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

			const { load } = hooks(plugin);
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

			const { resolveId } = hooks(plugin);
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

			const { resolveId } = hooks(plugin);
			const result = await resolveId("react");

			expect(result).toBe("react");
		});
	});
	describe("fetch memoization", () => {
		it("fetches a module once for resolveId followed by load", async () => {
			const fetchImpl = vi.fn(
				createMockFetch({ "https://cdn.skypack.dev/memo": "export const memo = 1;" }),
			);
			const plugin = importCdn({ fetchImpl });
			const { resolveId, load } = hooks(plugin);

			expect(await resolveId("memo")).toBe("memo");
			expect(await load("memo")).toBe("export const memo = 1;");
			expect(fetchImpl).toHaveBeenCalledTimes(1);
		});

		it("refetches after buildStart", async () => {
			const fetchImpl = vi.fn(
				createMockFetch({ "https://cdn.skypack.dev/memo": "export const memo = 1;" }),
			);
			const plugin = importCdn({ fetchImpl });
			const { buildStart, resolveId, load } = hooks(plugin);

			buildStart();
			await resolveId("memo");
			await load("memo");
			buildStart();
			await resolveId("memo");
			await load("memo");

			expect(fetchImpl).toHaveBeenCalledTimes(2);
		});
	});

	describe("importer-relative specifiers", () => {
		it("resolves a relative dynamic import against the CDN module's URL", async () => {
			const fetchImpl = vi.fn(
				createMockFetch({
					"https://cdn.test/pkg/index.js": 'export const load = () => import("./chunk.js");',
					"https://cdn.test/pkg/chunk.js": "export const chunk = 1;",
				}),
			);
			const plugin = importCdn({ fetchImpl, priority: [() => "https://cdn.test/pkg/index.js"] });
			const { resolveId, load } = hooks(plugin);

			expect(await resolveId("pkg")).toBe("pkg");
			expect(await load("pkg")).toContain('import("./chunk.js")');
			expect(await resolveId("./chunk.js", "pkg")).toBe("https://cdn.test/pkg/chunk.js");
			expect(await load("https://cdn.test/pkg/chunk.js")).toBe("export const chunk = 1;");
		});

		it("resolves a root-relative import against the CDN origin", async () => {
			const plugin = importCdn({
				fetchImpl: createMockFetch({
					"https://cdn.test/pkg/index.js": 'export const load = () => import("/-/dep@1.0.0/x.js");',
					"https://cdn.test/-/dep@1.0.0/x.js": "export const x = 1;",
				}),
				priority: [() => "https://cdn.test/pkg/index.js"],
			});
			const { resolveId } = hooks(plugin);

			await resolveId("pkg");
			expect(await resolveId("/-/dep@1.0.0/x.js", "pkg")).toBe("https://cdn.test/-/dep@1.0.0/x.js");
		});

		it("resolves against the redirected URL, not the requested one", async () => {
			const plugin = importCdn({
				fetchImpl: async (url) => ({
					ok: true,
					url: url === "https://cdn.test/pkg" ? "https://cdn.test/pkg@1.0.0/index.js" : url,
					text: async () => "export {};",
				}),
				priority: [() => "https://cdn.test/pkg"],
			});
			const { resolveId } = hooks(plugin);

			await resolveId("pkg");
			expect(await resolveId("./chunk.js", "pkg")).toBe("https://cdn.test/pkg@1.0.0/chunk.js");
		});

		it("resolves against an importer that is itself a URL", async () => {
			const plugin = importCdn({
				fetchImpl: createMockFetch({ "https://cdn.test/a/b.js": "export {};" }),
			});
			const { resolveId } = hooks(plugin);

			expect(await resolveId("../b.js", "https://cdn.test/a/c/d.js")).toBe(
				"https://cdn.test/a/b.js",
			);
		});

		it("resolves a protocol-relative static import from a CDN module", async () => {
			const plugin = importCdn({
				fetchImpl: createMockFetch({
					"https://cdn.test/pkg/index.js": 'export { x } from "//other.test/x.js";',
					"https://other.test/x.js": "export const x = 1;",
				}),
				priority: [() => "https://cdn.test/pkg/index.js"],
			});
			const { resolveId, load } = hooks(plugin);

			expect(await resolveId("pkg")).toBe("pkg");
			const code = await load("pkg");
			expect(code).toBe('export { x } from "https://other.test/x.js";');
			expect(await resolveId("https://other.test/x.js", "pkg")).toBe("https://other.test/x.js");
		});

		it("resolves a protocol-relative dynamic import against the CDN module's URL", async () => {
			const plugin = importCdn({
				fetchImpl: createMockFetch({
					"https://cdn.test/pkg/index.js": 'export const load = () => import("//other.test/x.js");',
					"https://other.test/x.js": "export const x = 1;",
				}),
				priority: [() => "https://cdn.test/pkg/index.js"],
			});
			const { resolveId } = hooks(plugin);

			await resolveId("pkg");
			expect(await resolveId("//other.test/x.js", "pkg")).toBe("https://other.test/x.js");
		});

		it("takes the protocol from the redirected importer URL", async () => {
			const plugin = importCdn({
				fetchImpl: async (url) => ({
					ok: true,
					url: url === "https://cdn.test/pkg" ? "http://mirror.test/pkg@1.0.0/index.js" : url,
					text: async () => "export {};",
				}),
				priority: [() => "https://cdn.test/pkg"],
			});
			const { resolveId } = hooks(plugin);

			await resolveId("pkg");
			expect(await resolveId("//other.test/x.js", "pkg")).toBe("http://other.test/x.js");
		});

		it("leaves a protocol-relative id from a local file to Rollup", async () => {
			const fetchImpl = vi.fn(createMockFetch({}));
			const plugin = importCdn({ fetchImpl });
			const { resolveId } = hooks(plugin);

			expect(await resolveId("//other.test/x.js", "/abs/src/main.js")).toBeUndefined();
			expect(await resolveId("//other.test/x.js")).toBeUndefined();
			expect(fetchImpl).not.toHaveBeenCalled();
		});

		it("leaves relative imports from local files to Rollup", async () => {
			const fetchImpl = vi.fn(createMockFetch({}));
			const plugin = importCdn({ fetchImpl });
			const { resolveId } = hooks(plugin);

			expect(await resolveId("./chunk.js", "/abs/src/main.js")).toBeUndefined();
			expect(await resolveId("/abs/src/other.js", "/abs/src/main.js")).toBeUndefined();
			expect(await resolveId("../x.js", "C:\\abs\\main.js")).toBeUndefined();
			expect(fetchImpl).not.toHaveBeenCalled();
		});

		it("forgets importer URLs after buildStart", async () => {
			const fetchImpl = vi.fn(createMockFetch({ "https://cdn.test/pkg/index.js": "export {};" }));
			const plugin = importCdn({ fetchImpl, priority: [() => "https://cdn.test/pkg/index.js"] });
			const { buildStart, resolveId } = hooks(plugin);

			await resolveId("pkg");
			buildStart();
			expect(await resolveId("./chunk.js", "pkg")).toBeUndefined();
			expect(fetchImpl).toHaveBeenCalledTimes(1);
		});
	});

	describe("foreign ids", () => {
		it.each(["\0virtual", "node:fs", "fs", "C:\\a\\b.js"])(
			"skips %s without fetching",
			async (id) => {
				const fetchImpl = vi.fn(createMockFetch({}));
				const plugin = importCdn({ fetchImpl });
				const { resolveId, load } = hooks(plugin);

				expect(await resolveId(id)).toBeUndefined();
				expect(await load(id)).toBeUndefined();
				expect(fetchImpl).not.toHaveBeenCalled();
			},
		);
	});
});
