import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import url from "node:url";
// The minimal build keeps the v2 import record shape (`s`/`e` specifier offsets) that the
// rewrite below relies on. The default entry point in es-module-lexer 3 reports tagged
// records with renamed fields, so `s` and `e` read as undefined there and every import was
// replaced with the whole module source.
import { init, parse } from "es-module-lexer/minimal";
import type { AvailableCDNs, Dependency, PluginOptions } from "./types";

const isUrl = (value: string) => /^(http(s){0,1}:){0,1}\/\//.test(value);

const isRelativeOrRootPath = (value: string) => /^\.{0,2}\//.test(value) && !isUrl(value);

const parseCDN: Record<AvailableCDNs, (key: string, version?: string) => string> = {
	skypack: (key, version) => {
		const versionTag = version ? `@${version}` : "";
		return `https://cdn.skypack.dev/${key}${versionTag}`;
	},
};

const isPinnedUrl = (value: string) => /@\d+\.\d+\.\d+(?:[-+][\w.-]+)?(?=[/?#]|$)/.test(value);

const cacheFile = (dir: string, cdnUrl: string) =>
	path.join(dir, `${createHash("sha256").update(cdnUrl).digest("hex")}.json`);

async function readCache(
	dir: string,
	cdnUrl: string,
): Promise<Pick<Dependency, "url" | "main"> | null> {
	try {
		const entry = JSON.parse(await readFile(cacheFile(dir, cdnUrl), "utf8"));
		return typeof entry.url === "string" && typeof entry.main === "string" ? entry : null;
	} catch {
		return null;
	}
}

async function writeCache(dir: string, cdnUrl: string, entry: Pick<Dependency, "url" | "main">) {
	try {
		const file = cacheFile(dir, cdnUrl);
		const temporary = `${file}.${process.pid}.tmp`;
		await mkdir(dir, { recursive: true });
		await writeFile(temporary, JSON.stringify(entry));
		await rename(temporary, file);
	} catch (error) {
		console.debug(`Error writing cache for ${cdnUrl}`, error);
	}
}

function resolveDependencyUrls(key: string, options: PluginOptions): string[] {
	if (key.startsWith("/") || key.startsWith("file://") || key.startsWith(".")) return [];

	if (isUrl(key)) return [key];

	const priorities = options.priority ?? ["skypack"];
	const version = options.versions?.[key];

	return priorities.map((cdn) => {
		if (typeof cdn === "string") return parseCDN[cdn](key, version);

		return cdn(key);
	});
}

export async function resolveDependency(
	name: string,
	options: PluginOptions,
): Promise<Dependency | null> {
	const urls = resolveDependencyUrls(name, options);
	if (urls.length === 0) return null;

	const { fetchImpl, cache } = options;
	let httpError: Error | undefined;

	for (const cdnUrl of urls) {
		const cacheable = cache !== undefined && isPinnedUrl(cdnUrl);
		if (cacheable) {
			const cached = await readCache(cache, cdnUrl);
			if (cached) return { name, ...cached };
		}

		try {
			const response = await fetchImpl(cdnUrl);
			if (!response.ok) {
				httpError = new Error(
					`[rollup-plugin-import-cdn] Failed to fetch ${name} from ${cdnUrl}: HTTP ${response.status ?? "error"}`,
				);
				continue;
			}
			const main = await response.text();

			if (cacheable) await writeCache(cache, cdnUrl, { url: response.url, main });

			return { name, url: response.url, main };
		} catch (error) {
			console.debug(`Error fetching ${name}`, error);
		}
	}

	if (httpError) throw httpError;

	console.warn(`[rollup-plugin-import-cdn] Could not resolve dependency ${name}`);

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
		if (!isRelativeOrRootPath(specifier)) continue;

		parts.push(main.slice(last, s), url.resolve(dependency.url, specifier));
		last = e;
	}

	parts.push(main.slice(last));

	return parts.join("");
}
