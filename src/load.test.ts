import { describe, expect, it, vi } from "vitest";
import { loadHook, resolveDependency } from "./load";
import type { FetchImpl, PluginOptions } from "./types";

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

describe("resolveDependency", () => {
	it("should return null for local paths", async () => {
		const options: PluginOptions = {
			fetchImpl: createMockFetch({}),
		};

		expect(await resolveDependency("./local", options)).toBeNull();
		expect(await resolveDependency("/absolute", options)).toBeNull();
		expect(await resolveDependency("file://path", options)).toBeNull();
	});

	it("should resolve package from skypack by default", async () => {
		const mockContent = 'export const foo = "bar";';
		const options: PluginOptions = {
			fetchImpl: createMockFetch({
				"https://cdn.skypack.dev/lodash": mockContent,
			}),
		};

		const result = await resolveDependency("lodash", options);

		expect(result).toEqual({
			name: "lodash",
			url: "https://cdn.skypack.dev/lodash",
			main: mockContent,
		});
	});

	it("should resolve package with specific version", async () => {
		const mockContent = 'export const version = "4.17.21";';
		const options: PluginOptions = {
			fetchImpl: createMockFetch({
				"https://cdn.skypack.dev/lodash@4.17.21": mockContent,
			}),
			versions: {
				lodash: "4.17.21",
			},
		};

		const result = await resolveDependency("lodash", options);

		expect(result).toEqual({
			name: "lodash",
			url: "https://cdn.skypack.dev/lodash@4.17.21",
			main: mockContent,
		});
	});

	it("should resolve direct URL imports", async () => {
		const mockContent = 'export const foo = "bar";';
		const directUrl = "https://example.com/module.js";
		const options: PluginOptions = {
			fetchImpl: createMockFetch({
				[directUrl]: mockContent,
			}),
		};

		const result = await resolveDependency(directUrl, options);

		expect(result).toEqual({
			name: directUrl,
			url: directUrl,
			main: mockContent,
		});
	});

	it("should use custom CDN resolver", async () => {
		const mockContent = "export const esm = true;";
		const options: PluginOptions = {
			fetchImpl: createMockFetch({
				"https://esm.sh/react": mockContent,
			}),
			priority: [(key) => `https://esm.sh/${key}`],
		};

		const result = await resolveDependency("react", options);

		expect(result).toEqual({
			name: "react",
			url: "https://esm.sh/react",
			main: mockContent,
		});
	});

	it("should try multiple CDNs in priority order", async () => {
		const mockContent = "export const fallback = true;";
		const options: PluginOptions = {
			fetchImpl: createMockFetch({
				"https://esm.sh/package": mockContent,
			}),
			priority: ["skypack", (key) => `https://esm.sh/${key}`],
		};

		const result = await resolveDependency("package", options);

		expect(result).toEqual({
			name: "package",
			url: "https://esm.sh/package",
			main: mockContent,
		});
	});

	it("should return null when all CDNs fail", async () => {
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const options: PluginOptions = {
			fetchImpl: createMockFetch({}),
		};

		const result = await resolveDependency("nonexistent", options);

		expect(result).toBeNull();
		expect(consoleSpy).toHaveBeenCalledWith(
			"[rollup-plugin-import-cdn] Could not resolve dependency nonexistent",
		);
		consoleSpy.mockRestore();
	});
});

describe("loadHook", () => {
	it("should return undefined for unresolvable dependencies", async () => {
		const options: PluginOptions = {
			fetchImpl: createMockFetch({}),
		};

		const result = await loadHook("./local", options);
		expect(result).toBeUndefined();
	});

	it("should return module content as-is when no relative imports", async () => {
		const mockContent = 'export const foo = "bar";';
		const options: PluginOptions = {
			fetchImpl: createMockFetch({
				"https://cdn.skypack.dev/simple": mockContent,
			}),
		};

		const result = await loadHook("simple", options);
		expect(result).toBe(mockContent);
	});

	it("should resolve relative imports to absolute URLs", async () => {
		const mockContent = 'import { helper } from "./utils.js";\nexport const main = helper();';
		const options: PluginOptions = {
			fetchImpl: createMockFetch({
				"https://cdn.skypack.dev/package": mockContent,
			}),
		};

		const result = await loadHook("package", options);

		expect(result).toContain("https://cdn.skypack.dev/utils.js");
		expect(result).not.toContain("./utils.js");
	});

	it("should handle multiple relative imports", async () => {
		const mockContent = `import { a } from "./a.js";
import { b } from "./b.js";
export const combined = a + b;`;
		const options: PluginOptions = {
			fetchImpl: createMockFetch({
				"https://cdn.skypack.dev/multi": mockContent,
			}),
		};

		const result = await loadHook("multi", options);

		expect(result).toContain("https://cdn.skypack.dev/a.js");
		expect(result).toContain("https://cdn.skypack.dev/b.js");
	});

	it("should preserve absolute URL imports", async () => {
		const absoluteUrl = "https://other-cdn.com/module.js";
		const mockContent = `import { other } from "${absoluteUrl}";\nexport { other };`;
		const options: PluginOptions = {
			fetchImpl: createMockFetch({
				"https://cdn.skypack.dev/package": mockContent,
			}),
		};

		const result = await loadHook("package", options);

		expect(result).toContain(absoluteUrl);
	});

	it("should handle nested path imports", async () => {
		const mockContent = 'import { nested } from "../parent/module.js";\nexport { nested };';
		const options: PluginOptions = {
			fetchImpl: createMockFetch({
				"https://cdn.skypack.dev/deep/nested/package": mockContent,
			}),
		};

		const result = await loadHook("https://cdn.skypack.dev/deep/nested/package", options);

		expect(result).toContain("https://cdn.skypack.dev/deep/parent/module.js");
	});
});
