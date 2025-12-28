import { describe, expect, it, vi } from "vitest";
import { importCdn } from "./index";
import type { FetchImpl } from "./types";

/**
 * Integration tests that simulate realistic CDN module scenarios
 */

const createMockCdn = (modules: Record<string, string>): FetchImpl => {
	return async (url: string) => {
		const content = modules[url];
		if (!content) {
			throw new Error(`CDN 404: ${url}`);
		}
		return {
			ok: true,
			url,
			text: async () => content,
		};
	};
};

describe("Integration: Real-world scenarios", () => {
	it("should handle a package with multiple entry points", async () => {
		const cdnModules = {
			"https://cdn.skypack.dev/lodash-es": `
export { default as debounce } from "./debounce.js";
export { default as throttle } from "./throttle.js";
`.trim(),
		};

		const plugin = importCdn({
			fetchImpl: createMockCdn(cdnModules),
		});

		const load = plugin.load as (id: string) => Promise<string | undefined>;
		const result = await load("lodash-es");

		expect(result).toContain("https://cdn.skypack.dev/debounce.js");
		expect(result).toContain("https://cdn.skypack.dev/throttle.js");
	});

	it("should handle React-like library with JSX runtime", async () => {
		const cdnModules = {
			"https://cdn.skypack.dev/react@18.2.0": `
import { jsx, jsxs } from "./jsx-runtime.js";
export { createElement, Component, useState, useEffect } from "./react.production.min.js";
export { jsx, jsxs };
`.trim(),
		};

		const plugin = importCdn({
			fetchImpl: createMockCdn(cdnModules),
			versions: { react: "18.2.0" },
		});

		const load = plugin.load as (id: string) => Promise<string | undefined>;
		const result = await load("react");

		expect(result).toContain("https://cdn.skypack.dev/jsx-runtime.js");
		expect(result).toContain("https://cdn.skypack.dev/react.production.min.js");
	});

	it("should handle scoped packages", async () => {
		const cdnModules = {
			"https://cdn.skypack.dev/@tanstack/react-query": `
export { QueryClient } from "./build/lib/queryClient.js";
export { useQuery } from "./build/lib/useQuery.js";
`.trim(),
		};

		const plugin = importCdn({
			fetchImpl: createMockCdn(cdnModules),
		});

		const resolveId = plugin.resolveId as (id: string) => Promise<string | undefined>;
		const load = plugin.load as (id: string) => Promise<string | undefined>;

		const resolved = await resolveId("@tanstack/react-query");
		expect(resolved).toBe("@tanstack/react-query");

		const result = await load("@tanstack/react-query");
		// Relative imports are resolved relative to the package URL
		expect(result).toContain("https://cdn.skypack.dev/@tanstack/build/lib/queryClient.js");
		expect(result).toContain("https://cdn.skypack.dev/@tanstack/build/lib/useQuery.js");
	});

	it("should handle dynamic imports correctly", async () => {
		const cdnModules = {
			"https://cdn.skypack.dev/dynamic-loader": `
export async function loadModule(name) {
  const mod = await import("./modules/" + name + ".js");
  return mod.default;
}
`.trim(),
		};

		const plugin = importCdn({
			fetchImpl: createMockCdn(cdnModules),
		});

		const load = plugin.load as (id: string) => Promise<string | undefined>;
		const result = await load("dynamic-loader");

		// Dynamic imports with expressions should be preserved (not rewritten)
		expect(result).toContain('import("./modules/"');
	});

	it("should handle CSS-in-JS library patterns", async () => {
		const cdnModules = {
			"https://cdn.skypack.dev/styled-components": `
import { createElement } from "https://cdn.skypack.dev/react";
import { StyleSheet } from "./sheet.js";
export const styled = (tag) => (styles) => {
  return createElement(tag, { className: StyleSheet.create(styles) });
};
`.trim(),
		};

		const plugin = importCdn({
			fetchImpl: createMockCdn(cdnModules),
		});

		const load = plugin.load as (id: string) => Promise<string | undefined>;
		const result = await load("styled-components");

		// Absolute URL imports should be preserved
		expect(result).toContain("https://cdn.skypack.dev/react");
		// Relative imports should be resolved
		expect(result).toContain("https://cdn.skypack.dev/sheet.js");
	});

	it("should support fallback CDN chain", async () => {
		vi.spyOn(console, "debug").mockImplementation(() => {});

		const cdnModules = {
			// Only available on esm.sh, not skypack
			"https://esm.sh/rare-package": 'export const rare = "found on esm.sh";',
		};

		const plugin = importCdn({
			fetchImpl: createMockCdn(cdnModules),
			priority: ["skypack", (key) => `https://esm.sh/${key}`],
		});

		const resolveId = plugin.resolveId as (id: string) => Promise<string | undefined>;
		const load = plugin.load as (id: string) => Promise<string | undefined>;

		const resolved = await resolveId("rare-package");
		expect(resolved).toBe("rare-package");

		const result = await load("rare-package");
		expect(result).toContain("esm.sh");
	});

	it("should handle version-specific imports", async () => {
		const cdnModules = {
			"https://cdn.skypack.dev/lodash@4.17.21": `
// Lodash v4.17.21
export const VERSION = "4.17.21";
export { default as get } from "./get.js";
`.trim(),
		};

		const plugin = importCdn({
			fetchImpl: createMockCdn(cdnModules),
			versions: {
				lodash: "4.17.21",
			},
		});

		const load = plugin.load as (id: string) => Promise<string | undefined>;
		const result = await load("lodash");

		expect(result).toContain('VERSION = "4.17.21"');
		expect(result).toContain("https://cdn.skypack.dev/get.js");
	});

	it("should handle URL imports directly", async () => {
		const directUrl = "https://unpkg.com/htmx.org@1.9.0/dist/htmx.min.js";
		const cdnModules = {
			[directUrl]: `
(function(e,t){typeof define=="function"&&define.amd?define([],t):e.htmx=t()})(this,function(){return{version:"1.9.0"}});
`.trim(),
		};

		const plugin = importCdn({
			fetchImpl: createMockCdn(cdnModules),
		});

		const resolveId = plugin.resolveId as (id: string) => Promise<string | undefined>;
		const load = plugin.load as (id: string) => Promise<string | undefined>;

		const resolved = await resolveId(directUrl);
		expect(resolved).toBe(directUrl);

		const result = await load(directUrl);
		expect(result).toContain('version:"1.9.0"');
	});

	it("should handle https URLs with different ports", async () => {
		const customUrl = "https://cdn.example.com:8080/module.js";
		const cdnModules = {
			[customUrl]: "export const port = 8080;",
		};

		const plugin = importCdn({
			fetchImpl: createMockCdn(cdnModules),
		});

		const resolveId = plugin.resolveId as (id: string) => Promise<string | undefined>;
		const load = plugin.load as (id: string) => Promise<string | undefined>;

		const resolved = await resolveId(customUrl);
		expect(resolved).toBe(customUrl);

		const result = await load(customUrl);
		expect(result).toContain("port = 8080");
	});

	it("should handle re-exports correctly", async () => {
		const cdnModules = {
			"https://cdn.skypack.dev/my-lib": `
export * from "./core.js";
export * from "./utils.js";
export { default } from "./main.js";
`.trim(),
		};

		const plugin = importCdn({
			fetchImpl: createMockCdn(cdnModules),
		});

		const load = plugin.load as (id: string) => Promise<string | undefined>;
		const result = await load("my-lib");

		expect(result).toContain("https://cdn.skypack.dev/core.js");
		expect(result).toContain("https://cdn.skypack.dev/utils.js");
		expect(result).toContain("https://cdn.skypack.dev/main.js");
	});
});

describe("Integration: Error handling", () => {
	it("should handle network failures gracefully", async () => {
		vi.spyOn(console, "debug").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});

		const plugin = importCdn({
			fetchImpl: async () => {
				throw new Error("Network error");
			},
		});

		const resolveId = plugin.resolveId as (id: string) => Promise<string | undefined>;
		const result = await resolveId("failing-package");

		expect(result).toBeUndefined();
	});

	it("should handle malformed module content", async () => {
		const cdnModules = {
			"https://cdn.skypack.dev/malformed": "this is not valid ES module syntax {{{",
		};

		const plugin = importCdn({
			fetchImpl: createMockCdn(cdnModules),
		});

		const load = plugin.load as (id: string) => Promise<string | undefined>;

		// es-module-lexer throws a parse error on malformed content
		await expect(load("malformed")).rejects.toThrow();
	});

	it("should handle module with no imports", async () => {
		const cdnModules = {
			"https://cdn.skypack.dev/simple": "export const value = 42;",
		};

		const plugin = importCdn({
			fetchImpl: createMockCdn(cdnModules),
		});

		const load = plugin.load as (id: string) => Promise<string | undefined>;
		const result = await load("simple");

		// Module with no imports should return unchanged
		expect(result).toBe("export const value = 42;");
	});
});
