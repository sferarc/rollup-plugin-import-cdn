import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type RollupOptions, rollup, type SourceMap } from "rollup";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AvailableCDNs, type FetchImpl, importCdn } from "../src/index";

// Hits the real CDNs, so it runs only through `pnpm test:live` and the scheduled live workflow.
const PREACT = "10.19.3";
// Skypack answers 404 for many pinned scoped versions, so this has to be one it still serves.
const POPPER = "2.11.8";
const REACT_DOM = "18.2.0";
// Skypack served 17.0.1 for this pin on 2026-10-26 and 2026-10-28.
const REACT = "18.2.0";
// jsDelivr's react-dom@18.2.0 build imported this exact version on 2026-11-04.
const SCHEDULER = "0.23.2";
// Skypack redirected this pin to `/error/build:...` with HTTP 200 (brain/architecture/resolution.md).
const SKYPACK_UNBUILDABLE = "3.4.0";
// jsDelivr served this pin's `+esm` as `/** Failed to bundle ...` with HTTP 200 (same note).
const JSDELIVR_UNBUILDABLE = "2.3.3";
// esm.sh's build of this pin imports `/node/process.mjs`, an unpinned polyfill.
const FSEVENTS = "2.3.3";
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

// jsDelivr serves an unpinned package without redirecting, while its modules import dependencies at an exact version.
describe("live jsDelivr dependency versions", () => {
	let dir: string;
	let entry: string;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "import-cdn-live-"));
		entry = path.join(dir, "index.js");
		await writeFile(
			entry,
			'import React from "react";\nimport ReactDOM from "react-dom";\nconsole.log(React, ReactDOM);',
		);
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	// A bare import's id is its specifier, and a CDN import of the URL it resolved to dedupes onto it.
	const reactModules = (chunk: { modules: Record<string, unknown> }) =>
		Object.keys(chunk.modules).filter((id) => id === "react" || /\/npm\/react@/.test(id));

	it("bundles two copies of an unpinned package that a dependency imports", async () => {
		const chunk = await build({ input: entry, plugins: [importCdn({ priority: ["jsdelivr"] })] });

		expect(reactModules(chunk)).toEqual([
			"react",
			expect.stringMatching(/^https:\/\/cdn\.jsdelivr\.net\/npm\/react@\d+\.\d+\.\d+\/\+esm$/),
		]);
	});

	it("bundles one copy when both are pinned, then rebuilds from the cache offline", async () => {
		const options = {
			priority: ["jsdelivr" as const],
			versions: { react: REACT, "react-dom": REACT_DOM },
			cache: path.join(dir, "cache"),
		};

		const online = await build({ input: entry, plugins: [importCdn(options)] });
		expect(reactModules(online)).toEqual(["react"]);
		expect(Object.keys(online.modules)).toContain(
			`https://cdn.jsdelivr.net/npm/scheduler@${SCHEDULER}/+esm`,
		);

		const offline: FetchImpl = async (url) => {
			throw new Error(`Not cached: ${url}`);
		};
		const cached = await build({
			input: entry,
			plugins: [importCdn({ ...options, fetchImpl: offline })],
		});
		expect(cached.code).toBe(online.code);
	});
});

describe("live esm.sh /node/ polyfill", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "import-cdn-live-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("fetches the unpinned /node/ polyfill imports on every build", async () => {
		const entry = path.join(dir, "index.js");
		await writeFile(entry, 'import fsevents from "fsevents";\nconsole.log(fsevents);');
		const options = {
			priority: ["esm.sh" as const],
			versions: { fsevents: FSEVENTS },
			cache: path.join(dir, "cache"),
		};

		const online = await build({ input: entry, plugins: [importCdn(options)] });
		const cdnModules = Object.keys(online.modules).filter((id) => id !== entry);
		expect(cdnModules).toContain("https://esm.sh/node/process.mjs");

		const requested: string[] = [];
		const offline: FetchImpl = async (url) => {
			requested.push(url);
			throw new Error(`Not cached: ${url}`);
		};
		await expect(
			build({ input: entry, plugins: [importCdn({ ...options, fetchImpl: offline })] }),
		).rejects.toThrow(/Not cached: https:\/\/esm\.sh\/node\//);
		expect(requested.length).toBeGreaterThan(0);
		for (const url of requested) expect(url).toMatch(/^https:\/\/esm\.sh\/node\/[\w-]+\.mjs$/);
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

// The README's Fetch Cache section says the pinned URL in Skypack's banner is cached.
describe("live Skypack pinned URL", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "import-cdn-live-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("bundles the banner's /pin/ URL, then rebuilds from the cache offline", async () => {
		const banner = await (await fetch(`https://cdn.skypack.dev/lodash@${LODASH}`)).text();
		const pinned = /Normal: (https:\/\/cdn\.skypack\.dev\/pin\/lodash@v4\.17\.21-\S+)/.exec(
			banner,
		)?.[1];
		if (!pinned) throw new Error(`No pinned URL in Skypack's banner:\n${banner}`);
		const entry = path.join(dir, "index.js");
		await writeFile(entry, `import _ from "${pinned}";\nconsole.log(_.chunk);`);
		const options = { priority: ["skypack" as const], cache: path.join(dir, "cache") };

		const online = await build({ input: entry, plugins: [importCdn(options)] });
		// The /pin/ stub only re-exports, so the chunk lists just the /-/ module it points at.
		expect(Object.keys(online.modules)).toContainEqual(
			expect.stringMatching(/^https:\/\/cdn\.skypack\.dev\/-\/lodash@v4\.17\.21-/),
		);

		const requested: string[] = [];
		const offline: FetchImpl = async (url) => {
			requested.push(url);
			throw new Error(`Not cached: ${url}`);
		};
		const cached = await build({
			input: entry,
			plugins: [importCdn({ ...options, fetchImpl: offline })],
		});
		expect(requested).toEqual([]);
		expect(cached.code).toBe(online.code);
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

// The README's Sourcemaps paragraph names this exact URL as an example source.
describe("live esm.sh sourcemap", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "import-cdn-live-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("names the served module by its URL and puts it on the ignore list", async () => {
		const entry = path.join(dir, "index.js");
		await writeFile(entry, 'import { version } from "react";\nconsole.log(version);');
		const bundle = await rollup({
			input: entry,
			onwarn: (warning) => expect.fail(warning.message),
			plugins: [importCdn({ priority: ["esm.sh"], versions: { react: REACT } })],
		});
		const { output } = await bundle.generate({
			format: "es",
			sourcemap: true,
			file: path.join(dir, "dist", "bundle.js"),
		});
		await bundle.close();

		// Rollup writes `x_google_ignoreList` on output maps but leaves it out of the `SourceMap` type.
		const map = output[0].map as (SourceMap & { x_google_ignoreList?: number[] }) | null;
		const sources = map?.sources ?? [];
		const ignored = (map?.x_google_ignoreList ?? []).map((index) => sources[index]);
		expect(sources).toContain(`https://esm.sh/react@${REACT}/es2022/react.mjs`);
		expect(sources).toContain("../index.js");
		for (const source of sources) {
			if (source === "../index.js") expect(ignored).not.toContain(source);
			else {
				expect(source).toMatch(/^https:\/\/esm\.sh\//);
				expect(ignored).toContain(source);
			}
		}
	});
});

// The README's Version Pinning examples; Skypack served react-dom@17.0.1 and a 404 for them on 2026-11-04.
describe.each<[AvailableCDNs, string, string]>([
	["esm.sh", "https://esm.sh/react-dom@18.2.0/client", "https://esm.sh/preact@10.19.3?dev"],
	[
		"jsdelivr",
		"https://cdn.jsdelivr.net/npm/react-dom@18.2.0/client/+esm",
		"https://cdn.jsdelivr.net/npm/preact@10.19.3/+esm?dev",
	],
])("live %s version pinning", (cdn, subpathUrl, queryUrl) => {
	let dir: string;
	let entry: string;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "import-cdn-live-"));
		entry = path.join(dir, "index.js");
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	async function requestedUrls(source: string, versions: Record<string, string>) {
		await writeFile(entry, source);
		const requested: string[] = [];
		const recording: FetchImpl = async (url, init) => {
			requested.push(url);
			return fetch(url, init);
		};
		const chunk = await build({
			input: entry,
			plugins: [importCdn({ priority: [cdn], versions, fetchImpl: recording })],
		});
		expect(chunk.imports).toEqual([]);
		return requested;
	}

	it("puts the package pin before a subpath", async () => {
		const requested = await requestedUrls(
			'import { createRoot } from "react-dom/client";\nconsole.log(createRoot);',
			{ "react-dom": REACT_DOM },
		);
		expect(requested[0]).toBe(subpathUrl);
	});

	it("keeps a query after the pin", async () => {
		const requested = await requestedUrls('import { h } from "preact?dev";\nconsole.log(h);', {
			preact: PREACT,
		});
		expect(requested[0]).toBe(queryUrl);
	});
});
