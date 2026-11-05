import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface PackageJson {
	description: string;
	keywords: string[];
	peerDependencies: Record<string, string>;
	compatiblePackages: Record<string, unknown>;
}

const pkg: PackageJson = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
);

// The Vite plugin registry discovers plugins on npm by these keywords (registry.vite.dev/guide/discovery).
const registryTools = ["vite", "rollup", "rolldown"];
const declaredTools = [
	...Object.keys(pkg.peerDependencies),
	...Object.keys(pkg.compatiblePackages).filter((key) => key !== "schemaVersion"),
].filter((tool) => registryTools.includes(tool));

describe("package.json", () => {
	it("declares at least Rollup, Vite and Rolldown", () => {
		expect(declaredTools).toEqual(expect.arrayContaining(registryTools));
	});

	it.each(declaredTools)("lists %s in the keywords and the description", (tool) => {
		expect(pkg.keywords).toContain(tool);
		expect(pkg.keywords).toContain(`${tool}-plugin`);
		expect(pkg.description.toLowerCase()).toContain(tool);
	});
});
