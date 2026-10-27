import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build, createServer, type Plugin, type Rolldown } from "vite";
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

	it("rebuilds under vite build --watch, refetching and bundling a newly added URL import", async () => {
		const fetchImpl = mockCdn();
		await writeFile(
			path.join(root, "main.js"),
			'import { used } from "pkg-a";\nconsole.log(used(), "V1");',
		);
		const watcher = (await build({
			root,
			configFile: false,
			logLevel: "silent",
			build: { watch: {}, minify: false },
			plugins: [cdnPlugin(fetchImpl)],
		})) as Rolldown.RolldownWatcher;
		const nextEnd = () =>
			new Promise<void>((resolve, reject) => {
				const onEvent = (event: Rolldown.RolldownWatcherEvent) => {
					if (event.code === "BUNDLE_END") void event.result.close();
					if (event.code !== "END" && event.code !== "ERROR") return;
					watcher.off("event", onEvent);
					if (event.code === "ERROR") reject(event.error);
					else resolve();
				};
				watcher.on("event", onEvent);
			});
		const readOutput = async () => {
			const assets = path.join(root, "dist", "assets");
			const files = (await readdir(assets)).filter((file) => file.endsWith(".js"));
			const code = await Promise.all(
				files.map((file) => readFile(path.join(assets, file), "utf8")),
			);
			return code.join("\n");
		};

		try {
			await nextEnd();
			const first = await readOutput();
			expect(first).toContain('"V1"');
			expect(first).toContain('"HELPER"');
			expect(fetchImpl).toHaveBeenCalledTimes(3);

			const rebuilt = nextEnd();
			await writeFile(
				path.join(root, "main.js"),
				`import { used } from "pkg-a";\nimport { direct } from "${DIRECT}";\nconsole.log(used(), direct, "V2");`,
			);
			await rebuilt;

			const second = await readOutput();
			for (const marker of ['"V2"', '"HELPER"', '"PKG_B"', '"DIRECT"'])
				expect(second).toContain(marker);
			expect(second).not.toContain('"V1"');
			expect(second).not.toMatch(/\bfrom\s*["']https?:/);
			// buildStart clears the per-build memo, so the rebuild fetches pkg-a's graph again.
			expect(
				fetchImpl.mock.calls
					.slice(3)
					.map(([url]) => url)
					.sort(),
			).toEqual([DIRECT, HELPER, PKG_A, PKG_B].sort());
		} finally {
			await watcher.close();
		}
	});
});

describe("Vite dev server", () => {
	let root: string;
	let globalFetch: MockInstance<typeof fetch>;

	const devServer = async (main: string, fetchImpl: FetchImpl) => {
		await writeFile(path.join(root, "main.js"), main);
		return createServer({
			root,
			configFile: false,
			logLevel: "silent",
			server: { middlewareMode: true, ws: false },
			optimizeDeps: { noDiscovery: true },
			plugins: [cdnPlugin(fetchImpl)],
		});
	};

	beforeEach(async () => {
		globalFetch = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValue(new Error("Tests must not use the global fetch"));
		root = await mkdtemp(path.join(tmpdir(), "import-cdn-vite-dev-"));
		await writeFile(
			path.join(root, "index.html"),
			'<script type="module" src="./main.js"></script>',
		);
	});

	afterEach(async () => {
		expect(globalFetch).not.toHaveBeenCalled();
		await rm(root, { recursive: true, force: true });
	});

	it("serves a fetched package from the dev server and leaves URLs to the browser", async () => {
		const server = await devServer(
			`import { used } from "pkg-a";\nimport { direct } from "${DIRECT}";\nconsole.log(used(), direct);`,
			mockCdn(),
		);
		try {
			const main = await server.transformRequest("/main.js");
			expect(main?.code).toContain('from "/@id/pkg-a"');
			expect(main?.code).toContain(`from "${DIRECT}"`);

			// The browser requests /@id/pkg-a, which the dev server transforms as the id pkg-a.
			const pkgA = await server.transformRequest("pkg-a");
			expect(pkgA?.code).toContain(`from "${HELPER}"`);
			expect(pkgA?.code).toContain('from "/@id/pkg-b"');
		} finally {
			await server.close();
		}
	});

	it("refetches a failed request on the next page load", async () => {
		const cdnFetch = mockCdn();
		const fetchImpl = vi.fn<FetchImpl>(async (url) => cdnFetch(url));
		fetchImpl.mockRejectedValueOnce(new Error("ECONNRESET"));
		const server = await devServer('import { b } from "pkg-b";\nconsole.log(b);', fetchImpl);
		try {
			await expect(server.transformRequest("/main.js")).rejects.toThrow(/pkg-b/);

			const main = await server.transformRequest("/main.js");
			expect(main?.code).toContain('from "/@id/pkg-b"');
			expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([PKG_B, PKG_B]);
		} finally {
			await server.close();
		}
	});

	it("does not fetch index.html when the root has none", async () => {
		await rm(path.join(root, "index.html"));
		const fetchImpl = mockCdn();
		const server = await devServer('import { b } from "pkg-b";\nconsole.log(b);', fetchImpl);
		try {
			const main = await server.transformRequest("/main.js");
			expect(main?.code).toContain('from "/@id/pkg-b"');
			expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([PKG_B]);
		} finally {
			await server.close();
		}
	});
});
