import { fileURLToPath } from "node:url";
import { type RolldownOptions, rolldown } from "rolldown";
import { type RollupOptions, rollup } from "rollup";
import { build } from "vite";
import { describe, expect, it, vi } from "vitest";

const root = fileURLToPath(new URL("../examples/vite", import.meta.url));

describe("examples/vite", () => {
	it("builds from its committed cache with no request", async () => {
		const globalFetch = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValue(new Error("examples/vite must build from its committed .cdn-cache"));
		// Imported after the spy: importCdn takes the global fetch when it is created.
		const { default: config } = await import("../examples/vite/vite.config");

		const warnings: string[] = [];
		const result = await build({
			...config,
			root,
			configFile: false,
			logLevel: "silent",
			build: {
				write: false,
				minify: false,
				rolldownOptions: { onwarn: (warning) => warnings.push(warning.message) },
			},
		});

		expect(warnings).toEqual([]);
		const outputs = Array.isArray(result) ? result : [result];
		const chunks = outputs
			.flatMap((output) => ("output" in output ? output.output : []))
			.filter((file) => file.type === "chunk");
		expect(chunks).toHaveLength(1);
		const [chunk] = chunks;
		if (!chunk) throw new Error("Expected one chunk");
		expect(chunk.imports).toEqual([]);
		expect(chunk.code).not.toMatch(/\b(?:from|import)\s*\(?\s*["']https?:/);
		expect(chunk.code).toContain("Clicked ");
		expect(chunk.moduleIds).toEqual(
			expect.arrayContaining([
				"https://esm.sh/preact@10.19.3/es2022/preact.mjs",
				"https://esm.sh/preact@10.19.3/es2022/hooks.mjs",
			]),
		);
		expect(globalFetch).not.toHaveBeenCalled();
	});
});

describe("examples/rollup", () => {
	it("builds from its committed cache with no request", async () => {
		const globalFetch = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValue(new Error("examples/rollup must build from its committed .cdn-cache"));
		// A variable specifier keeps tsc from asking for types of the untyped .mjs config.
		const configUrl = new URL("../examples/rollup/rollup.config.mjs", import.meta.url).href;
		const { default: config }: { default: RollupOptions } = await import(configUrl);

		const warnings: string[] = [];
		const bundle = await rollup({ ...config, onwarn: (warning) => warnings.push(warning.message) });
		const { output } = await bundle.generate({ format: "esm" });
		await bundle.close();

		expect(warnings).toEqual([]);
		const chunks = output.filter((file) => file.type === "chunk");
		expect(chunks).toHaveLength(1);
		const [chunk] = chunks;
		if (!chunk) throw new Error("Expected one chunk");
		expect(chunk.imports).toEqual([]);
		expect(chunk.dynamicImports).toEqual([]);
		expect(chunk.code).not.toMatch(/\b(?:from|import)\s*\(?\s*["']https?:/);
		expect(chunk.code).toContain("Rollup Import CDN");
		expect(Object.keys(chunk.modules)).toEqual(
			expect.arrayContaining([
				"https://esm.sh/lodash-es@4.17.21/es2022/chunk.mjs",
				"https://esm.sh/lodash-es@4.17.21/es2022/kebabCase.mjs",
			]),
		);
		expect(globalFetch).not.toHaveBeenCalled();
	});
});

describe("examples/rolldown", () => {
	it("builds from its committed cache with no request", async () => {
		const globalFetch = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValue(new Error("examples/rolldown must build from its committed .cdn-cache"));
		const configUrl = new URL("../examples/rolldown/rolldown.config.mjs", import.meta.url).href;
		const { default: config }: { default: RolldownOptions } = await import(configUrl);
		const { output: _, ...input } = config;

		const warnings: string[] = [];
		const bundle = await rolldown({
			...input,
			onwarn: (warning) => warnings.push(warning.message),
		});
		const { output } = await bundle.generate({ format: "es" });
		await bundle.close();

		expect(warnings).toEqual([]);
		const chunks = output.filter((file) => file.type === "chunk");
		expect(chunks).toHaveLength(1);
		const [chunk] = chunks;
		if (!chunk) throw new Error("Expected one chunk");
		expect(chunk.imports).toEqual([]);
		expect(chunk.dynamicImports).toEqual([]);
		expect(chunk.code).not.toMatch(/\b(?:from|import)\s*\(?\s*["']https?:/);
		expect(chunk.code).toContain("rolldown import CDN");
		expect(chunk.moduleIds).toEqual(
			expect.arrayContaining([
				"https://esm.sh/lodash-es@4.17.21/es2022/capitalize.mjs",
				"https://esm.sh/lodash-es@4.17.21/es2022/uniq.mjs",
			]),
		);
		expect(globalFetch).not.toHaveBeenCalled();
	});
});
