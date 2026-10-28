import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadHook, resolveDependency, rewriteImports } from "./load";
import type { FetchImpl, PluginOptions } from "./types";

const spyLogger = () => ({
	warn: vi.fn<(message: string) => void>(),
	debug: vi.fn<(message: string) => void>(),
});

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

	it.each([
		"virtual:greeting",
		"data:text/javascript,export{}",
		"HTTPS://esm.test/x.js",
		"#internal",
		"#internal/util.js",
	])("should not request %s from skypack, which only serves npm names", async (key) => {
		const fetchImpl = vi.fn(createMockFetch({}));
		const logger = spyLogger();

		expect(await resolveDependency(key, { fetchImpl }, logger)).toBeNull();
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it("should still pass a specifier with a scheme to a custom CDN resolver", async () => {
		const priority = vi.fn((key: string) => `https://esm.sh/${key.replace(/^npm:/, "")}`);
		const options: PluginOptions = {
			fetchImpl: createMockFetch({ "https://esm.sh/react": "export {};" }),
			priority: [priority, "skypack"],
		};

		expect((await resolveDependency("npm:react", options))?.url).toBe("https://esm.sh/react");
		expect(priority).toHaveBeenCalledWith("npm:react", undefined);
	});

	it("should skip a custom CDN resolver that returns undefined and try the next entry", async () => {
		const fetchImpl = vi.fn(createMockFetch({ "https://cdn.skypack.dev/react": "export {};" }));
		const logger = spyLogger();
		const options: PluginOptions = {
			fetchImpl,
			priority: [
				(key) => (key.startsWith("npm:") ? `https://esm.sh/${key.slice(4)}` : undefined),
				"skypack",
			],
		};

		expect((await resolveDependency("react", options, logger))?.url).toBe(
			"https://cdn.skypack.dev/react",
		);
		expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual(["https://cdn.skypack.dev/react"]);
		expect(logger.debug).not.toHaveBeenCalled();
	});

	it("should leave a specifier every custom CDN resolver skips without a fetch or a warning", async () => {
		const fetchImpl = vi.fn(createMockFetch({}));
		const logger = spyLogger();
		const options: PluginOptions = { fetchImpl, priority: [() => undefined] };

		expect(await resolveDependency("virtual:greeting", options, logger)).toBeNull();
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it.each([
		["a relative path", () => "react.js", '"react.js"'],
		["an empty string", () => "", '""'],
		["a number", () => 42 as unknown as string, "42"],
	])("should reject a custom CDN resolver that returns %s", async (_, resolver, shown) => {
		const fetchImpl = vi.fn(createMockFetch({}));
		const options: PluginOptions = { fetchImpl, priority: ["skypack", resolver] };

		await expect(resolveDependency("react", options)).rejects.toThrow(
			`priority[1] returned ${shown} for react; expected an absolute URL or undefined`,
		);
		expect(fetchImpl).not.toHaveBeenCalled();
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
		// Inherited names such as `constructor` are not entries in `versions`.
		["constructor", { lodash: "4.17.21" }, "constructor"],
		["constructor/sub", { lodash: "4.17.21" }, "constructor/sub"],
		["constructor", { constructor: "1.0.0" }, "constructor@1.0.0"],
	])("should place the version for %s after the package name (%j)", async (key, versions, path) => {
		const options: PluginOptions = {
			fetchImpl: createMockFetch({ [`https://cdn.skypack.dev/${path}`]: "export {};" }),
			versions,
		};

		expect((await resolveDependency(key, options))?.url).toBe(`https://cdn.skypack.dev/${path}`);
	});

	it.each([
		["react", {}, "react"],
		["react-dom/client", { "react-dom": "18.2.0" }, "react-dom@18.2.0/client"],
		["@scope/pkg/sub", { "@scope/pkg": "1.0.0" }, "@scope/pkg@1.0.0/sub"],
		["react@17/jsx-runtime", { react: "18.2.0" }, "react@17/jsx-runtime"],
	])("should build the esm.sh URL for %s (%j)", async (key, versions, path) => {
		const options: PluginOptions = {
			fetchImpl: createMockFetch({ [`https://esm.sh/${path}`]: "export {};" }),
			priority: ["esm.sh"],
			versions,
		};

		expect((await resolveDependency(key, options))?.url).toBe(`https://esm.sh/${path}`);
	});

	it.each(["virtual:x", "#internal", "HTTPS://example.com/x.js"])(
		"should not request %s from esm.sh",
		async (key) => {
			const fetchImpl = vi.fn(createMockFetch({}));

			expect(await resolveDependency(key, { fetchImpl, priority: ["esm.sh"] })).toBeNull();
			expect(fetchImpl).not.toHaveBeenCalled();
		},
	);

	it.each([
		["react", {}, "react"],
		["react-dom/client", { "react-dom": "18.2.0" }, "react-dom@18.2.0/client"],
		["@scope/pkg/sub", { "@scope/pkg": "1.0.0" }, "@scope/pkg@1.0.0/sub"],
		["react@17/jsx-runtime", { react: "18.2.0" }, "react@17/jsx-runtime"],
	])("should build the jsdelivr URL for %s (%j)", async (key, versions, path) => {
		const url = `https://cdn.jsdelivr.net/npm/${path}/+esm`;
		const options: PluginOptions = {
			fetchImpl: createMockFetch({ [url]: "export {};" }),
			priority: ["jsdelivr"],
			versions,
		};

		expect((await resolveDependency(key, options))?.url).toBe(url);
	});

	it.each(["virtual:x", "#internal", "HTTPS://example.com/x.js"])(
		"should not request %s from jsdelivr",
		async (key) => {
			const fetchImpl = vi.fn(createMockFetch({}));

			expect(await resolveDependency(key, { fetchImpl, priority: ["jsdelivr"] })).toBeNull();
			expect(fetchImpl).not.toHaveBeenCalled();
		},
	);

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

	it("should not pass an inherited name in versions to a custom CDN resolver", async () => {
		const priority = vi.fn((key: string) => `https://esm.sh/${key}`);
		const options: PluginOptions = {
			fetchImpl: createMockFetch({ "https://esm.sh/toString": "export {};" }),
			priority: [priority],
			versions: { lodash: "4.17.21" },
		};

		await resolveDependency("toString", options);

		expect(priority).toHaveBeenCalledWith("toString", undefined);
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

	describe("Skypack build errors", () => {
		const errorUrl = "https://cdn.skypack.dev/error/build:vue@v3.4.0-5WYbVKWEJJmTff41AxMV";
		const skypackFetch =
			(calls: string[] = []): FetchImpl =>
			async (url) => {
				calls.push(url);
				return url.startsWith("https://cdn.skypack.dev/")
					? { ok: true, url: errorUrl, text: async () => 'throw new Error("[Package Error]");' }
					: { ok: true, url, text: async () => "export default 1;" };
			};

		it("should fall back to the next CDN when Skypack redirects to a build error", async () => {
			const result = await resolveDependency("vue", {
				fetchImpl: skypackFetch(),
				priority: ["skypack", "esm.sh"],
			});

			expect(result).toEqual({ name: "vue", url: "https://esm.sh/vue", main: "export default 1;" });
		});

		it("should fail naming the error URL when no other CDN is configured", async () => {
			await expect(resolveDependency("vue", { fetchImpl: skypackFetch() })).rejects.toThrow(
				`Failed to fetch vue from https://cdn.skypack.dev/vue: Skypack could not build the package (${errorUrl})`,
			);
		});

		it("should fail on a direct import of the error URL", async () => {
			await expect(resolveDependency(errorUrl, { fetchImpl: skypackFetch() })).rejects.toThrow(
				"Skypack could not build the package",
			);
		});

		it.each([
			"https://cdn.skypack.dev/error",
			"https://cdn.skypack.dev/error/index.js",
			"https://esm.sh/error/build:x",
		])("should keep %s, which is not a Skypack build error", async (url) => {
			const fetchImpl: FetchImpl = async () => ({ ok: true, url, text: async () => "export {};" });

			expect((await resolveDependency(url, { fetchImpl }))?.url).toBe(url);
		});

		it("should neither cache a build error nor use one cached earlier", async () => {
			const cache = await mkdtemp(path.join(tmpdir(), "import-cdn-cache-"));
			try {
				const calls: string[] = [];
				const options: PluginOptions = {
					cache,
					fetchImpl: skypackFetch(calls),
					priority: ["skypack", "esm.sh"],
					versions: { vue: "3.4.0" },
				};
				const stale = path.join(
					cache,
					`${createHash("sha256").update("https://cdn.skypack.dev/vue@3.4.0").digest("hex")}.json`,
				);
				await writeFile(stale, JSON.stringify({ url: errorUrl, main: "throw 1;" }));

				const result = await resolveDependency("vue", options);

				expect(result?.url).toBe("https://esm.sh/vue@3.4.0");
				expect(calls).toEqual(["https://cdn.skypack.dev/vue@3.4.0", "https://esm.sh/vue@3.4.0"]);
				expect(JSON.parse(await readFile(stale, "utf8")).url).toBe(errorUrl);
			} finally {
				await rm(cache, { recursive: true, force: true });
			}
		});
	});

	describe("HTML pages", () => {
		const portal = "https://portal.test/login";
		const page = "<!doctype html><html><body>Sign in</body></html>";
		const portalFetch =
			(calls: string[] = []): FetchImpl =>
			async (url) => {
				calls.push(url);
				return url.startsWith("https://cdn.skypack.dev/")
					? { ok: true, url: portal, text: async () => page }
					: { ok: true, url, text: async () => "export default 1;" };
			};

		it("should fall back to the next CDN when one answers 200 with an HTML page", async () => {
			const result = await resolveDependency("vue", {
				fetchImpl: portalFetch(),
				priority: ["skypack", "esm.sh"],
			});

			expect(result).toEqual({ name: "vue", url: "https://esm.sh/vue", main: "export default 1;" });
		});

		it("should fail naming the page URL when no other CDN is configured", async () => {
			await expect(resolveDependency("vue", { fetchImpl: portalFetch() })).rejects.toThrow(
				`Failed to fetch vue from https://cdn.skypack.dev/vue: served an HTML page instead of a JavaScript module (${portal})`,
			);
		});

		it.each([
			"<!DOCTYPE html>\n<html></html>",
			'  \n<html lang="en">',
			"\uFEFF<!doctype html>",
			"<head><title>404</title></head>",
			"<BODY>Not found</BODY>",
		])("should reject %j", async (body) => {
			const fetchImpl: FetchImpl = async (url) => ({ ok: true, url, text: async () => body });

			await expect(resolveDependency("https://esm.sh/x", { fetchImpl })).rejects.toThrow(
				"served an HTML page",
			);
		});

		it.each([
			'<svg xmlns="http://www.w3.org/2000/svg"></svg>',
			'export const page = "<!doctype html>";',
			"// <html>\nexport {};",
			"<htmlx>",
		])("should keep %j", async (body) => {
			const fetchImpl: FetchImpl = async (url) => ({ ok: true, url, text: async () => body });

			expect((await resolveDependency("https://esm.sh/x", { fetchImpl }))?.main).toBe(body);
		});

		it("should neither cache an HTML page nor use one cached earlier", async () => {
			const cache = await mkdtemp(path.join(tmpdir(), "import-cdn-cache-"));
			try {
				const calls: string[] = [];
				const options: PluginOptions = {
					cache,
					fetchImpl: portalFetch(calls),
					priority: ["skypack", "esm.sh"],
					versions: { vue: "3.4.0" },
				};
				const stale = path.join(
					cache,
					`${createHash("sha256").update("https://cdn.skypack.dev/vue@3.4.0").digest("hex")}.json`,
				);
				await writeFile(stale, JSON.stringify({ url: portal, main: page }));

				const result = await resolveDependency("vue", options);

				expect(result?.url).toBe("https://esm.sh/vue@3.4.0");
				expect(calls).toEqual(["https://cdn.skypack.dev/vue@3.4.0", "https://esm.sh/vue@3.4.0"]);
				expect(JSON.parse(await readFile(stale, "utf8")).main).toBe(page);
			} finally {
				await rm(cache, { recursive: true, force: true });
			}
		});
	});

	describe("Skypack served versions", () => {
		const served = (name: string, version: string, subpath = "/dist=es2019/index.js") =>
			`export * from '/-/${name}@v${version}-KF3wPs9nJGEnW40cJXGo${subpath}';`;
		const skypackServes =
			(body: string, calls: string[] = []): FetchImpl =>
			async (url) => {
				calls.push(url);
				const main = url.startsWith("https://cdn.skypack.dev/") ? body : "export default 1;";
				return { ok: true, url, text: async () => main };
			};

		it("should fall back to the next CDN when Skypack serves another version", async () => {
			const result = await resolveDependency("react", {
				fetchImpl: skypackServes(served("react", "17.0.1")),
				priority: ["skypack", "esm.sh"],
				versions: { react: "18.2.0" },
			});

			expect(result).toEqual({
				name: "react",
				url: "https://esm.sh/react@18.2.0",
				main: "export default 1;",
			});
		});

		it("should fail naming the served version when no other CDN is configured", async () => {
			await expect(
				resolveDependency("react-dom/client", {
					fetchImpl: skypackServes(served("react-dom", "17.0.1", "/dist=es2019,mode=raw/client")),
					versions: { "react-dom": "18.2.0" },
				}),
			).rejects.toThrow(
				"Failed to fetch react-dom/client from https://cdn.skypack.dev/react-dom@18.2.0/client: Skypack served version 17.0.1 instead",
			);
		});

		it.each([
			["the pinned version", "react@18.2.0", served("react", "18.2.0")],
			["a prerelease pin", "react@19.0.0-rc.1", served("react", "19.0.0-rc.1")],
			["a scoped package", "@scope/pkg@1.0.0", served("@scope/pkg", "1.0.0")],
			["a range", "react@18", served("react", "17.0.1")],
			["no version", "react", served("react", "17.0.1")],
			["a body without a Skypack path", "react@18.2.0", "export default 1;"],
			["another package's path", "react-dom@18.2.0", served("react", "17.0.1")],
		])("should keep a response for %s", async (_, specifier, body) => {
			const url = `https://cdn.skypack.dev/${specifier}`;

			expect((await resolveDependency(url, { fetchImpl: skypackServes(body) }))?.main).toBe(body);
		});

		it("should not check a pinned URL on another host", async () => {
			const url = "https://esm.sh/react@18.2.0";
			const main = served("react", "17.0.1");
			const fetchImpl: FetchImpl = async () => ({ ok: true, url, text: async () => main });

			expect((await resolveDependency(url, { fetchImpl }))?.main).toBe(main);
		});

		it("should neither cache another version nor use one cached earlier", async () => {
			const cache = await mkdtemp(path.join(tmpdir(), "import-cdn-cache-"));
			try {
				const calls: string[] = [];
				const stale = path.join(
					cache,
					`${createHash("sha256").update("https://cdn.skypack.dev/react@18.2.0").digest("hex")}.json`,
				);
				const wrong = {
					url: "https://cdn.skypack.dev/react@18.2.0",
					main: served("react", "17.0.1"),
				};
				await writeFile(stale, JSON.stringify(wrong));

				const result = await resolveDependency("react", {
					cache,
					fetchImpl: skypackServes(served("react", "17.0.1"), calls),
					priority: ["skypack", "esm.sh"],
					versions: { react: "18.2.0" },
				});

				expect(result?.url).toBe("https://esm.sh/react@18.2.0");
				expect(calls).toEqual([
					"https://cdn.skypack.dev/react@18.2.0",
					"https://esm.sh/react@18.2.0",
				]);
				expect(JSON.parse(await readFile(stale, "utf8"))).toEqual(wrong);
			} finally {
				await rm(cache, { recursive: true, force: true });
			}
		});
	});

	it("should report a network error at debug level and try the next CDN", async () => {
		const logger = spyLogger();
		const options: PluginOptions = {
			fetchImpl: async (url) => {
				if (url.startsWith("https://down.test")) throw new Error("ECONNRESET");
				return { ok: true, url, text: async () => "export default 1;" };
			},
			priority: [(key) => `https://down.test/${key}`, (key) => `https://up.test/${key}`],
		};

		const result = await resolveDependency("pkg", options, logger);

		expect(result?.url).toBe("https://up.test/pkg");
		expect(logger.debug).toHaveBeenCalledExactlyOnceWith(
			"Failed to fetch pkg from https://down.test/pkg: ECONNRESET",
		);
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it("should return null when all CDNs fail", async () => {
		const logger = spyLogger();
		const options: PluginOptions = {
			fetchImpl: createMockFetch({}),
		};

		const result = await resolveDependency("nonexistent", options, logger);

		expect(result).toBeNull();
		expect(logger.warn).toHaveBeenCalledWith(
			"Could not resolve dependency nonexistent\n" +
				"[rollup-plugin-import-cdn] Failed to fetch nonexistent from https://cdn.skypack.dev/nonexistent: Not found: https://cdn.skypack.dev/nonexistent",
		);
	});

	it("should warn with every URL and the underlying cause when all CDNs are unreachable", async () => {
		const logger = spyLogger();
		const options: PluginOptions = {
			fetchImpl: async (url) => {
				throw Object.assign(new TypeError("fetch failed"), {
					cause: new Error(`getaddrinfo ENOTFOUND ${new URL(url).host}`),
				});
			},
			priority: [(key) => `https://a.test/${key}`, (key) => `https://b.test/${key}`],
		};

		const result = await resolveDependency("pkg", options, logger);

		expect(result).toBeNull();
		expect(logger.warn).toHaveBeenCalledWith(
			[
				"Could not resolve dependency pkg",
				"[rollup-plugin-import-cdn] Failed to fetch pkg from https://a.test/pkg: fetch failed (getaddrinfo ENOTFOUND a.test)",
				"[rollup-plugin-import-cdn] Failed to fetch pkg from https://b.test/pkg: fetch failed (getaddrinfo ENOTFOUND b.test)",
			].join("\n"),
		);
	});

	it("should throw listing every attempt when HTTP and network failures mix", async () => {
		const networkError = new Error("connect ECONNREFUSED");
		const options: PluginOptions = {
			fetchImpl: async (url) => {
				if (url.startsWith("https://down.test")) throw networkError;
				return { ok: false, status: 500, url, text: async () => "oops" };
			},
			priority: [(key) => `https://bad.test/${key}`, (key) => `https://down.test/${key}`],
		};

		const error = await resolveDependency("pkg", options).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toBe(
			[
				"[rollup-plugin-import-cdn] Failed to fetch pkg from https://bad.test/pkg: HTTP 500",
				"[rollup-plugin-import-cdn] Failed to fetch pkg from https://down.test/pkg: connect ECONNREFUSED",
			].join("\n"),
		);
		expect((error as { cause?: unknown }).cause).toBe(networkError);
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

	it("should inline import.meta.url as the served URL when asked", async () => {
		const main = [
			'import { a } from "./a.js";',
			'export const here = new URL("./b.js", import.meta.url).href;',
			"export const spaced = import.meta . url;",
			"export const env = import.meta.env;",
			"export const urls = import.meta.urls;",
			"export const same = import.meta.url === location.href;",
			"import.meta.url = here;",
		].join("\n");
		const url = "https://cdn.skypack.dev/-/meta@1.0.0/index.js";

		const result = await rewriteImports({ name: "meta", url, main }, { inlineImportMetaUrl: true });

		expect(result).toBe(
			[
				'import { a } from "https://cdn.skypack.dev/-/meta@1.0.0/a.js";',
				`export const here = new URL("./b.js", "${url}").href;`,
				`export const spaced = "${url}";`,
				"export const env = import.meta.env;",
				"export const urls = import.meta.urls;",
				`export const same = "${url}" === location.href;`,
				"import.meta.url = here;",
			].join("\n"),
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

	it("should resolve escaped specifiers by their value rather than their source text", async () => {
		const mockContent =
			'import "./\\u00fc.js";\nimport \'./it\\\'s.js\';\nimport "./caf\\xe9.js";\nimport "./x.js?a\\\\b";\nimport "./y.js#\\\\u";';
		const options: PluginOptions = {
			fetchImpl: createMockFetch({
				"https://cdn.skypack.dev/escaped": mockContent,
			}),
		};

		const result = await loadHook("escaped", options);

		expect(result).toBe(
			'import "https://cdn.skypack.dev/%C3%BC.js";\nimport \'https://cdn.skypack.dev/it\\\'s.js\';\nimport "https://cdn.skypack.dev/caf%C3%A9.js";\nimport "https://cdn.skypack.dev/x.js?a\\\\b";\nimport "https://cdn.skypack.dev/y.js#\\\\u";',
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

	it("should resolve against the requested URL when the response URL is empty", async () => {
		const options: PluginOptions = {
			fetchImpl: async () => ({
				ok: true,
				url: "",
				text: async () => 'import "./dep.js";',
			}),
		};

		const result = await loadHook("https://cdn.test/pkg/index.js", options);

		expect(result).toBe('import "https://cdn.test/pkg/dep.js";');
	});

	it("should resolve protocol-relative specifiers against the response URL's protocol", async () => {
		const mockContent =
			'import "//other.test/a.js";\nexport { b } from "//other.test/b.js";\nconst c = () => import("//other.test/c.js");';
		const options: PluginOptions = {
			fetchImpl: async (url) => ({
				ok: true,
				url: "http://mirror.test/-/pkg@1.0.0/index.js",
				text: async () => (url === "https://cdn.skypack.dev/protocol" ? mockContent : ""),
			}),
		};

		const result = await loadHook("protocol", options);

		expect(result).toBe(
			'import "http://other.test/a.js";\nexport { b } from "http://other.test/b.js";\nconst c = () => import("//other.test/c.js");',
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

	it("should name the module and URL when the source is markup", async () => {
		const error = await rewriteImports({
			name: "portal",
			url: "https://portal.test/login",
			main: '<!doctype html><html><head><title>Sign in</title></head><body><a href="/x">Log in</a></body></html>',
		}).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toMatch(
			/^\[rollup-plugin-import-cdn\] Could not parse portal from https:\/\/portal\.test\/login: Parse error .*returned HTML rather than a JavaScript module/,
		);
		const { cause } = error as { cause?: unknown };
		expect(cause).toBeInstanceOf(Error);
		expect((cause as Error).message).toMatch(/^Parse error/);
	});

	it("should name the module and URL when the source has a syntax error", async () => {
		const options: PluginOptions = {
			fetchImpl: createMockFetch({
				"https://cdn.skypack.dev/broken": "import { from 'x'",
			}),
		};

		const error = await loadHook("broken", options).catch((e: unknown) => e);

		expect((error as Error).message).toMatch(
			/^\[rollup-plugin-import-cdn\] Could not parse broken from https:\/\/cdn\.skypack\.dev\/broken: Parse error/,
		);
		expect((error as Error).message).not.toContain("HTML");
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

	it("should resolve without output when the cache entry is missing", async () => {
		const logger = spyLogger();
		const { warn, debug } = logger;

		await resolveDependency(
			"https://esm.sh/react@18.2.0",
			{ cache, fetchImpl: countingFetch([]) },
			logger,
		);

		expect(warn).not.toHaveBeenCalled();
		expect(debug).not.toHaveBeenCalled();
	});

	it("should warn once and refetch when the cache entry is not JSON", async () => {
		const calls: string[] = [];
		const options: PluginOptions = { cache, fetchImpl: countingFetch(calls) };
		const pinned = "https://esm.sh/react@18.2.0";

		await resolveDependency(pinned, options);
		const [file] = await readdir(cache);
		await writeFile(path.join(cache, file!), "{not json");
		const logger = spyLogger();
		const { warn } = logger;
		const dependency = await resolveDependency(pinned, options, logger);

		expect(calls).toHaveLength(2);
		expect(dependency?.main).toBe(`export default "${pinned}";`);
		expect(warn).toHaveBeenCalledOnce();
		expect(warn.mock.calls[0]![0]).toContain(path.join(cache, file!));
		expect(warn.mock.calls[0]![0]).toContain(pinned);
	});

	it.each([
		"pkg@1.2.3",
		"@scope/pkg@1.2.3/sub.js",
		"pkg@1.2.3-beta.1",
		"pkg@1.2.3+build",
		"pkg@1.2.3-rc.1+build.5/sub.js",
		"pkg@1.2.3?dev",
		"npm/pkg@1.2.3/+esm",
	])("should cache the pinned URL %s", async (specifier) => {
		const calls: string[] = [];
		const options: PluginOptions = { cache, fetchImpl: countingFetch(calls) };

		await resolveDependency(`https://cdn.example/${specifier}`, options);
		await resolveDependency(`https://cdn.example/${specifier}`, options);

		expect(calls).toHaveLength(1);
	});

	it.each([
		"pkg@1",
		"pkg@1.2",
		"pkg@^1.2.3",
		"pkg@~1.2.3",
		"pkg@latest",
		"pkg@1.2.3.4",
		"pkg@1.2.3x",
		"pkg@1.2.3+build+more",
		"pkg",
		"pkg@latest?alias=dep@1.2.3",
		"pkg#@1.2.3",
	])("should not cache the unpinned URL %s", async (specifier) => {
		const calls: string[] = [];
		const options: PluginOptions = { cache, fetchImpl: countingFetch(calls) };

		await resolveDependency(`https://cdn.example/${specifier}`, options);
		await resolveDependency(`https://cdn.example/${specifier}`, options);

		expect(calls).toHaveLength(2);
		expect(await readdir(cache)).toEqual([]);
	});

	it.each([
		["a non-http url", { url: "file:///etc/passwd", main: "export default 1;" }],
		["a relative url", { url: "/react.js", main: "export default 1;" }],
		["a missing url", { main: "export default 1;" }],
		["a missing main", { url: "https://esm.sh/react@18.2.0" }],
		["a non-string main", { url: "https://esm.sh/react@18.2.0", main: 1 }],
		["null", null],
	])("should refetch when the cache entry has %s", async (_, entry) => {
		const calls: string[] = [];
		const options: PluginOptions = { cache, fetchImpl: countingFetch(calls) };
		const pinned = "https://esm.sh/react@18.2.0";

		await resolveDependency(pinned, options);
		const [file] = await readdir(cache);
		await writeFile(path.join(cache, file!), JSON.stringify(entry));
		const logger = spyLogger();
		const { warn } = logger;
		const dependency = await resolveDependency(pinned, options, logger);

		expect(calls).toHaveLength(2);
		expect(dependency?.url).toBe(`${pinned}/resolved.js`);
		expect(warn).toHaveBeenCalledOnce();
		expect(warn.mock.calls[0]![0]).toContain(path.join(cache, file!));
	});

	it("should leave one valid entry when concurrent resolves write the same URL", async () => {
		const logger = spyLogger();
		const { warn } = logger;
		const calls: string[] = [];
		const options: PluginOptions = { cache, fetchImpl: countingFetch(calls) };
		const pinned = "https://esm.sh/react@18.2.0";

		const results = await Promise.all(
			Array.from({ length: 8 }, () => resolveDependency(pinned, { ...options }, logger)),
		);

		expect(results.every((result) => result?.url === `${pinned}/resolved.js`)).toBe(true);
		expect(warn).not.toHaveBeenCalled();
		const files = await readdir(cache);
		expect(files).toHaveLength(1);
		expect(files[0]).toMatch(/^[0-9a-f]{64}\.json$/);
		const second = await resolveDependency(pinned, options, logger);
		expect(second?.main).toBe(`export default "${pinned}";`);
		expect(calls).toHaveLength(8);
	});

	it("should warn and remove the temporary file when a cache write fails", async () => {
		const logger = spyLogger();
		const { warn } = logger;
		const pinned = "https://esm.sh/react@18.2.0";
		const entry = `${createHash("sha256").update(pinned).digest("hex")}.json`;
		await mkdir(path.join(cache, entry, "blocker"), { recursive: true });

		const dependency = await resolveDependency(
			pinned,
			{ cache, fetchImpl: countingFetch([]) },
			logger,
		);

		expect(dependency?.url).toBe(`${pinned}/resolved.js`);
		const messages = warn.mock.calls.map(([message]) => String(message));
		expect(messages).toHaveLength(2);
		expect(messages[0]).toContain(`Could not read cache entry ${path.join(cache, entry)}`);
		expect(messages[1]).toContain(`Could not write cache entry ${path.join(cache, entry)}`);
		expect(await readdir(cache)).toEqual([entry]);
	});

	it("should warn and leave no temporary file when the cache directory cannot be created", async () => {
		const logger = spyLogger();
		const { warn } = logger;
		const pinned = "https://esm.sh/react@18.2.0";
		const blocker = path.join(cache, "not-a-directory");
		await writeFile(blocker, "");
		const dir = path.join(blocker, "cache");

		const dependency = await resolveDependency(
			pinned,
			{
				cache: dir,
				fetchImpl: countingFetch([]),
			},
			logger,
		);

		expect(dependency?.url).toBe(`${pinned}/resolved.js`);
		const write = warn.mock.calls
			.map(([message]) => String(message))
			.find((m) => m.includes("write"));
		expect(write).toContain(dir);
		expect(await readdir(cache)).toEqual(["not-a-directory"]);
	});
});

describe("resolveDependency integrity", () => {
	const pinned = "https://esm.sh/react@18.2.0";
	const final = `${pinned}/es2022/react.mjs`;
	const body = "export default 1;";
	const sri = (content: string) =>
		`sha384-${createHash("sha384").update(content).digest("base64")}`;

	const servingFetch =
		(calls: string[], content = body): FetchImpl =>
		async (url) => {
			calls.push(url);
			return { ok: true, url: url === pinned ? final : url, text: async () => content };
		};

	it.each([
		["requested", pinned],
		["final", final],
	])("should resolve when the body matches the hash keyed by the %s URL", async (_, key) => {
		const dependency = await resolveDependency(pinned, {
			fetchImpl: servingFetch([]),
			integrity: { [key]: sri(body) },
		});

		expect(dependency).toEqual({ name: pinned, url: final, main: body });
	});

	it("should throw on a mismatch instead of trying the next CDN", async () => {
		const calls: string[] = [];
		const options: PluginOptions = {
			fetchImpl: servingFetch(calls, "export default 'tampered';"),
			integrity: { [pinned]: sri(body) },
			priority: [() => pinned, () => "https://cdn.skypack.dev/react@18.2.0"],
		};

		await expect(resolveDependency("react", options)).rejects.toThrow(
			`Integrity check failed for ${pinned}: expected ${sri(body)}, got ${sri("export default 'tampered';")}`,
		);
		expect(calls).toEqual([pinned]);
	});

	it("should leave URLs without an entry unchecked", async () => {
		const dependency = await resolveDependency(pinned, {
			fetchImpl: servingFetch([]),
			integrity: { "https://esm.sh/other@1.0.0": sri("other") },
		});

		expect(dependency?.main).toBe(body);
	});

	describe("with a cache", () => {
		let cache: string;

		beforeEach(async () => {
			cache = await mkdtemp(path.join(tmpdir(), "import-cdn-integrity-"));
		});

		afterEach(async () => {
			await rm(cache, { recursive: true, force: true });
		});

		it("should not cache a body that fails the check", async () => {
			const options: PluginOptions = {
				cache,
				fetchImpl: servingFetch([], "export default 'tampered';"),
				integrity: { [pinned]: sri(body) },
			};

			await expect(resolveDependency(pinned, options)).rejects.toThrow("Integrity check failed");
			expect(await readdir(cache)).toEqual([]);
		});

		it("should use a cache entry that matches without refetching", async () => {
			const calls: string[] = [];
			const options: PluginOptions = {
				cache,
				fetchImpl: servingFetch(calls),
				integrity: { [pinned]: sri(body), [final]: sri(body) },
			};

			await resolveDependency(pinned, options);
			const dependency = await resolveDependency(pinned, options);

			expect(dependency?.main).toBe(body);
			expect(calls).toEqual([pinned]);
		});

		it("should refetch when a cache entry for a checked URL points its imports elsewhere", async () => {
			const calls: string[] = [];
			const options: PluginOptions = {
				cache,
				fetchImpl: servingFetch(calls),
				integrity: { [pinned]: sri(body) },
			};

			await resolveDependency(pinned, options);
			const [file] = await readdir(cache);
			await writeFile(
				path.join(cache, file!),
				JSON.stringify({ url: "https://attacker.test/main.js", main: body }),
			);
			const dependency = await resolveDependency(pinned, options);

			expect(dependency?.url).toBe(final);
			expect(calls).toEqual([pinned, pinned]);
		});

		it.each([
			["requested", pinned],
			["final", final],
		])("should fail on a tampered cache entry checked by the %s URL", async (_, key) => {
			const calls: string[] = [];
			const options: PluginOptions = {
				cache,
				fetchImpl: servingFetch(calls),
				integrity: { [key]: sri(body) },
			};

			await resolveDependency(pinned, options);
			const [file] = await readdir(cache);
			await writeFile(
				path.join(cache, file!),
				JSON.stringify({ url: key, main: "export default 'tampered';" }),
			);

			await expect(resolveDependency(pinned, options)).rejects.toThrow(
				`Integrity check failed for ${key}`,
			);
			expect(calls).toEqual([pinned]);
		});
	});
});
