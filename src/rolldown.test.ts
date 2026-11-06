import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type Plugin, rolldown } from "rolldown";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { importCdn } from "./index";
import type { FetchImpl } from "./types";

// The fixture CDN has Skypack's URL shapes, so the plugin is given `priority: ["skypack"]`.
const PKG_A = "https://cdn.skypack.dev/pkg-a";
const PKG_A_REDIRECT = "https://cdn.skypack.dev/-/pkg-a@1.0.0/dist/index.js";
const HELPER = "https://cdn.skypack.dev/-/pkg-a@1.0.0/dist/helper.js";
const PKG_B = "https://cdn.skypack.dev/pkg-b";
const PKG_B_PINNED = "https://cdn.skypack.dev/pkg-b@2.0.0";
const DIRECT = "https://esm.test/direct.js";
const META = "https://esm.test/meta.js";
const LAZY = "https://esm.test/lazy.js";

const cdn: Record<string, { url?: string; body: string }> = {
	[PKG_A]: {
		url: PKG_A_REDIRECT,
		body: [
			'import { helper } from "./helper.js";',
			'import { b } from "pkg-b";',
			"export const used = () => helper() + b;",
			'export const unused = () => "UNUSED_EXPORT";',
		].join("\n"),
	},
	[HELPER]: { body: 'export const helper = () => "HELPER";' },
	[PKG_B]: { body: 'export const b = "PKG_B";' },
	[PKG_B_PINNED]: { body: 'export const b = "PKG_B_2";' },
	[DIRECT]: {
		body: 'export const direct = "DIRECT";\nexport const lazy = () => import("./lazy.js");',
	},
	[LAZY]: { body: 'export const value = "LAZY";' },
	[META]: { body: 'export const wasm = new URL("./mod.wasm", import.meta.url).href;' },
};

// No cast: a Rolldown config takes the plugin as typed, so typecheck guards it.
const cdnPlugin = (fetchImpl: FetchImpl, options: Parameters<typeof importCdn>[0] = {}): Plugin =>
	importCdn({ fetchImpl, priority: ["skypack"], ...options });

function mockCdn() {
	return vi.fn<FetchImpl>(async (url) => {
		const entry = cdn[url];
		return {
			ok: entry !== undefined,
			status: entry ? 200 : 404,
			url: entry?.url ?? url,
			text: async () => entry?.body ?? "Not found",
		};
	});
}

describe("Rolldown build", () => {
	let root: string;
	let globalFetch: MockInstance<typeof fetch>;

	const rolldownBuild = async (main: string, plugins: Plugin[], sourcemap = false) => {
		const input = path.join(root, "main.js");
		await writeFile(input, main);
		const bundle = await rolldown({ input, cwd: root, plugins, logLevel: "silent" });
		try {
			const { output } = await bundle.generate({ format: "es", sourcemap });
			return output.flatMap((chunk) => (chunk.type === "chunk" ? [chunk] : []));
		} finally {
			await bundle.close();
		}
	};
	const code = async (main: string, plugins: Plugin[]) =>
		(await rolldownBuild(main, plugins)).map((chunk) => chunk.code).join("\n");

	beforeEach(async () => {
		globalFetch = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValue(new Error("Tests must not use the global fetch"));
		root = await mkdtemp(path.join(tmpdir(), "import-cdn-rolldown-"));
	});

	afterEach(async () => {
		expect(globalFetch).not.toHaveBeenCalled();
		await rm(root, { recursive: true, force: true });
	});

	it("bundles bare, URL and relative imports and tree-shakes them", async () => {
		const out = await code(
			[
				'import { used } from "pkg-a";',
				`import { direct } from "${DIRECT}";`,
				"console.log(used(), direct);",
			].join("\n"),
			[cdnPlugin(mockCdn())],
		);

		for (const marker of ['"HELPER"', '"PKG_B"', '"DIRECT"']) expect(out).toContain(marker);
		expect(out).not.toContain("UNUSED_EXPORT");
		expect(out).not.toMatch(/\bfrom\s*["']https?:/);
	});

	it("leaves an installed package to Rolldown's resolver", async () => {
		const pkg = path.join(root, "node_modules", "local-pkg");
		await mkdir(pkg, { recursive: true });
		await writeFile(
			path.join(pkg, "package.json"),
			JSON.stringify({ name: "local-pkg", type: "module", main: "index.js" }),
		);
		await writeFile(path.join(pkg, "index.js"), 'export const local = "LOCAL_PKG";');
		const fetchImpl = mockCdn();

		const out = await code(
			'import { local } from "local-pkg";\nimport { b } from "pkg-b";\nconsole.log(local, b);',
			[cdnPlugin(fetchImpl)],
		);

		expect(out).toContain('"LOCAL_PKG"');
		expect(out).toContain('"PKG_B"');
		expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([PKG_B]);
	});

	it("splits a dynamic import relative to a CDN module into its own chunk", async () => {
		const chunks = await rolldownBuild(
			`import { lazy } from "${DIRECT}";\nlazy().then(console.log);`,
			[cdnPlugin(mockCdn())],
		);

		expect(chunks).toHaveLength(2);
		expect(chunks.map((chunk) => chunk.code).join("\n")).toContain('"LAZY"');
	});

	it("pins a bare import inside a CDN module through versions", async () => {
		const out = await code('import { used } from "pkg-a";\nconsole.log(used());', [
			cdnPlugin(mockCdn(), { versions: { "pkg-b": "2.0.0" } }),
		]);

		expect(out).toContain('"PKG_B_2"');
		expect(out).not.toContain('"PKG_B"');
	});

	it("points import.meta.url in a CDN module at the URL it was served from", async () => {
		const out = await code(`import { wasm } from "${META}";\nconsole.log(wasm, import.meta.url);`, [
			cdnPlugin(mockCdn()),
		]);

		expect(out).toContain(`new URL("./mod.wasm", "${META}")`);
		// The local entry keeps its own import.meta.url.
		expect(out).toContain("console.log(wasm, import.meta.url)");
	});

	it("names a CDN module in the sourcemap by its served URL and ignore-lists it", async () => {
		const chunks = await rolldownBuild(
			'import { used } from "pkg-a";\nconsole.log(used());',
			[cdnPlugin(mockCdn())],
			true,
		);
		const maps = chunks.flatMap((chunk) => (chunk.map ? [chunk.map] : []));
		const sources = maps.flatMap((map) => map.sources);
		const ignored = maps.flatMap((map) =>
			(map.x_google_ignoreList ?? []).map((index) => map.sources[index]),
		);

		expect(sources).toContain(PKG_A_REDIRECT);
		expect(sources.filter((source) => !source.startsWith("https://"))).toEqual([
			expect.stringMatching(/(^|\/)main\.js$/),
		]);
		expect(ignored.sort()).toEqual(
			sources.filter((source) => source.startsWith("https://")).sort(),
		);
	});
});
