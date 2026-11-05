import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Context7Config {
	$schema: string;
	projectTitle: string;
	description: string;
	excludeFolders: string[];
	excludeFiles: string[];
	rules: string[];
}

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf-8");
const config: Context7Config = JSON.parse(read("context7.json"));

describe("context7.json", () => {
	it("stays inside the limits Context7 enforces", () => {
		expect(config.$schema).toBe("https://context7.com/schema/context7.json");
		expect(config.projectTitle).toBe(JSON.parse(read("package.json")).name);
		expect(config.description.length).toBeLessThanOrEqual(500);
		expect(config.rules.length).toBeGreaterThan(0);
		// Context7 drops every rule when it rejects one, so an overlong rule costs all of them.
		for (const rule of config.rules) {
			expect(rule.length, rule).toBeGreaterThan(0);
			expect(rule.length, rule).toBeLessThanOrEqual(255);
		}
	});

	it("indexes the CHANGELOG but not the contributor instructions", () => {
		// Context7 skips CHANGELOG.md by default only while excludeFiles is unset.
		expect(config.excludeFiles).not.toContain("CHANGELOG.md");
		expect(config.excludeFiles).toEqual(expect.arrayContaining(["AGENTS.md", "CLAUDE.md"]));
		for (const file of config.excludeFiles) expect(file, "file names only").not.toContain("/");
		expect(config.excludeFolders).toEqual(
			expect.arrayContaining(["brain", "live", "src/**/*.test.ts"]),
		);
	});

	it("states only facts the README still carries", () => {
		const rules = config.rules.join("\n");
		const readme = read("README.md");
		const facts = [
			'["esm.sh"]',
			'priority: ["skypack"]',
			"Rollup 3 and 4",
			"vite build",
			"vite dev",
			"node_modules",
			'react: "18.2.0"',
			"major.minor.patch",
			"sha384-<base64 digest>",
			"two copies",
			"undefined",
		];
		for (const fact of facts) {
			expect(rules, fact).toContain(fact);
			expect(readme, `README.md no longer says ${fact}`).toContain(fact);
		}
	});
});
