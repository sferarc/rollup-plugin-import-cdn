import { fileURLToPath } from "node:url";
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
