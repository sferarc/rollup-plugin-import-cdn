import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build, type Plugin } from "vite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FetchImpl, importCdn } from "../src/index";

// Hits the real esm.sh, so it runs only through `pnpm test:live` and the scheduled live workflow.
const PREACT = "10.19.3";
// dist/katex.min.css names its fonts by relative url(), the case #219 rewrites.
const KATEX = "0.16.11";

const MAIN = [
	'import { h, render } from "preact";',
	'import { useState } from "preact/hooks";',
	"console.log(h, render, useState);",
].join("\n");

describe("live vite build", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(path.join(tmpdir(), "import-cdn-live-vite-"));
		await writeFile(
			path.join(root, "index.html"),
			'<script type="module" src="./main.js"></script>',
		);
		await writeFile(path.join(root, "main.js"), MAIN);
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	async function viteBuild(plugin: Plugin) {
		const warnings: string[] = [];
		const result = await build({
			root,
			configFile: false,
			logLevel: "silent",
			build: {
				write: false,
				minify: false,
				rolldownOptions: { onwarn: (warning) => warnings.push(warning.message) },
			},
			plugins: [plugin],
		});
		expect(warnings).toEqual([]);
		const outputs = Array.isArray(result) ? result : [result];
		return outputs.flatMap((output) => ("output" in output ? output.output : []));
	}

	async function viteChunk(plugin: Plugin) {
		const chunks = (await viteBuild(plugin)).filter((file) => file.type === "chunk");
		expect(chunks).toHaveLength(1);
		const [chunk] = chunks;
		if (!chunk) throw new Error("Expected one chunk");
		return chunk;
	}

	async function viteCss(plugin: Plugin) {
		const sheets = (await viteBuild(plugin)).flatMap((file) =>
			file.type === "asset" && file.fileName.endsWith(".css") ? [String(file.source)] : [],
		);
		expect(sheets).toHaveLength(1);
		return sheets.join("");
	}

	it("bundles a pinned package and its subpath from esm.sh, then rebuilds from the cache offline", async () => {
		const options = { versions: { preact: PREACT }, cache: path.join(root, "cache") };

		const online = await viteChunk(importCdn(options));
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
		const cached = await viteChunk(importCdn({ ...options, fetchImpl: offline }));
		expect(cached.code).toBe(online.code);
	});

	it("points the relative url() fonts of a pinned esm.sh stylesheet at esm.sh, then rebuilds from the cache offline", async () => {
		await writeFile(path.join(root, "main.js"), 'import "katex/dist/katex.min.css";');
		const options = { versions: { katex: KATEX }, cache: path.join(root, "cache") };

		const online = await viteCss(importCdn(options));
		const urls = [...online.matchAll(/url\(\s*["']?([^"')\s]+)/g)].map(([, url]) => url);
		expect(urls.length).toBeGreaterThan(0);
		for (const url of urls) {
			expect(url).toMatch(/^https:\/\/esm\.sh\/katex@0\.16\.11\/dist\/fonts\/KaTeX_/);
		}
		const font = urls.find((url) => url?.endsWith(".woff2"));
		if (!font) throw new Error("Expected a woff2 font");
		const response = await fetch(font, { method: "HEAD" });
		expect(response.status).toBe(200);

		const offline: FetchImpl = async (url) => {
			throw new Error(`Not cached: ${url}`);
		};
		const cached = await viteCss(importCdn({ ...options, fetchImpl: offline }));
		expect(cached).toBe(online);
	});
});
