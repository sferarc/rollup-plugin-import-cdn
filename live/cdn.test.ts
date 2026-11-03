import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type RollupOptions, rollup } from "rollup";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AvailableCDNs, type FetchImpl, importCdn } from "../src/index";

// Hits the real CDNs, so it runs only through `pnpm test:live` and the scheduled live workflow.
const PREACT = "10.19.3";
// Skypack answers 404 for many pinned scoped versions, so this has to be one it still serves.
const POPPER = "2.11.8";
const REACT_DOM = "18.2.0";
// Skypack served 17.0.1 for this pin on 2026-10-26 and 2026-10-28.
const REACT = "18.2.0";
// Skypack redirected this pin to `/error/build:...` with HTTP 200 (brain/architecture/resolution.md).
const SKYPACK_UNBUILDABLE = "3.4.0";
// jsDelivr served this pin's `+esm` as `/** Failed to bundle ...` with HTTP 200 (same note).
const JSDELIVR_UNBUILDABLE = "2.3.3";
// The README's integrity example hashes this URL.
const LODASH = "4.17.21";

const ENTRY = [
	'import { h, render } from "preact";',
	'import { useState } from "preact/hooks";',
	"console.log(h, render, useState);",
].join("\n");

const SCOPED_ENTRY = 'import { createPopper } from "@popperjs/core";\nconsole.log(createPopper);';

async function build(options: RollupOptions) {
	const bundle = await rollup({
		onwarn: (warning) => expect.fail(warning.message),
		...options,
	});
	const { output } = await bundle.generate({ format: "es" });
	await bundle.close();
	const [chunk, ...rest] = output;
	expect(rest).toEqual([]);
	if (chunk?.type !== "chunk") throw new Error("Expected one chunk");
	return chunk;
}

describe.each<AvailableCDNs>(["skypack", "esm.sh", "jsdelivr"])("live %s", (cdn) => {
	let dir: string;
	let entry: string;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "import-cdn-live-"));
		entry = path.join(dir, "index.js");
		await writeFile(entry, ENTRY);
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	async function expectPinnedOfflineRebuild(
		versions: Record<string, string>,
		otherVersion: RegExp,
	) {
		const options = { priority: [cdn], versions, cache: path.join(dir, "cache") };

		const online = await build({ input: entry, plugins: [importCdn(options)] });
		expect(online.imports).toEqual([]);
		expect(online.dynamicImports).toEqual([]);
		// Imports rewritten inside CDN modules are ids, so this catches a module served at another version.
		const cdnModules = Object.keys(online.modules).filter((id) => id !== entry);
		expect(cdnModules.length).toBeGreaterThan(0);
		for (const id of cdnModules) expect(id).not.toMatch(otherVersion);

		const offline: FetchImpl = async (url) => {
			throw new Error(`Not cached: ${url}`);
		};
		const cached = await build({
			input: entry,
			plugins: [importCdn({ ...options, fetchImpl: offline })],
		});
		expect(cached.code).toBe(online.code);
	}

	it("bundles a pinned package and its subpath, then rebuilds from the cache offline", async () => {
		await expectPinnedOfflineRebuild({ preact: PREACT }, /preact@v?(?!10\.19\.3)\d/);
	});

	it("bundles a pinned scoped package, then rebuilds from the cache offline", async () => {
		await writeFile(entry, SCOPED_ENTRY);
		await expectPinnedOfflineRebuild(
			{ "@popperjs/core": POPPER },
			/@popperjs\/core@v?(?!2\.11\.8)\d/,
		);
	});

	it("fails the build naming the URL for a package that does not exist", async () => {
		await writeFile(entry, 'import "rollup-plugin-import-cdn-no-such-package-0";');

		await expect(
			build({ input: entry, plugins: [importCdn({ priority: [cdn] })] }),
		).rejects.toThrow(/rollup-plugin-import-cdn-no-such-package-0.*HTTP 4\d\d/);
	});
});

describe("live esm.sh deps query", () => {
	let dir: string;
	let entry: string;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "import-cdn-live-"));
		entry = path.join(dir, "index.js");
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	async function buildOnlineThenOffline(specifier: string) {
		await writeFile(entry, `import ReactDOM from "${specifier}";\nconsole.log(ReactDOM);`);
		const options = {
			priority: ["esm.sh" as const],
			versions: { "react-dom": REACT_DOM },
			cache: path.join(dir, "cache"),
		};
		const online = await build({ input: entry, plugins: [importCdn(options)] });
		const requested: string[] = [];
		const offline: FetchImpl = async (url) => {
			requested.push(url);
			throw new Error(`Not cached: ${url}`);
		};
		const plugin = importCdn({ ...options, fetchImpl: offline });
		return { online, requested, rebuild: () => build({ input: entry, plugins: [plugin] }) };
	}

	it("fetches the range import of an unpinned dependency on every build", async () => {
		const { requested, rebuild } = await buildOnlineThenOffline("react-dom");

		await expect(rebuild()).rejects.toThrow(/Not cached: https:\/\/esm\.sh\/scheduler@%5E/);
		expect(requested).toEqual([expect.stringMatching(/^https:\/\/esm\.sh\/scheduler@%5E/)]);
	});

	it("pins that dependency with deps, so the offline rebuild matches", async () => {
		const { online, requested, rebuild } = await buildOnlineThenOffline(
			"react-dom?deps=scheduler@0.23.2",
		);

		const cached = await rebuild();
		expect(requested).toEqual([]);
		expect(cached.code).toBe(online.code);
	});
});

describe("live Skypack served version", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "import-cdn-live-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("bundles the pinned react whether Skypack serves it or esm.sh takes over", async () => {
		const entry = path.join(dir, "index.js");
		await writeFile(entry, 'import { version } from "react";\nconsole.log(version);');

		const chunk = await build({
			input: entry,
			plugins: [importCdn({ priority: ["skypack", "esm.sh"], versions: { react: REACT } })],
		});
		const cdnModules = Object.keys(chunk.modules).filter((id) => id !== entry);
		expect(cdnModules).toContainEqual(expect.stringMatching(/react@v?18\.2\.0/));
		for (const id of cdnModules) expect(id).not.toMatch(/react@v?(?!18\.2\.0)\d/);
		expect(chunk.code).toContain(`"${REACT}"`);
		expect(chunk.code).not.toMatch(/"17\.0\.\d"/);
	});
});

// Both CDNs answer HTTP 200 for a package they cannot build, with a module that throws when run.
// A side-effect import bundles that module without complaint unless the plugin rejects it.
describe("live CDN build errors", () => {
	let dir: string;
	let entry: string;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "import-cdn-live-"));
		entry = path.join(dir, "index.js");
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("fails the build when Skypack redirects to its build error page", async () => {
		await writeFile(entry, 'import "vue";');

		await expect(
			build({
				input: entry,
				plugins: [importCdn({ priority: ["skypack"], versions: { vue: SKYPACK_UNBUILDABLE } })],
			}),
		).rejects.toThrow(
			/Failed to fetch vue from https:\/\/cdn\.skypack\.dev\/vue@3\.4\.0: Skypack could not build the package \(https:\/\/cdn\.skypack\.dev\/error\/build:/,
		);
	});

	it("fails the build when jsDelivr serves a module that failed to bundle", async () => {
		await writeFile(entry, 'import "fsevents";');

		await expect(
			build({
				input: entry,
				plugins: [
					importCdn({ priority: ["jsdelivr"], versions: { fsevents: JSDELIVR_UNBUILDABLE } }),
				],
			}),
		).rejects.toThrow(
			/Failed to fetch fsevents from https:\/\/cdn\.jsdelivr\.net\/npm\/fsevents@2\.3\.3\/\+esm: jsDelivr could not build the package \(Failed to bundle/,
		);
	});
});

// The README has users hash the raw bytes with curl and openssl, while the plugin hashes text() as UTF-8.
describe("live esm.sh integrity", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "import-cdn-live-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("builds with sha384 values of the raw bytes and fails on a tampered one", async () => {
		const entry = path.join(dir, "index.js");
		await writeFile(entry, 'import _ from "lodash";\nconsole.log(_.chunk);');
		const hashes: Record<string, string> = {};
		const hashing: FetchImpl = async (url, init) => {
			const response = await fetch(url, init);
			const bytes = new Uint8Array(await response.clone().arrayBuffer());
			hashes[url] = `sha384-${createHash("sha384").update(bytes).digest("base64")}`;
			return response;
		};
		const options = { priority: ["esm.sh" as const], versions: { lodash: LODASH } };

		const online = await build({
			input: entry,
			plugins: [importCdn({ ...options, fetchImpl: hashing })],
		});
		const stub = `https://esm.sh/lodash@${LODASH}`;
		expect(Object.keys(hashes)).toContain(stub);
		expect(Object.keys(hashes).length).toBeGreaterThan(1);

		// `build` fails on any warning, so every entry also has to match a fetched URL.
		const checked = await build({
			input: entry,
			plugins: [importCdn({ ...options, integrity: hashes })],
		});
		expect(checked.code).toBe(online.code);

		const tampered = { ...hashes, [stub]: `sha384-${"A".repeat(64)}` };
		await expect(
			build({ input: entry, plugins: [importCdn({ ...options, integrity: tampered })] }),
		).rejects.toThrow(`Integrity check failed for ${stub}`);
	});
});
