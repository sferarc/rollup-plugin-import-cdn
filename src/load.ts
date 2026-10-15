import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import url from "node:url";
// The minimal build keeps the v2 import record shape (`s`/`e` specifier offsets) that the
// rewrite below relies on. The default entry point in es-module-lexer 3 reports tagged
// records with renamed fields, so `s` and `e` read as undefined there and every import was
// replaced with the whole module source.
import { init, parse } from "es-module-lexer/minimal";
import type { AvailableCDNs, Dependency, PluginOptions } from "./types";

const isUrl = (value: string) => /^(http(s){0,1}:){0,1}\/\//.test(value);

// `./x`, `../x`, `/x` or `//host/x`: anything that needs a base URL to fetch.
export const isRelativeReference = (value: string) => /^\.{0,2}\//.test(value);

// `name` is `pkg` or `@scope/pkg`; `subpath` is the rest, starting with `/` or, when the
// specifier carries its own version, with `@`.
function splitSpecifier(key: string): { name: string; subpath: string } {
	const match = /^(@[^/]+\/[^/@]+|[^/@]+)(.*)$/.exec(key);
	return match ? { name: match[1], subpath: match[2] } : { name: key, subpath: "" };
}

const withVersion = (key: string, version?: string) => {
	const { name, subpath } = splitSpecifier(key);
	if (!version || subpath.startsWith("@")) return key;
	return `${name}@${version}${subpath}`;
};

const parseCDN: Record<AvailableCDNs, (key: string, version?: string) => string> = {
	skypack: (key, version) => `https://cdn.skypack.dev/${withVersion(key, version)}`,
};

function pinnedVersion(key: string, versions: PluginOptions["versions"]) {
	const exact = versions?.[key];
	if (exact) return exact;
	const { name, subpath } = splitSpecifier(key);
	return subpath.startsWith("@") ? undefined : versions?.[name];
}

// Only the path names the package version; a query or fragment can carry any text.
function isPinnedUrl(value: string) {
	if (!URL.canParse(value)) return false;
	return /@\d+\.\d+\.\d+(?:[-+][\w.-]+)?(?=\/|$)/.test(new URL(value).pathname);
}

const isHttpUrl = (value: unknown) =>
	typeof value === "string" && URL.canParse(value) && /^https?:$/.test(new URL(value).protocol);

const cacheFile = (dir: string, cdnUrl: string) =>
	path.join(dir, `${createHash("sha256").update(cdnUrl).digest("hex")}.json`);

async function readCache(
	dir: string,
	cdnUrl: string,
): Promise<Pick<Dependency, "url" | "main"> | null> {
	try {
		const entry = JSON.parse(await readFile(cacheFile(dir, cdnUrl), "utf8"));
		return isHttpUrl(entry?.url) && typeof entry.main === "string" ? entry : null;
	} catch {
		return null;
	}
}

async function writeCache(dir: string, cdnUrl: string, entry: Pick<Dependency, "url" | "main">) {
	const file = cacheFile(dir, cdnUrl);
	const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await mkdir(dir, { recursive: true });
		await writeFile(temporary, JSON.stringify(entry));
		await rename(temporary, file);
	} catch (error) {
		await rm(temporary, { force: true }).catch(() => {});
		console.debug(`Error writing cache for ${cdnUrl}`, error);
	}
}

function resolveDependencyUrls(key: string, options: PluginOptions): string[] {
	if (key.startsWith("/") || key.startsWith("file://") || key.startsWith(".")) return [];

	if (isUrl(key)) return [key];

	const priorities = options.priority ?? ["skypack"];
	const version = pinnedVersion(key, options.versions);

	return priorities.map((cdn) =>
		typeof cdn === "string" ? parseCDN[cdn](key, version) : cdn(key, version),
	);
}

function describeError(error: unknown): string {
	if (!(error instanceof Error)) return String(error);
	const { cause } = error as { cause?: unknown };
	if (cause instanceof Error && cause.message) return `${error.message} (${cause.message})`;
	return error.message;
}

function formatAttempts(name: string, attempts: { url: string; reason: string }[]): string {
	return attempts
		.map(
			({ url, reason }) =>
				`[rollup-plugin-import-cdn] Failed to fetch ${name} from ${url}: ${reason}`,
		)
		.join("\n");
}

export async function resolveDependency(
	name: string,
	options: PluginOptions,
): Promise<Dependency | null> {
	const urls = resolveDependencyUrls(name, options);
	if (urls.length === 0) return null;

	const { fetchImpl, cache } = options;
	const attempts: { url: string; reason: string }[] = [];
	let sawHttpError = false;
	let lastError: unknown;

	for (const cdnUrl of urls) {
		const cacheable = cache !== undefined && isPinnedUrl(cdnUrl);
		if (cacheable) {
			const cached = await readCache(cache, cdnUrl);
			if (cached) return { name, ...cached };
		}

		try {
			const response = await fetchImpl(cdnUrl);
			if (!response.ok) {
				sawHttpError = true;
				attempts.push({ url: cdnUrl, reason: `HTTP ${response.status ?? "error"}` });
				continue;
			}
			const main = await response.text();

			if (cacheable) await writeCache(cache, cdnUrl, { url: response.url, main });

			return { name, url: response.url, main };
		} catch (error) {
			lastError = error;
			attempts.push({ url: cdnUrl, reason: describeError(error) });
		}
	}

	const detail = formatAttempts(name, attempts);
	if (sawHttpError) {
		const error = new Error(detail);
		// tsconfig targets ES2020, which lacks the ErrorOptions constructor overload.
		if (lastError !== undefined) Object.assign(error, { cause: lastError });
		throw error;
	}

	console.warn(`[rollup-plugin-import-cdn] Could not resolve dependency ${name}\n${detail}`);

	return null;
}

export async function loadHook(key: string, options: PluginOptions) {
	const dependency = await resolveDependency(key, options);
	if (!dependency) return;

	await init();

	const { main } = dependency;
	const [imports] = parse(main);

	const parts: string[] = [];
	let last = 0;

	for (const { s, e, d } of imports) {
		// The lexer reports `import.meta` as a record with d === -2 whose span is the
		// `import.meta` expression itself, not a specifier.
		if (d === -2) continue;

		// Dynamic imports (d > -1) are left alone. Their span is the whole argument,
		// quotes included, so rewriting it would put the quotes inside the URL.
		if (d > -1) continue;

		const specifier = main.slice(s, e);
		if (!isRelativeReference(specifier)) continue;

		parts.push(main.slice(last, s), url.resolve(dependency.url, specifier));
		last = e;
	}

	parts.push(main.slice(last));

	return parts.join("");
}
