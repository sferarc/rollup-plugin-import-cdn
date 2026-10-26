import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build, type Plugin } from "vite";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { importCdn } from "./index";
import type { FetchImpl } from "./types";

const PKG_A = "https://cdn.skypack.dev/pkg-a";
const PKG_A_REDIRECT = "https://cdn.skypack.dev/-/pkg-a@1.0.0/dist/index.js";
const HELPER = "https://cdn.skypack.dev/-/pkg-a@1.0.0/dist/helper.js";
const PKG_B = "https://cdn.skypack.dev/pkg-b";
const DIRECT = "https://esm.test/direct.js";

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
	[DIRECT]: { body: 'export const direct = "DIRECT";' },
};

// Vite 8 types plugins against Rolldown's context, which Rollup's PluginContext type does not match.
const cdnPlugin = (fetchImpl: FetchImpl) => importCdn({ fetchImpl }) as unknown as Plugin;

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

describe("Vite build", () => {
	let root: string;
	let globalFetch: MockInstance<typeof fetch>;

	const viteBuild = async (main: string, plugins: Plugin[]) => {
		await writeFile(path.join(root, "main.js"), main);
		const result = await build({
			root,
			configFile: false,
			logLevel: "silent",
			build: { write: false, minify: false },
			plugins,
		});
		const outputs = Array.isArray(result) ? result : [result];
		return outputs
			.flatMap((output) => ("output" in output ? output.output : []))
			.map((chunk) => (chunk.type === "chunk" ? chunk.code : ""))
			.join("\n");
	};

	beforeEach(async () => {
		globalFetch = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValue(new Error("Tests must not use the global fetch"));
		root = await mkdtemp(path.join(tmpdir(), "import-cdn-vite-"));
		await writeFile(
			path.join(root, "index.html"),
			'<script type="module" src="./main.js"></script>',
		);
	});

	afterEach(async () => {
		expect(globalFetch).not.toHaveBeenCalled();
		await rm(root, { recursive: true, force: true });
	});

	it("bundles URL imports instead of leaving them to Vite as externals", async () => {
		const fetchImpl = mockCdn();
		const code = await viteBuild(
			[
				'import { used } from "pkg-a";',
				`import { direct } from "${DIRECT}";`,
				"console.log(used(), direct);",
			].join("\n"),
			[cdnPlugin(fetchImpl)],
		);

		for (const marker of ['"HELPER"', '"PKG_B"', '"DIRECT"']) expect(code).toContain(marker);
		expect(code).not.toContain("UNUSED_EXPORT");
		expect(code).not.toMatch(/\bfrom\s*["']https?:/);
	});

	it("leaves installed packages and Vite's own modules to Vite", async () => {
		const pkg = path.join(root, "node_modules", "local-pkg");
		await mkdir(pkg, { recursive: true });
		await writeFile(
			path.join(pkg, "package.json"),
			JSON.stringify({ name: "local-pkg", type: "module", main: "index.js" }),
		);
		await writeFile(path.join(pkg, "index.js"), 'export const local = "LOCAL_PKG";');
		const fetchImpl = mockCdn();

		const code = await viteBuild(
			'import { local } from "local-pkg";\nimport { b } from "pkg-b";\nconsole.log(local, b);',
			[cdnPlugin(fetchImpl)],
		);

		expect(code).toContain('"LOCAL_PKG"');
		expect(code).toContain('"PKG_B"');
		expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([PKG_B]);
	});

	it("leaves an unprefixed virtual id to the plugin that resolved it", async () => {
		const virtual: Plugin = {
			name: "virtual",
			resolveId: (id) => (id === "~virtual/greeting" ? id : undefined),
			load: (id) => (id === "~virtual/greeting" ? 'export const hi = "VIRTUAL";' : undefined),
		};
		const fetchImpl = mockCdn();

		const code = await viteBuild('import { hi } from "~virtual/greeting";\nconsole.log(hi);', [
			cdnPlugin(fetchImpl),
			virtual,
		]);

		expect(code).toContain('"VIRTUAL"');
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});
