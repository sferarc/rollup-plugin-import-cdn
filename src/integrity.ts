import { createHash } from "node:crypto";

// Ordered weakest to strongest; the value is the digest length in bytes.
const algorithms = { sha256: 32, sha384: 48, sha512: 64 } as const;

type Algorithm = keyof typeof algorithms;

interface IntegrityHash {
	algorithm: Algorithm;
	digest: string;
}

const isAlgorithm = (value: string): value is Algorithm => Object.keys(algorithms).includes(value);

const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/;

export function parseIntegrity(value: string): IntegrityHash[] {
	const tokens = value.split(/\s+/).filter(Boolean);
	if (tokens.length === 0) throw new Error("expected at least one hash");
	return tokens.map((token) => {
		const separator = token.indexOf("-");
		const algorithm = token.slice(0, separator);
		const digest = token.slice(separator + 1);
		if (separator === -1 || !isAlgorithm(algorithm)) {
			throw new Error(`"${token}" does not start with sha256-, sha384- or sha512-`);
		}
		const bytes = base64Pattern.test(digest) ? Buffer.from(digest, "base64") : undefined;
		// Round-tripping rejects non-canonical padding that Buffer.from would silently accept.
		if (bytes?.length !== algorithms[algorithm] || bytes.toString("base64") !== digest) {
			throw new Error(`"${token}" is not a base64 ${algorithm} digest`);
		}
		return { algorithm, digest };
	});
}

const strength = (algorithm: Algorithm) => Object.keys(algorithms).indexOf(algorithm);

const digestOf = (algorithm: Algorithm, body: string) =>
	createHash(algorithm).update(body).digest("base64");

export const hasIntegrity = (url: string, integrity: Record<string, string> | undefined) =>
	integrity !== undefined && Object.keys(integrity).includes(url);

/**
 * Throws when `body` does not match the `integrity` entry for any of `urls`, and returns the
 * URLs that had one. As in SRI, only hashes using the strongest listed algorithm count, and any
 * one of them matching passes.
 */
export function verifyIntegrity(
	urls: string[],
	body: string,
	integrity: Record<string, string> | undefined,
): string[] {
	if (!integrity) return [];
	const checked: string[] = [];
	// A Map keeps inherited names such as `constructor` from reading as entries.
	const entries = new Map(Object.entries(integrity));
	for (const url of new Set(urls)) {
		const expected = entries.get(url);
		if (expected === undefined) continue;
		checked.push(url);
		const hashes = parseIntegrity(expected);
		const strongest = hashes.reduce(
			(best, { algorithm }) => (strength(algorithm) > strength(best) ? algorithm : best),
			hashes[0]!.algorithm,
		);
		const actual = digestOf(strongest, body);
		const matches = hashes.some(
			({ algorithm, digest }) => algorithm === strongest && digest === actual,
		);
		if (!matches) {
			throw new Error(
				`[rollup-plugin-import-cdn] Integrity check failed for ${url}: expected ${expected}, got ${strongest}-${actual}`,
			);
		}
	}
	return checked;
}
