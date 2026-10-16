import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hasIntegrity, parseIntegrity, verifyIntegrity } from "./integrity";

const sri = (algorithm: "sha256" | "sha384" | "sha512", body: string) =>
	`${algorithm}-${createHash(algorithm).update(body).digest("base64")}`;

const url = "https://esm.sh/react@18.2.0";
const body = "export default 1;";

describe("parseIntegrity", () => {
	it.each(["sha256", "sha384", "sha512"] as const)("accepts a %s hash", (algorithm) => {
		const value = sri(algorithm, body);
		expect(parseIntegrity(value)).toEqual([{ algorithm, digest: value.slice(7) }]);
	});

	it("accepts several whitespace-separated hashes", () => {
		expect(parseIntegrity(` ${sri("sha256", "a")}\n${sri("sha512", "b")} `)).toHaveLength(2);
	});

	it.each([
		["an empty value", "", "expected at least one hash"],
		["an unknown algorithm", "md5-1B2M2Y8AsgTpgAmY7PhCfg==", "does not start with"],
		["a missing prefix", createHash("sha256").update(body).digest("base64"), "does not start with"],
		["a hex digest", `sha256-${createHash("sha256").update(body).digest("hex")}`, "not a base64"],
		[
			"a digest of the wrong length",
			`sha384-${createHash("sha256").update(body).digest("base64")}`,
			"not a base64",
		],
		["a digest with an option suffix", `${sri("sha256", body)}?ct=text/javascript`, "not a base64"],
	])("rejects %s", (_, value, message) => {
		expect(() => parseIntegrity(value)).toThrow(message);
	});
});

describe("verifyIntegrity", () => {
	it("passes a matching hash", () => {
		expect(() => verifyIntegrity([url], body, { [url]: sri("sha384", body) })).not.toThrow();
	});

	it("throws naming the URL, the expected and the actual digest", () => {
		const expected = sri("sha384", "export default 2;");
		expect(() => verifyIntegrity([url], body, { [url]: expected })).toThrow(
			`[rollup-plugin-import-cdn] Integrity check failed for ${url}: expected ${expected}, got ${sri("sha384", body)}`,
		);
	});

	it("passes when any of several hashes matches", () => {
		const value = `${sri("sha384", "other")} ${sri("sha384", body)}`;
		expect(() => verifyIntegrity([url], body, { [url]: value })).not.toThrow();
	});

	it("only counts the strongest algorithm, as in SRI", () => {
		const value = `${sri("sha256", body)} ${sri("sha512", "other")}`;
		expect(() => verifyIntegrity([url], body, { [url]: value })).toThrow(
			`got ${sri("sha512", body)}`,
		);
	});

	it("checks every listed URL that has an entry", () => {
		const final = `${url}/es2022/react.mjs`;
		const integrity = { [url]: sri("sha256", body), [final]: sri("sha256", "other") };
		expect(() => verifyIntegrity([url, final], body, integrity)).toThrow(final);
	});

	it("ignores URLs without an entry", () => {
		expect(() =>
			verifyIntegrity([url], body, { "https://other.test/x": sri("sha256", "x") }),
		).not.toThrow();
		expect(() => verifyIntegrity([url], body, undefined)).not.toThrow();
	});

	it("does not treat inherited properties as entries", () => {
		expect(() => verifyIntegrity(["constructor"], body, {})).not.toThrow();
	});
});

describe("hasIntegrity", () => {
	it("reports own entries only", () => {
		expect(hasIntegrity(url, { [url]: sri("sha256", body) })).toBe(true);
		expect(hasIntegrity("constructor", {})).toBe(false);
		expect(hasIntegrity(url, undefined)).toBe(false);
	});
});
