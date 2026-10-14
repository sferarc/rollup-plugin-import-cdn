import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

	it.each([
		["react-dom/client", { "react-dom": "18.2.0" }, "react-dom@18.2.0/client"],
		["react-dom/client", { "react-dom/client": "18.2.0" }, "react-dom@18.2.0/client"],
		[
			"react-dom/client",
			{ "react-dom": "18.2.0", "react-dom/client": "18.3.1" },
			"react-dom@18.3.1/client",
		],
		["@scope/pkg", { "@scope/pkg": "1.0.0" }, "@scope/pkg@1.0.0"],
		["@scope/pkg/sub", { "@scope/pkg": "1.0.0" }, "@scope/pkg@1.0.0/sub"],
		["@scope/pkg/sub/deep.js", { "@scope/pkg": "1.0.0" }, "@scope/pkg@1.0.0/sub/deep.js"],
		["react-dom/client", { react: "18.2.0" }, "react-dom/client"],
		["react-dom@18/client", { "react-dom": "18.2.0" }, "react-dom@18/client"],
	])("should place the version for %s after the package name (%j)", async (key, versions, path) => {
		const options: PluginOptions = {
			fetchImpl: createMockFetch({ [`https://cdn.skypack.dev/${path}`]: "export {};" }),
			versions,
		};

		expect((await resolveDependency(key, options))?.url).toBe(`https://cdn.skypack.dev/${path}`);
	});

	it("should pass the pinned version to a custom CDN resolver", async () => {
		const priority = vi.fn((key: string, version?: string) => `https://esm.sh/${key}?v=${version}`);
		const options: PluginOptions = {
			fetchImpl: createMockFetch({ "https://esm.sh/react-dom/client?v=18.2.0": "export {};" }),
			priority: [priority],
			versions: { "react-dom": "18.2.0" },
		};

		await resolveDependency("react-dom/client", options);

		expect(priority).toHaveBeenCalledWith("react-dom/client", "18.2.0");
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

	it("should throw naming the URL and status when the CDN responds with an error", async () => {
		const options: PluginOptions = {
			fetchImpl: async (url) => ({ ok: false, status: 404, url, text: async () => "Not Found" }),
		};

		await expect(resolveDependency("missing", options)).rejects.toThrow(
			"Failed to fetch missing from https://cdn.skypack.dev/missing: HTTP 404",
		);
	});

	it("should fall back to the next CDN when one responds with an error", async () => {
		const options: PluginOptions = {
			fetchImpl: async (url) =>
				url.startsWith("https://bad.test")
					? { ok: false, status: 500, url, text: async () => "oops" }
					: { ok: true, url, text: async () => "export default 1;" },
			priority: [(key) => `https://bad.test/${key}`, (key) => `https://good.test/${key}`],
		};

		const result = await resolveDependency("pkg", options);

		expect(result?.url).toBe("https://good.test/pkg");
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

	it("should leave import.meta untouched while rewriting imports", async () => {
		const mockContent =
			'import { a } from "./a.js";\nexport const here = new URL("./b.js", import.meta.url).href;';
		const options: PluginOptions = {
			fetchImpl: createMockFetch({
				"https://cdn.skypack.dev/meta": mockContent,
			}),
		};

		const result = await loadHook("meta", options);

		expect(result).toBe(
			'import { a } from "https://cdn.skypack.dev/a.js";\nexport const here = new URL("./b.js", import.meta.url).href;',
		);
	});

	it("should leave dynamic imports untouched while rewriting imports", async () => {
		const dynamicImports =
			'export const b = import("./b.js");\nexport const c = import( "./c.js" );\nexport const d = import("./d.js", { with: { type: "json" } });';
		const options: PluginOptions = {
			fetchImpl: createMockFetch({
				"https://cdn.skypack.dev/dynamic": `import { a } from "./a.js";\n${dynamicImports}`,
			}),
		};

		const result = await loadHook("dynamic", options);

		expect(result).toBe(`import { a } from "https://cdn.skypack.dev/a.js";\n${dynamicImports}`);
	});

	it("should leave bare specifiers for resolveId", async () => {
		const mockContent =
			'import React from "react";\nimport { a } from "./a.js";\nexport { React, a };';
		const options: PluginOptions = {
			fetchImpl: createMockFetch({
				"https://cdn.skypack.dev/bare": mockContent,
			}),
		};

		const result = await loadHook("bare", options);

		expect(result).toBe(
			'import React from "react";\nimport { a } from "https://cdn.skypack.dev/a.js";\nexport { React, a };',
		);
	});

	it("should resolve relative and root-absolute specifiers against the response URL", async () => {
		const mockContent = 'import "./a.js";\nimport "../b.js";\nimport "/-/c.js";';
		const options: PluginOptions = {
			fetchImpl: async (url) => ({
				ok: true,
				url: "https://cdn.example/-/pkg@1.0.0/dist/index.js",
				text: async () => (url === "https://cdn.skypack.dev/paths" ? mockContent : ""),
			}),
		};

		const result = await loadHook("paths", options);

		expect(result).toBe(
			'import "https://cdn.example/-/pkg@1.0.0/dist/a.js";\nimport "https://cdn.example/-/pkg@1.0.0/b.js";\nimport "https://cdn.example/-/c.js";',
		);
	});

	it("should keep offsets intact around non-ASCII text", async () => {
		const mockContent =
			'const s = "héllo 🎉 日本";\nimport { a } from "./a.js";\nconst t = "ünï 🚀";\nimport { b } from "./b.js";\nexport const u = "ß 🌍";';
		const options: PluginOptions = {
			fetchImpl: createMockFetch({
				"https://cdn.skypack.dev/unicode": mockContent,
			}),
		};

		const result = await loadHook("unicode", options);

		expect(result).toBe(
			'const s = "héllo 🎉 日本";\nimport { a } from "https://cdn.skypack.dev/a.js";\nconst t = "ünï 🚀";\nimport { b } from "https://cdn.skypack.dev/b.js";\nexport const u = "ß 🌍";',
		);
	});

	it("should rewrite a large module with many imports in linear time", async () => {
		const imports = Array.from({ length: 2000 }, (_, i) => `import "./m${i}.js";`).join("\n");
		const padding = `/* ${"x".repeat(2 * 1024 * 1024)} */`;
		const options: PluginOptions = {
			fetchImpl: createMockFetch({
				"https://cdn.skypack.dev/large": `${imports}\n${padding}`,
			}),
		};

		const start = performance.now();
		const result = await loadHook("large", options);
		const elapsed = performance.now() - start;

		expect(result).toContain('import "https://cdn.skypack.dev/m1999.js";');
		expect(result).not.toContain('"./m');
		expect(elapsed).toBeLessThan(500);
	});
});

describe("resolveDependency cache", () => {
	let cache: string;

	beforeEach(async () => {
		cache = await mkdtemp(path.join(tmpdir(), "import-cdn-cache-"));
	});

	afterEach(async () => {
		await rm(cache, { recursive: true, force: true });
	});

	const countingFetch =
		(calls: string[]): FetchImpl =>
		async (url) => {
			calls.push(url);
			return { ok: true, url: `${url}/resolved.js`, text: async () => `export default "${url}";` };
		};

	it("should not refetch a pinned URL on the next resolve", async () => {
		const calls: string[] = [];
		const options: PluginOptions = {
			cache,
			fetchImpl: countingFetch(calls),
			versions: { lodash: "4.17.21" },
		};

		const first = await resolveDependency("lodash", options);
		const second = await resolveDependency("lodash", options);

		expect(calls).toEqual(["https://cdn.skypack.dev/lodash@4.17.21"]);
		expect(second).toEqual(first);
		expect(second?.url).toBe("https://cdn.skypack.dev/lodash@4.17.21/resolved.js");
	});

	it("should cache a subpath pinned through its package name", async () => {
		const calls: string[] = [];
		const options: PluginOptions = {
			cache,
			fetchImpl: countingFetch(calls),
			versions: { "react-dom": "18.2.0" },
		};

		await resolveDependency("react-dom/client", options);
		await resolveDependency("react-dom/client", options);

		expect(calls).toEqual(["https://cdn.skypack.dev/react-dom@18.2.0/client"]);
	});

	it("should share the cache between plugin instances", async () => {
		const calls: string[] = [];
		const options: PluginOptions = { cache, fetchImpl: countingFetch(calls) };

		await resolveDependency("https://esm.sh/react@18.2.0", options);
		await resolveDependency("https://esm.sh/react@18.2.0", { ...options });

		expect(calls).toHaveLength(1);
	});

	it("should refetch URLs that are not pinned to an exact version", async () => {
		const calls: string[] = [];
		const options: PluginOptions = {
			cache,
			fetchImpl: countingFetch(calls),
			versions: { react: "^18.2.0" },
		};

		await resolveDependency("react", options);
		await resolveDependency("react", options);
		await resolveDependency("lodash", options);
		await resolveDependency("lodash", options);

		expect(calls).toHaveLength(4);
		expect(await readdir(cache)).toEqual([]);
	});

	it("should not cache without the option", async () => {
		const calls: string[] = [];
		const options: PluginOptions = {
			fetchImpl: countingFetch(calls),
			versions: { lodash: "4.17.21" },
		};

		await resolveDependency("lodash", options);
		await resolveDependency("lodash", options);

		expect(calls).toHaveLength(2);
	});

	it("should not cache error responses", async () => {
		const options: PluginOptions = {
			cache,
			fetchImpl: async (url) => ({ ok: false, status: 503, url, text: async () => "down" }),
		};

		await expect(resolveDependency("https://esm.sh/react@18.2.0", options)).rejects.toThrow("503");
		expect(await readdir(cache)).toEqual([]);
	});

	it("should refetch when the cache entry is corrupt", async () => {
		const calls: string[] = [];
		const options: PluginOptions = { cache, fetchImpl: countingFetch(calls) };
		const pinned = "https://esm.sh/react@18.2.0";

		await resolveDependency(pinned, options);
		const [file] = await readdir(cache);
		await writeFile(path.join(cache, file), "not json");
		await resolveDependency(pinned, options);

		expect(calls).toHaveLength(2);
	});
});
