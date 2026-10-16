import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
// The minimal build keeps the v2 import record shape (`s`/`e` specifier offsets) that the
// rewrite below relies on. The default entry point in es-module-lexer 3 reports tagged
// records with renamed fields, so `s` and `e` read as undefined there and every import was
// replaced with the whole module source.
import { init, parse } from "es-module-lexer/minimal";
import { hasIntegrity, verifyIntegrity } from "./integrity";
import type { AvailableCDNs, Dependency, PluginOptions } from "./types";

// The plugin wires these to Rollup's `this.warn` and `this.debug`; omitted, messages are dropped.
export interface Logger {
	warn(message: string): void;
	debug(message: string): void;
}

const silent: Logger = { warn: () => {}, debug: () => {} };

const isUrl = (value: string) => /^(http(s){0,1}:){0,1}\/\//.test(value);

// `./x`, `../x`, `/x` or `//host/x`: anything that needs a base URL to fetch.
export const isRelativeReference = (value: string) => /^\.{0,2}\//.test(value);

// `name` is `pkg` or `@scope/pkg`; `subpath` is the rest, starting with `/` or, when the
// specifier carries its own version, with `@`.
function splitSpecifier(key: string): { name: string; subpath: string } {
	const [, name = key, subpath = ""] = /^(@[^/]+\/[^/@]+|[^/@]+)(.*)$/.exec(key) ?? [];
	return { name, subpath };
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

const isHttpUrl = (value: unknown): value is string =>
	typeof value === "string" && URL.canParse(value) && /^https?:$/.test(new URL(value).protocol);

const cacheFile = (dir: string, cdnUrl: string) =>
	path.join(dir, `${createHash("sha256").update(cdnUrl).digest("hex")}.json`);

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

function warnCache(logger: Logger, action: string, file: string, cdnUrl: string, reason: string) {
	logger.warn(`Could not ${action} cache entry ${file} for ${cdnUrl}: ${reason}`);
}

async function readCache(
	dir: string,
	cdnUrl: string,
	logger: Logger,
): Promise<Pick<Dependency, "url" | "main"> | null> {
	const file = cacheFile(dir, cdnUrl);
	let entry: unknown;
	try {
		entry = JSON.parse(await readFile(file, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			warnCache(logger, "read", file, cdnUrl, errorMessage(error));
		}
		return null;
	}
	const { url, main } = (entry ?? {}) as Record<string, unknown>;
	if (isHttpUrl(url) && typeof main === "string") return { url, main };
	warnCache(logger, "read", file, cdnUrl, "expected an http(s) `url` and a string `main`");
	return null;
}

async function writeCache(
	dir: string,
	cdnUrl: string,
	entry: Pick<Dependency, "url" | "main">,
	logger: Logger,
) {
	const file = cacheFile(dir, cdnUrl);
	const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await mkdir(dir, { recursive: true });
		await writeFile(temporary, JSON.stringify(entry));
		await rename(temporary, file);
	} catch (error) {
		await rm(temporary, { force: true }).catch(() => {});
		warnCache(logger, "write", file, cdnUrl, errorMessage(error));
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
	logger: Logger = silent,
): Promise<Dependency | null> {
	const urls = resolveDependencyUrls(name, options);
	if (urls.length === 0) return null;

	const { fetchImpl, cache, integrity } = options;
	const attempts: { url: string; reason: string }[] = [];
	let sawHttpError = false;
	let lastError: unknown;
	const fail = (url: string, reason: string) => {
		attempts.push({ url, reason });
		logger.debug(`Failed to fetch ${name} from ${url}: ${reason}`);
	};

	for (const cdnUrl of urls) {
		const cacheable = cache !== undefined && isPinnedUrl(cdnUrl);
		if (cacheable) {
			const cached = await readCache(cache, cdnUrl, logger);
			// The cached `url` is the base for relative imports and is not covered by the hash of
			// `main`, so a checked URL only trusts it when it is unchanged or has an entry of its own.
			if (
				cached &&
				(cached.url === cdnUrl ||
					!hasIntegrity(cdnUrl, integrity) ||
					hasIntegrity(cached.url, integrity))
			) {
				verifyIntegrity([cdnUrl, cached.url], cached.main, integrity);
				return { name, ...cached };
			}
		}

		let fetched: Pick<Dependency, "url" | "main">;
		try {
			const response = await fetchImpl(cdnUrl);
			if (!response.ok) {
				sawHttpError = true;
				fail(cdnUrl, `HTTP ${response.status ?? "error"}`);
				continue;
			}
			const main = await response.text();
			// Custom and mocked fetches can leave `url` empty; without a base the rewrite is a no-op.
			fetched = { url: response.url || cdnUrl, main };
		} catch (error) {
			lastError = error;
			fail(cdnUrl, describeError(error));
			continue;
		}

		// Outside the try: a mismatch means tampered content, so it fails rather than trying the next CDN.
		verifyIntegrity([cdnUrl, fetched.url], fetched.main, integrity);
		if (cacheable) await writeCache(cache, cdnUrl, fetched, logger);

		return { name, ...fetched };
	}

	const detail = formatAttempts(name, attempts);
	if (sawHttpError) {
		const error = new Error(detail);
		// tsconfig targets ES2020, which lacks the ErrorOptions constructor overload.
		if (lastError !== undefined) Object.assign(error, { cause: lastError });
		throw error;
	}

	logger.warn(`Could not resolve dependency ${name}\n${detail}`);

	return null;
}

export async function loadHook(key: string, options: PluginOptions, logger: Logger = silent) {
	const dependency = await resolveDependency(key, options, logger);
	if (!dependency) return;

	await init();

	const { main } = dependency;
	let imports: ReturnType<typeof parse>[0];
	try {
		[imports] = parse(main);
	} catch (cause) {
		const reason = cause instanceof Error ? cause.message : String(cause);
		const hint = main.trimStart().startsWith("<")
			? " (the CDN returned HTML rather than a JavaScript module)"
			: "";
		throw Object.assign(
			new Error(
				`[rollup-plugin-import-cdn] Could not parse ${dependency.name} from ${dependency.url}: ${reason}${hint}`,
			),
			{ cause },
		);
	}

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

		parts.push(main.slice(last, s), new URL(specifier, dependency.url).href);
		last = e;
	}

	parts.push(main.slice(last));

	return parts.join("");
}
