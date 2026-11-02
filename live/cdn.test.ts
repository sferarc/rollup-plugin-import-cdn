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
