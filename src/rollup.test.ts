import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	type LogLevel,
	type Plugin,
	type RollupLog,
	type RollupOptions,
	type RollupWatchOptions,
	rollup,
	type SourceMap,
	VERSION,
	watch,
} from "rollup";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { importCdn } from "./index";
import type { FetchImpl } from "./types";

const PKG_A = "https://cdn.skypack.dev/pkg-a";
const PKG_A_REDIRECT = "https://cdn.skypack.dev/-/pkg-a@1.0.0/dist/index.js";
const HELPER = "https://cdn.skypack.dev/-/pkg-a@1.0.0/dist/helper.js";
const SHARED = "https://cdn.skypack.dev/-/shared@1.0.0/index.js";
const PKG_B = "https://cdn.skypack.dev/pkg-b";
const DIRECT = "https://esm.test/direct.js";
const PKG_WASM = "https://cdn.skypack.dev/pkg-wasm";
const PKG_WASM_REDIRECT = "https://cdn.skypack.dev/-/pkg-wasm@1.0.0/dist/index.js";

const PKG_A_BODY = [
	'import { helper } from "./helper.js";',
	'import { shared } from "/-/shared@1.0.0/index.js";',
	'import { b } from "pkg-b";',
	"export const used = () => helper() + shared + b;",
	'export const unused = () => "UNUSED_EXPORT";',
].join("\n");

// pkg-a redirects to a pinned path, so its relative and root-relative imports resolve against it.
const cdn: Record<string, { url?: string; body: string }> = {
	[PKG_A]: { url: PKG_A_REDIRECT, body: PKG_A_BODY },
	[PKG_A_REDIRECT]: { body: PKG_A_BODY },
	[HELPER]: {
		body: 'import { b } from "pkg-b";\nexport const helper = () => "HELPER" + b;',
	},
	[SHARED]: { body: 'export const shared = "SHARED";' },
	[PKG_B]: { body: 'export const b = "PKG_B";' },
	[DIRECT]: { body: 'export const direct = "DIRECT";' },
	[PKG_WASM]: {
		url: PKG_WASM_REDIRECT,
		body: 'export const wasm = new URL("./mod.wasm", import.meta.url).href;',
	},
};

// esm.sh shapes seen with curl on 2026-11-01: pinned stubs, minified imports, a range and a /node/ polyfill.
const ESM_SH_LIB = "https://esm.sh/lib@1.0.0/es2022/lib.mjs";
// The rewrite resolves with `URL`, which keeps `^` on Node 22 and encodes it as `%5E` on Node 24.
const ESM_SH_SCHED_RANGE = new URL("/sched@^1.0.0?target=es2022", "https://esm.sh/").href;
const esmShLibStub = {
	body: '/* esm.sh - lib@1.0.0 */\nexport * from "/lib@1.0.0/es2022/lib.mjs";',
};
const esmShLibDomStub = {
	body: [
		"/* esm.sh - lib-dom@1.0.0 */",
		'import "/lib@1.0.0/es2022/lib.mjs";',
		'import "/node/process.mjs";',
		'export * from "/lib-dom@1.0.0/es2022/lib-dom.mjs";',
	].join("\n"),
};
const esmShGraph: typeof cdn = {
	"https://esm.sh/lib": esmShLibStub,
	"https://esm.sh/lib@1.0.0": esmShLibStub,
	"https://esm.sh/lib-dom": esmShLibDomStub,
	"https://esm.sh/lib-dom@1.0.0": esmShLibDomStub,
	[ESM_SH_LIB]: { body: 'export const state = { id: "LIB_STATE" };' },
	"https://esm.sh/lib-dom@1.0.0/es2022/lib-dom.mjs": {
		body: 'import*as __0$ from"/lib@1.0.0/es2022/lib.mjs";import*as __1$ from"/sched@^1.0.0?target=es2022";export const root=()=>__0$.state.id+__1$.tick;',
	},
	[ESM_SH_SCHED_RANGE]: {
		body: '/* esm.sh - sched@1.0.2 */\nexport * from "/sched@1.0.2/es2022/sched.mjs";',
	},
	"https://esm.sh/sched@1.0.2/es2022/sched.mjs": { body: 'export const tick = "SCHED_TICK";' },
	"https://esm.sh/node/process.mjs": { body: "globalThis.NODE_PROCESS_POLYFILL = true;" },
};
const ESM_SH_ENTRY = [
	'import { state } from "lib";',
	'import { root } from "lib-dom";',
	"console.log(root(), state);",
].join("\n");

function mockCdn(extra: typeof cdn = {}) {
	const fetchImpl = vi.fn<FetchImpl>(async (url) => {
		const entry = extra[url] ?? cdn[url];
		return {
			ok: entry !== undefined,
			status: entry ? 200 : 404,
			url: entry?.url ?? url,
			text: async () => entry?.body ?? "Not found",
		};
	});
	const fetchCounts = () => {
		const counts: Record<string, number> = {};
		for (const [url] of fetchImpl.mock.calls) counts[url] = (counts[url] ?? 0) + 1;
		return counts;
	};
	return { fetchImpl, fetchCounts };
}

// `logLevel` and `onLog` arrived in Rollup 3.25; the CI Rollup 3 leg runs 3.0.
const [major = 0, minor = 0] = VERSION.split(".").map(Number);
const hasOnLog = major > 3 || (major === 3 && minor >= 25);
const hasSourcemapIgnoreList = major > 3 || (major === 3 && minor >= 16);

// Rollup writes `x_google_ignoreList` on output maps but leaves it out of the `SourceMap` type.
const ignoredSources = (map: SourceMap | null) =>
	(map as { x_google_ignoreList?: number[] } | null)?.x_google_ignoreList?.map(
		(index) => map?.sources[index],
	);

async function build(options: RollupOptions) {
	const bundle = await rollup({ onwarn: (warning) => expect.fail(warning.message), ...options });
	const { output } = await bundle.generate({ format: "es" });
	await bundle.close();
	return output.map((chunk) => (chunk.type === "chunk" ? chunk.code : "")).join("\n");
}

// The OS watcher may not be armed when the first build ends, so `rebuild` rewrites the file until one fires.
function startWatch(options: RollupWatchOptions) {
	const watcher = watch({ onwarn: (warning) => expect.fail(warning.message), ...options });
	const failure = new Promise<never>((_, reject) => {
		watcher.on("event", (event) => {
			if (event.code === "ERROR") reject(event.error);
			if (event.code === "BUNDLE_END") void event.result.close();
		});
	});
	failure.catch(() => {});
	const nextEnd = () =>
		Promise.race([
			failure,
			new Promise<void>((resolve) => {
				const onEvent = (event: { code: string }) => {
					if (event.code !== "END") return;
					watcher.off("event", onEvent);
					resolve();
				};
				watcher.on("event", onEvent);
			}),
		]);
	const rebuild = (file: string, contents: string) => {
		const rebuilt = nextEnd();
		const touch = setInterval(() => void writeFile(file, contents), 100);
		return rebuilt.finally(() => clearInterval(touch));
	};
	return { nextEnd, rebuild, close: () => watcher.close() };
}

describe("Rollup build", () => {
	let dir: string;
	let entry: string;
	let globalFetch: MockInstance<typeof fetch>;

	beforeEach(async () => {
		globalFetch = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValue(new Error("Tests must not use the global fetch"));
		dir = await mkdtemp(path.join(tmpdir(), "import-cdn-rollup-"));
		entry = path.join(dir, "index.js");
		await writeFile(
			entry,
			[
				'import { used } from "pkg-a";',
				`import { direct } from "${DIRECT}";`,
				'import { local } from "./local.js";',
				"console.log(used(), direct, local);",
			].join("\n"),
		);
		await writeFile(path.join(dir, "local.js"), 'export const local = "LOCAL";');
	});

	afterEach(async () => {
		expect(globalFetch).not.toHaveBeenCalled();
		await rm(dir, { recursive: true, force: true });
	});

	it("bundles bare, URL, relative, root-relative and local imports into one chunk", async () => {
		const { fetchImpl } = mockCdn();
		const code = await build({ input: entry, plugins: [importCdn({ fetchImpl })] });

		for (const marker of ['"HELPER"', '"SHARED"', '"PKG_B"', '"DIRECT"', '"LOCAL"']) {
			expect(code).toContain(marker);
		}
		expect(code).not.toMatch(/\bimport\b|https?:\/\//);
	});

	it("leaves a cwd-relative entry path to Rollup instead of fetching it", async () => {
		const { fetchImpl, fetchCounts } = mockCdn();
		// `input: "src/index.js"`, as in the README: relative to cwd, with no leading `./`.
		const local = await mkdtemp(path.join(process.cwd(), "import-cdn-entry-"));
		try {
			await writeFile(
				path.join(local, "index.js"),
				`import { direct } from "${DIRECT}";\nconsole.log(direct);`,
			);
			const input = path.relative(process.cwd(), path.join(local, "index.js"));

			const code = await build({ input, plugins: [importCdn({ fetchImpl })] });

			expect(code).toContain('"DIRECT"');
			expect(fetchCounts()).toEqual({ [DIRECT]: 1 });
		} finally {
			await rm(local, { recursive: true, force: true });
		}
	});

	it("leaves a virtual: module to the plugin listed after it", async () => {
		const { fetchImpl, fetchCounts } = mockCdn();
		await writeFile(entry, 'import { greeting } from "virtual:greeting";\nconsole.log(greeting);');
		const virtual: Plugin = {
			name: "virtual-greeting",
			resolveId: (id) => (id === "virtual:greeting" ? id : undefined),
			load: (id) => (id === "virtual:greeting" ? 'export const greeting = "VIRTUAL";' : undefined),
		};

		const code = await build({ input: entry, plugins: [importCdn({ fetchImpl }), virtual] });

		expect(code).toContain('"VIRTUAL"');
		expect(fetchCounts()).toEqual({});
	});

	it("leaves a module a custom priority function skips to the plugin listed after it", async () => {
		const { fetchImpl, fetchCounts } = mockCdn();
		await writeFile(entry, 'import { greeting } from "greeting";\nconsole.log(greeting);');
		const local: Plugin = {
			name: "local-greeting",
			resolveId: (id) => (id === "greeting" ? "\0greeting" : undefined),
			load: (id) => (id === "\0greeting" ? 'export const greeting = "LOCAL";' : undefined),
		};
		const priority = [
			(key: string) => (key === "greeting" ? undefined : `https://cdn.test/${key}`),
		];

		const code = await build({
			input: entry,
			plugins: [importCdn({ fetchImpl, priority }), local],
		});

		expect(code).toContain('"LOCAL"');
		expect(fetchCounts()).toEqual({});
	});

	it("leaves a virtual: entry too long to be a file name to the plugin listed after it", async () => {
		const { fetchImpl, fetchCounts } = mockCdn();
		// One path segment over 255 bytes: stat fails with ENAMETOOLONG rather than ENOENT.
		const input = `virtual:${"a".repeat(300)}`;
		const virtual: Plugin = {
			name: "virtual-entry",
			resolveId: (id) => (id === input ? id : undefined),
			load: (id) => (id === input ? 'console.log("VIRTUAL_ENTRY");' : undefined),
		};

		const code = await build({ input, plugins: [importCdn({ fetchImpl }), virtual] });

		expect(code).toContain('"VIRTUAL_ENTRY"');
		expect(fetchCounts()).toEqual({});
	});

	it("leaves a #subpath import to the plugin listed after it", async () => {
		const { fetchImpl, fetchCounts } = mockCdn();
		await writeFile(entry, 'import { greeting } from "#greeting";\nconsole.log(greeting);');
		const imports: Plugin = {
			name: "subpath-imports",
			resolveId: (id) => (id === "#greeting" ? "\0greeting" : undefined),
			load: (id) => (id === "\0greeting" ? 'export const greeting = "SUBPATH";' : undefined),
		};

		const code = await build({ input: entry, plugins: [importCdn({ fetchImpl }), imports] });

		expect(code).toContain('"SUBPATH"');
		expect(fetchCounts()).toEqual({});
	});

	it("points import.meta.url in a CDN module at the URL it was served from", async () => {
		const { fetchImpl } = mockCdn();
		await writeFile(
			entry,
			[
				'import { wasm } from "pkg-wasm";',
				`import { direct } from "${DIRECT}";`,
				"console.log(wasm, direct, import.meta.url);",
			].join("\n"),
		);

		const code = await build({ input: entry, plugins: [importCdn({ fetchImpl })] });

		expect(code).toContain(`new URL("./mod.wasm", "${PKG_WASM_REDIRECT}")`);
		// The local entry keeps its own import.meta.url.
		expect(code).toContain("console.log(wasm, direct, import.meta.url)");
	});

	it("keeps import.meta.url at the served URL on a rebuild from Rollup's cache", async () => {
		const { fetchImpl } = mockCdn();
		await writeFile(entry, 'import { wasm } from "pkg-wasm";\nconsole.log(wasm);');
		const plugin = importCdn({ fetchImpl });

		// Watch mode does this: one plugin instance, and the previous build's cache, so Rollup
		// reuses the resolved ids of unchanged modules and skips resolveId for them.
		const first = await rollup({ input: entry, plugins: [plugin] });
		await first.close();
		const code = await build({ input: entry, plugins: [plugin], cache: first.cache });

		expect(code).toContain(`new URL("./mod.wasm", "${PKG_WASM_REDIRECT}")`);
	});

	it("names each CDN module in the sourcemap by the URL it was served from", async () => {
		const { fetchImpl } = mockCdn();
		const bundle = await rollup({ input: entry, plugins: [importCdn({ fetchImpl })] });
		const { output } = await bundle.generate({
			format: "es",
			sourcemap: true,
			file: path.join(dir, "dist", "bundle.js"),
		});
		await bundle.close();

		expect([...(output[0].map?.sources ?? [])].sort()).toEqual(
			[PKG_A_REDIRECT, HELPER, SHARED, PKG_B, DIRECT, "../index.js", "../local.js"].sort(),
		);
	});

	it("applies a sourcemapPathTransform to local sources only", async () => {
		const { fetchImpl } = mockCdn();
		const transform = vi.fn((source: string) => `src://${source}`);
		const bundle = await rollup({ input: entry, plugins: [importCdn({ fetchImpl })] });
		const { output } = await bundle.generate({
			format: "es",
			sourcemap: true,
			file: path.join(dir, "dist", "bundle.js"),
			sourcemapPathTransform: transform,
		});
		await bundle.close();

		expect(output[0].map?.sources).toContain("src://../local.js");
		expect(output[0].map?.sources).toContain(DIRECT);
		expect(transform.mock.calls.map(([source]) => source).sort()).toEqual([
			"../index.js",
			"../local.js",
		]);
	});

	it("puts each CDN module on the sourcemap ignore list", async () => {
		const { fetchImpl } = mockCdn();
		const warnings: string[] = [];
		const bundle = await rollup({
			input: entry,
			plugins: [importCdn({ fetchImpl })],
			onwarn: (warning) => warnings.push(warning.message),
		});
		const { output } = await bundle.generate({
			format: "es",
			sourcemap: true,
			file: path.join(dir, "dist", "bundle.js"),
		});
		await bundle.close();

		const ignored = ignoredSources(output[0].map);
		// Before 3.16 Rollup has no ignore list and would warn about the option as unknown.
		expect(ignored?.sort()).toEqual(
			hasSourcemapIgnoreList ? [PKG_A_REDIRECT, HELPER, SHARED, PKG_B, DIRECT].sort() : undefined,
		);
		expect(warnings).toEqual([]);
	});

	it.skipIf(!hasSourcemapIgnoreList)(
		"leaves a sourcemapIgnoreList of your own in charge of every source",
		async () => {
			const { fetchImpl } = mockCdn();
			const ignoreList = vi.fn((source: string) => source.endsWith("local.js"));
			const bundle = await rollup({ input: entry, plugins: [importCdn({ fetchImpl })] });
			const { output } = await bundle.generate({
				format: "es",
				sourcemap: true,
				file: path.join(dir, "dist", "bundle.js"),
				sourcemapIgnoreList: ignoreList,
			});
			await bundle.close();

			expect(ignoredSources(output[0].map)).toEqual(["../local.js"]);
			expect(ignoreList).toHaveBeenCalledTimes(7);
		},
	);

	it("tree-shakes an unused export of a CDN module", async () => {
		const { fetchImpl } = mockCdn();
		const code = await build({ input: entry, plugins: [importCdn({ fetchImpl })] });

		expect(code).toContain("const used =");
		expect(code).not.toContain("UNUSED_EXPORT");
	});

	it("fetches each URL once per build, even when imported twice", async () => {
		const { fetchImpl, fetchCounts } = mockCdn();
		await build({ input: entry, plugins: [importCdn({ fetchImpl })] });

		expect(fetchCounts()).toEqual({
			[PKG_A]: 1,
			[HELPER]: 1,
			[SHARED]: 1,
			[PKG_B]: 1,
			[DIRECT]: 1,
		});
	});

	it("bundles a module once when it is imported by bare name and by the URL it redirects to", async () => {
		await writeFile(
			entry,
			[
				'import { used } from "pkg-a";',
				`import { used as again } from "${PKG_A_REDIRECT}";`,
				"console.log(used === again);",
			].join("\n"),
		);
		const { fetchImpl } = mockCdn();
		const code = await build({ input: entry, plugins: [importCdn({ fetchImpl })] });

		expect(code.match(/const used\S* =/g)).toHaveLength(1);
		expect(code).toContain("console.log(used === used);");
	});

	it("bundles a jsdelivr package once when versions pins it to the path its dependents import", async () => {
		const lib = "https://cdn.jsdelivr.net/npm/lib@1.0.0/+esm";
		const libBody = 'export const state = { id: "LIB_STATE" };';
		const { fetchImpl, fetchCounts } = mockCdn({
			[lib]: { body: libBody },
			"https://cdn.jsdelivr.net/npm/lib-dom@1.0.0/client/+esm": {
				body: 'import { state } from "/npm/lib@1.0.0/+esm";\nexport const root = () => state;',
			},
		});
		await writeFile(
			entry,
			[
				'import { state } from "lib";',
				'import { root } from "lib-dom/client";',
				"console.log(root() === state);",
			].join("\n"),
		);
		const plugin = importCdn({
			fetchImpl,
			priority: ["jsdelivr"],
			versions: { lib: "1.0.0", "lib-dom": "1.0.0" },
		});

		const code = await build({ input: entry, plugins: [plugin] });

		expect(code.match(/LIB_STATE/g)).toHaveLength(1);
		expect(fetchCounts()[lib]).toBe(1);
	});

	it("bundles an esm.sh package once without versions, since its stub and dependents import one build path", async () => {
		const { fetchImpl, fetchCounts } = mockCdn(esmShGraph);
		await writeFile(entry, ESM_SH_ENTRY);

		const code = await build({
			input: entry,
			plugins: [importCdn({ fetchImpl, priority: ["esm.sh"] })],
		});

		expect(code.match(/LIB_STATE/g)).toHaveLength(1);
		expect(code).toContain('"SCHED_TICK"');
		expect(code).toContain("NODE_PROCESS_POLYFILL");
		expect(code).not.toContain("esm.sh");
		expect(fetchCounts()[ESM_SH_LIB]).toBe(1);
	});

	it("refetches esm.sh range and /node/ imports on an offline rebuild with the on-disk cache", async () => {
		const { fetchImpl } = mockCdn(esmShGraph);
		await writeFile(entry, ESM_SH_ENTRY);
		const options = {
			priority: ["esm.sh" as const],
			cache: path.join(dir, "cache"),
			versions: { lib: "1.0.0", "lib-dom": "1.0.0" },
		};
		await build({ input: entry, plugins: [importCdn({ ...options, fetchImpl })] });

		const offline = vi.fn<FetchImpl>(async () => {
			throw new Error("offline");
		});
		const warnings: RollupLog[] = [];
		const bundle = await rollup({
			input: entry,
			onwarn: (warning) => {
				warnings.push(warning);
			},
			plugins: [importCdn({ ...options, fetchImpl: offline })],
		});
		await bundle.close();

		expect(offline.mock.calls.map(([url]) => url).sort()).toEqual([
			"https://esm.sh/node/process.mjs",
			ESM_SH_SCHED_RANGE,
		]);
		expect(warnings.filter(({ code }) => code === "PLUGIN_WARNING")).toHaveLength(2);
	});

	it("keeps two modules served from one URL apart when their bodies differ", async () => {
		await writeFile(
			entry,
			[
				'import { used } from "pkg-a";',
				`import { used as again } from "${PKG_A_REDIRECT}";`,
				"console.log(used, again);",
			].join("\n"),
		);
		const { fetchImpl } = mockCdn();
		fetchImpl.mockImplementation(async (url) => ({
			ok: true,
			status: 200,
			url: cdn[url]?.url ?? url,
			text: async () =>
				url === PKG_A_REDIRECT ? 'export const used = () => "SECOND_BODY";' : cdn[url]!.body,
		}));
		const code = await build({ input: entry, plugins: [importCdn({ fetchImpl })] });

		expect(code).toContain('"SECOND_BODY"');
		expect(code).toContain('"HELPER"');
	});

	it("refetches every URL when the same plugin instance builds again", async () => {
		const { fetchImpl, fetchCounts } = mockCdn();
		const plugin = importCdn({ fetchImpl });

		const first = await build({ input: entry, plugins: [plugin] });
		const second = await build({ input: entry, plugins: [plugin] });

		expect(second).toBe(first);
		expect(Object.values(fetchCounts())).toEqual([2, 2, 2, 2, 2]);
	});

	it("rebuilds from the on-disk cache with a fetchImpl that throws", async () => {
		const { fetchImpl: pinnedFetch, fetchCounts } = mockCdn({
			"https://cdn.skypack.dev/pkg-a@1.0.0": cdn[PKG_A]!,
			"https://cdn.skypack.dev/pkg-b@1.0.0": cdn[PKG_B]!,
		});
		const cacheDir = path.join(dir, "cache");
		const versions = { "pkg-a": "1.0.0", "pkg-b": "1.0.0" };
		const pinnedEntry = path.join(dir, "pinned.js");
		await writeFile(
			pinnedEntry,
			[
				'import { used } from "pkg-a";',
				'import { b } from "pkg-b";',
				"console.log(used(), b);",
			].join("\n"),
		);

		const first = await build({
			input: pinnedEntry,
			plugins: [importCdn({ fetchImpl: pinnedFetch, cache: cacheDir, versions })],
		});
		expect(Object.keys(fetchCounts()).sort()).toEqual([
			"https://cdn.skypack.dev/-/pkg-a@1.0.0/dist/helper.js",
			"https://cdn.skypack.dev/-/shared@1.0.0/index.js",
			"https://cdn.skypack.dev/pkg-a@1.0.0",
			"https://cdn.skypack.dev/pkg-b@1.0.0",
		]);

		const offline = vi.fn<FetchImpl>(async () => {
			throw new Error("The cache should have served every URL");
		});
		const second = await build({
			input: pinnedEntry,
			plugins: [importCdn({ fetchImpl: offline, cache: cacheDir, versions })],
		});

		expect(offline).not.toHaveBeenCalled();
		expect(second).toBe(first);
		expect(second).toContain('"HELPER"');
	});

	it("writes two entries and their shared chunk to disk with one fetch per URL", async () => {
		const { fetchImpl, fetchCounts } = mockCdn();
		const second = path.join(dir, "second.js");
		const outDir = path.join(dir, "out");
		await writeFile(entry, `import { direct } from "${DIRECT}";\nconsole.log("A", direct);`);
		await writeFile(second, `import { direct } from "${DIRECT}";\nconsole.log("B", direct);`);

		const bundle = await rollup({
			input: [entry, second],
			onwarn: (warning) => expect.fail(warning.message),
			plugins: [importCdn({ fetchImpl })],
		});
		try {
			await bundle.write({ dir: outDir, format: "es" });
		} finally {
			await bundle.close();
		}

		const files = await readdir(outDir);
		expect(files).toHaveLength(3);
		const codes = await Promise.all(files.map((file) => readFile(path.join(outDir, file), "utf8")));
		expect(codes.filter((code) => code.includes('"DIRECT"'))).toHaveLength(1);
		expect(fetchCounts()).toEqual({ [DIRECT]: 1 });
	});

	it("rebuilds in watch mode with Rollup's cache on, refetching and keeping one copy of a shared module", async () => {
		await writeFile(
			entry,
			[
				'import { used } from "pkg-a";',
				`import { used as again } from "${PKG_A_REDIRECT}";`,
				'import { local } from "./local.js";',
				"console.log(used === again, local);",
			].join("\n"),
		);
		const { fetchImpl, fetchCounts } = mockCdn();
		const file = path.join(dir, "out", "bundle.js");
		const watcher = startWatch({
			input: entry,
			output: { file, format: "es" },
			plugins: [importCdn({ fetchImpl })],
		});

		try {
			await watcher.nextEnd();
			const first = await readFile(file, "utf8");
			expect(fetchCounts()).toEqual({
				[PKG_A]: 1,
				[PKG_A_REDIRECT]: 1,
				[HELPER]: 1,
				[SHARED]: 1,
				[PKG_B]: 1,
			});

			await watcher.rebuild(path.join(dir, "local.js"), 'export const local = "LOCAL_V2";');
			const second = await readFile(file, "utf8");

			expect(second).toBe(first.replace('"LOCAL"', '"LOCAL_V2"'));
			expect(second.match(/const used\S* =/g)).toHaveLength(1);
			expect(second).toContain('"HELPER"');
			expect(second).toContain('"SHARED"');
			// Rollup's watch cache reuses resolved ids, so the redirect URL is not resolved again.
			expect(fetchCounts()).toEqual({
				[PKG_A]: 2,
				[PKG_A_REDIRECT]: 1,
				[HELPER]: 2,
				[SHARED]: 2,
				[PKG_B]: 2,
			});
		} finally {
			await watcher.close();
		}
	});

	it("serves pinned URLs from the on-disk cache on a watch rebuild", async () => {
		await writeFile(
			entry,
			[
				'import { used } from "pkg-a";',
				'import { local } from "./local.js";',
				"console.log(used(), local);",
			].join("\n"),
		);
		const { fetchImpl: pinnedFetch, fetchCounts } = mockCdn({
			"https://cdn.skypack.dev/pkg-a@1.0.0": cdn[PKG_A]!,
			"https://cdn.skypack.dev/pkg-b@1.0.0": cdn[PKG_B]!,
		});
		let online = true;
		const fetchImpl = vi.fn<FetchImpl>(async (url, init) => {
			if (!online) throw new Error("The cache should have served every URL");
			return pinnedFetch(url, init);
		});
		const file = path.join(dir, "out", "bundle.js");
		const watcher = startWatch({
			input: entry,
			output: { file, format: "es" },
			plugins: [
				importCdn({
					fetchImpl,
					cache: path.join(dir, "cache"),
					versions: { "pkg-a": "1.0.0", "pkg-b": "1.0.0" },
				}),
			],
		});

		try {
			await watcher.nextEnd();
			const first = await readFile(file, "utf8");
			expect(Object.keys(fetchCounts()).sort()).toEqual([
				"https://cdn.skypack.dev/-/pkg-a@1.0.0/dist/helper.js",
				"https://cdn.skypack.dev/-/shared@1.0.0/index.js",
				"https://cdn.skypack.dev/pkg-a@1.0.0",
				"https://cdn.skypack.dev/pkg-b@1.0.0",
			]);

			online = false;
			fetchImpl.mockClear();
			await watcher.rebuild(path.join(dir, "local.js"), 'export const local = "LOCAL_V2";');
			const second = await readFile(file, "utf8");

			expect(fetchImpl).not.toHaveBeenCalled();
			expect(second).toBe(first.replace('"LOCAL"', '"LOCAL_V2"'));
			expect(second).toContain('"HELPER"');
			expect(second).toContain('"SHARED"');
		} finally {
			await watcher.close();
		}
	});

	it.skipIf(!hasOnLog)("reports CDN network errors through Rollup's log handlers", async () => {
		await writeFile(entry, 'import { x } from "offline";\nconsole.log(x);');
		const logs: { level: LogLevel; log: RollupLog }[] = [];

		const bundle = await rollup({
			input: entry,
			logLevel: "debug",
			onLog: (level, log) => {
				logs.push({ level, log });
			},
			plugins: [
				importCdn({
					fetchImpl: async () => {
						throw new Error("ECONNREFUSED");
					},
					priority: ["skypack", (key) => `https://mirror.test/${key}`],
				}),
			],
		});
		await bundle.close();

		const fromPlugin = logs.filter(({ log }) => log.plugin === "plugin-import-cdn");
		const debug = fromPlugin.filter(({ level }) => level === "debug").map(({ log }) => log.message);
		expect(debug).toEqual([
			expect.stringContaining(
				"Failed to fetch offline from https://cdn.skypack.dev/offline: ECONNREFUSED",
			),
			expect.stringContaining(
				"Failed to fetch offline from https://mirror.test/offline: ECONNREFUSED",
			),
		]);
		const warnings = fromPlugin.filter(({ level }) => level === "warn");
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.log.code).toBe("PLUGIN_WARNING");
		expect(warnings[0]?.log.message).toContain("Could not resolve dependency offline");
	});

	it("fails the build when a custom priority function returns a relative URL", async () => {
		const { fetchImpl, fetchCounts } = mockCdn();
		await writeFile(entry, 'import { x } from "lib";\nconsole.log(x);');

		await expect(
			rollup({
				input: entry,
				plugins: [importCdn({ fetchImpl, priority: [(key) => `${key}.js`] })],
			}),
		).rejects.toThrow(
			'priority[0] returned "lib.js" for lib; expected an absolute URL or undefined',
		);
		expect(fetchCounts()).toEqual({});
	});

	it("fails the build with every attempted URL when all CDNs return 404", async () => {
		const { fetchImpl } = mockCdn();
		await writeFile(entry, 'import { x } from "missing";\nconsole.log(x);');

		const error = await rollup({
			input: entry,
			plugins: [
				importCdn({ fetchImpl, priority: ["skypack", (key) => `https://mirror.test/${key}`] }),
			],
		}).catch((cause: unknown) => cause);

		expect(error).toBeInstanceOf(Error);
		const { message } = error as Error;
		expect(message).toContain("https://cdn.skypack.dev/missing: HTTP 404");
		expect(message).toContain("https://mirror.test/missing: HTTP 404");
	});

	it("puts a CDN module shared by two entries in one chunk and fetches it once", async () => {
		const { fetchImpl, fetchCounts } = mockCdn();
		const second = path.join(dir, "second.js");
		await writeFile(entry, `import { direct } from "${DIRECT}";\nconsole.log("A", direct);`);
		await writeFile(second, `import { direct } from "${DIRECT}";\nconsole.log("B", direct);`);

		const bundle = await rollup({
			input: [entry, second],
			onwarn: (warning) => expect.fail(warning.message),
			plugins: [importCdn({ fetchImpl })],
		});
		const { output } = await bundle.generate({ format: "es" });
		await bundle.close();

		const chunks = output.filter((item) => item.type === "chunk");
		expect(chunks).toHaveLength(3);
		const holders = chunks.filter((chunk) => chunk.code.includes('"DIRECT"'));
		expect(holders).toHaveLength(1);
		expect(holders[0]?.isEntry).toBe(false);
		expect(fetchCounts()).toEqual({ [DIRECT]: 1 });
		expect(chunks.map((chunk) => chunk.code).join("\n")).not.toMatch(/https?:\/\//);
	});

	it("builds CDN modules into CommonJS output", async () => {
		const { fetchImpl } = mockCdn();
		const bundle = await rollup({
			input: entry,
			onwarn: (warning) => expect.fail(warning.message),
			plugins: [importCdn({ fetchImpl })],
		});
		const { output } = await bundle.generate({ format: "cjs" });
		await bundle.close();

		expect(output).toHaveLength(1);
		const code = output[0]?.type === "chunk" ? output[0].code : "";
		for (const marker of ['"HELPER"', '"SHARED"', '"PKG_B"', '"DIRECT"', '"LOCAL"']) {
			expect(code).toContain(marker);
		}
		expect(code).not.toMatch(/\b(?:import|export)\b|https?:\/\//);
	});

	const integrityFor = (body: string) => ({
		[DIRECT]: `sha384-${createHash("sha384").update(body).digest("base64")}`,
	});

	it("builds when a URL's body matches its integrity entry", async () => {
		const { fetchImpl } = mockCdn();
		await writeFile(entry, `import { direct } from "${DIRECT}";\nconsole.log(direct);`);
		const integrity = integrityFor('export const direct = "DIRECT";');

		const code = await build({ input: entry, plugins: [importCdn({ fetchImpl, integrity })] });

		expect(code).toContain('"DIRECT"');
	});

	it("warns about an integrity entry that no URL fetched in the build matched", async () => {
		const { fetchImpl } = mockCdn();
		await writeFile(entry, `import { direct } from "${DIRECT}";\nconsole.log(direct);`);
		const stale = "https://esm.test/direct@0.9.0.js";
		const integrity = {
			...integrityFor('export const direct = "DIRECT";'),
			[stale]: integrityFor("")[DIRECT]!,
		};
		const warnings: RollupLog[] = [];

		const bundle = await rollup({
			input: entry,
			onwarn: (warning) => {
				warnings.push(warning);
			},
			plugins: [importCdn({ fetchImpl, integrity })],
		});
		await bundle.close();

		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.code).toBe("PLUGIN_WARNING");
		expect(warnings[0]?.plugin).toBe("plugin-import-cdn");
		expect(warnings[0]?.message).toContain(
			`The integrity entry for ${stale} matched no URL fetched in this build`,
		);
	});

	it("counts an integrity entry checked against an on-disk cache read as matched", async () => {
		const pinned = "https://cdn.skypack.dev/pkg-b@1.0.0";
		const { fetchImpl } = mockCdn({ [pinned]: cdn[PKG_B]! });
		await writeFile(entry, 'import { b } from "pkg-b";\nconsole.log(b);');
		const options = {
			cache: path.join(dir, "cache"),
			versions: { "pkg-b": "1.0.0" },
			integrity: {
				[pinned]: `sha384-${createHash("sha384").update(cdn[PKG_B]!.body).digest("base64")}`,
			},
		};
		await build({ input: entry, plugins: [importCdn({ ...options, fetchImpl })] });

		const offline = vi.fn<FetchImpl>(async () => {
			throw new Error("The cache should have served every URL");
		});
		const code = await build({
			input: entry,
			plugins: [importCdn({ ...options, fetchImpl: offline })],
		});

		expect(offline).not.toHaveBeenCalled();
		expect(code).toContain('"PKG_B"');
	});

	it("fails the build when a URL's body does not match its integrity entry", async () => {
		const { fetchImpl } = mockCdn();
		await writeFile(entry, `import { direct } from "${DIRECT}";\nconsole.log(direct);`);
		const integrity = integrityFor("export const direct = 1;");

		await expect(
			rollup({ input: entry, plugins: [importCdn({ fetchImpl, integrity })] }),
		).rejects.toThrow(`Integrity check failed for ${DIRECT}: expected ${integrity[DIRECT]}`);
	});
});
