import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type Plugin, rolldown } from "rolldown";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FetchImpl, importCdn } from "../src/index";

// Hits the real esm.sh, so it runs only through `pnpm test:live` and the scheduled live workflow.
const PREACT = "10.19.3";

const MAIN = [
	'import { h, render } from "preact";',
	'import { useState } from "preact/hooks";',
	"console.log(h, render, useState);",
].join("\n");

describe("live Rolldown build", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(path.join(tmpdir(), "import-cdn-live-rolldown-"));
		await writeFile(path.join(root, "main.js"), MAIN);
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	async function rolldownBuild(plugin: Plugin) {
		const warnings: string[] = [];
		const bundle = await rolldown({
			input: path.join(root, "main.js"),
			cwd: root,
			plugins: [plugin],
			onwarn: (warning) => warnings.push(warning.message),
		});
		try {
			const { output } = await bundle.generate({ format: "es" });
			expect(warnings).toEqual([]);
			const chunks = output.filter((file) => file.type === "chunk");
			expect(chunks).toHaveLength(1);
			const [chunk] = chunks;
			if (!chunk) throw new Error("Expected one chunk");
			return chunk;
		} finally {
			await bundle.close();
		}
	}

	it("bundles a pinned package and its subpath from esm.sh, then rebuilds from the cache offline", async () => {
		const options = { versions: { preact: PREACT }, cache: path.join(root, "cache") };

		const online = await rolldownBuild(importCdn(options));
		expect(online.imports).toEqual([]);
		expect(online.dynamicImports).toEqual([]);
		expect(online.code).not.toMatch(/\b(?:from|import)\s*\(?\s*["']https?:/);
		const cdnModules = online.moduleIds.filter((id) => id.startsWith("https://esm.sh/"));
		expect(cdnModules).toContainEqual(expect.stringMatching(/\/preact@10\.19\.3\//));
		expect(cdnModules).toContainEqual(expect.stringMatching(/\/preact@10\.19\.3\/.*hooks/));
		for (const id of cdnModules) expect(id).not.toMatch(/preact@v?(?!10\.19\.3)\d/);

		const offline: FetchImpl = async (url) => {
			throw new Error(`Not cached: ${url}`);
		};
		const cached = await rolldownBuild(importCdn({ ...options, fetchImpl: offline }));
		expect(cached.code).toBe(online.code);
	});
});
