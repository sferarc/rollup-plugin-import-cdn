import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type LogLevel, type RollupLog, type RollupOptions, rollup } from "rollup";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { importCdn } from "./index";
import type { FetchImpl } from "./types";

const PKG_A = "https://cdn.skypack.dev/pkg-a";
const PKG_A_REDIRECT = "https://cdn.skypack.dev/-/pkg-a@1.0.0/dist/index.js";
const HELPER = "https://cdn.skypack.dev/-/pkg-a@1.0.0/dist/helper.js";
const SHARED = "https://cdn.skypack.dev/-/shared@1.0.0/index.js";
const PKG_B = "https://cdn.skypack.dev/pkg-b";
const DIRECT = "https://esm.test/direct.js";

// pkg-a redirects to a pinned path, so its relative and root-relative imports resolve against it.
const cdn: Record<string, { url?: string; body: string }> = {
	[PKG_A]: {
		url: PKG_A_REDIRECT,
		body: [
			'import { helper } from "./helper.js";',
			'import { shared } from "/-/shared@1.0.0/index.js";',
			'import { b } from "pkg-b";',
			"export const used = () => helper() + shared + b;",
			'export const unused = () => "UNUSED_EXPORT";',
		].join("\n"),
	},
	[HELPER]: {
		body: 'import { b } from "pkg-b";\nexport const helper = () => "HELPER" + b;',
	},
	[SHARED]: { body: 'export const shared = "SHARED";' },
	[PKG_B]: { body: 'export const b = "PKG_B";' },
	[DIRECT]: { body: 'export const direct = "DIRECT";' },
};

function mockCdn() {
	const fetchImpl = vi.fn<FetchImpl>(async (url) => {
		const entry = cdn[url];
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

async function build(options: RollupOptions) {
	const bundle = await rollup({ onwarn: (warning) => expect.fail(warning.message), ...options });
	const { output } = await bundle.generate({ format: "es" });
	await bundle.close();
	return output.map((chunk) => (chunk.type === "chunk" ? chunk.code : "")).join("\n");
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

	it("refetches every URL when the same plugin instance builds again", async () => {
		const { fetchImpl, fetchCounts } = mockCdn();
		const plugin = importCdn({ fetchImpl });

		const first = await build({ input: entry, plugins: [plugin] });
		const second = await build({ input: entry, plugins: [plugin] });

		expect(second).toBe(first);
		expect(Object.values(fetchCounts())).toEqual([2, 2, 2, 2, 2]);
	});

	it("reports CDN network errors through Rollup's log handlers", async () => {
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

	it("fails the build when a URL's body does not match its integrity entry", async () => {
		const { fetchImpl } = mockCdn();
		await writeFile(entry, `import { direct } from "${DIRECT}";\nconsole.log(direct);`);
		const integrity = integrityFor("export const direct = 1;");

		await expect(
			rollup({ input: entry, plugins: [importCdn({ fetchImpl, integrity })] }),
		).rejects.toThrow(`Integrity check failed for ${DIRECT}: expected ${integrity[DIRECT]}`);
	});
});
