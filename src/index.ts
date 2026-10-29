import { statSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { parseIntegrity } from "./integrity";
import {
	isHtmlPage,
	isRelativeReference,
	type Logger,
	resolveDependency,
	rewriteImports,
} from "./load";
import { availableCDNs, type FetchImpl, type PluginOptions } from "./types";

type ImportCdnOptions = Omit<PluginOptions, "fetchImpl"> &
	Partial<Pick<PluginOptions, "fetchImpl">>;

type FetchedResponse = Omit<Awaited<ReturnType<FetchImpl>>, "text"> & { body: string };

const builtins = new Set(builtinModules);

const isHttpUrl = (id: string) => /^https?:\/\//.test(id);

// The Vite dev server resolves `index.html` as an entry even when the root has none.
const isForeignId = (id: string) =>
	id.startsWith("\0") ||
	id.startsWith("node:") ||
	builtins.has(id) ||
	path.posix.isAbsolute(id) ||
	path.win32.isAbsolute(id) ||
	(!isHttpUrl(id) && id.endsWith(".html"));

// Rollup's default resolver accepts an entry with or without these extensions.
// `throwIfNoEntry` only covers ENOENT, so an id that cannot be a path (ENAMETOOLONG, EACCES)
// would otherwise throw and fail the build instead of reaching the next plugin.
const isFile = (candidate: string) => {
	try {
		return statSync(path.resolve(candidate), { throwIfNoEntry: false })?.isFile() ?? false;
	} catch {
		return false;
	}
};

const isLocalEntry = (id: string) => [id, `${id}.mjs`, `${id}.js`].some(isFile);

const isKnownCdn = (value: unknown) =>
	typeof value === "string" && (availableCDNs as readonly string[]).includes(value);

const DEFAULT_TIMEOUT_MS = 30_000;
// Node runs a setTimeout longer than this after 1ms, which would time out every request.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

const describeValue = (value: unknown) => {
	if (typeof value === "string") return JSON.stringify(value);
	if (Array.isArray(value)) return "an array";
	if (typeof value === "object" && value !== null) return "an object";
	return typeof value === "function" ? "a function" : String(value);
};

function validateOptions({
	fetchImpl,
	priority,
	cache,
	integrity,
	timeout,
	versions,
}: ImportCdnOptions) {
	// Called on every request, so anything else would fail each one as a network error.
	if (fetchImpl != null && typeof fetchImpl !== "function") {
		throw new Error(
			"[rollup-plugin-import-cdn] The fetchImpl option must be a function (url, init) => Promise<Response>.",
		);
	}
	if (priority !== undefined) {
		// resolveDependencyUrls maps over it, so a lone name or function would fail at the first import.
		if (!Array.isArray(priority)) {
			throw new Error(
				"[rollup-plugin-import-cdn] The priority option must be an array of CDN names or functions (key) => url.",
			);
		}
		for (const entry of priority as unknown[]) {
			if (typeof entry === "function" || isKnownCdn(entry)) continue;
			throw new Error(
				`[rollup-plugin-import-cdn] Unknown CDN "${String(entry)}" in priority; expected one of: ${availableCDNs.join(", ")}, or a function (key) => url`,
			);
		}
	}
	if (cache !== undefined && (typeof cache !== "string" || cache === "")) {
		throw new Error(
			"[rollup-plugin-import-cdn] The cache option must be a non-empty directory path when set.",
		);
	}
	if (integrity !== undefined) {
		if (typeof integrity !== "object" || integrity === null || Array.isArray(integrity)) {
			throw new Error(
				"[rollup-plugin-import-cdn] The integrity option must be an object mapping URLs to SRI hashes.",
			);
		}
		for (const [url, value] of Object.entries(integrity)) {
			// Entries are looked up by the fetched URL, so a key such as `lodash` would check nothing.
			if (!URL.canParse(url)) {
				throw new Error(
					`[rollup-plugin-import-cdn] Invalid integrity key ${JSON.stringify(url)}: expected the absolute URL the plugin fetches, such as https://cdn.skypack.dev/lodash@4.17.21.`,
				);
			}
			try {
				if (typeof value !== "string") throw new Error("expected a string");
				parseIntegrity(value);
			} catch (error) {
				throw new Error(
					`[rollup-plugin-import-cdn] Invalid integrity for ${url}: ${(error as Error).message}`,
				);
			}
		}
	}
	if (versions !== undefined) {
		// A string or array was read entry by entry and matched nothing, so no package was pinned.
		if (typeof versions !== "object" || versions === null || Array.isArray(versions)) {
			throw new Error(
				"[rollup-plugin-import-cdn] The versions option must be an object mapping package names or specifiers to versions.",
			);
		}
		for (const [key, version] of Object.entries(versions)) {
			// A number such as 18.10 reaches the URL as 18.1, and "" never pins anything.
			if (typeof version !== "string" || version === "") {
				throw new Error(
					`[rollup-plugin-import-cdn] Invalid version for ${key}: expected a non-empty string, got ${describeValue(version)}.`,
				);
			}
		}
	}
	if (
		timeout !== undefined &&
		(typeof timeout !== "number" ||
			!Number.isFinite(timeout) ||
			timeout < 0 ||
			timeout > MAX_TIMEOUT_MS)
	) {
		throw new Error(
			`[rollup-plugin-import-cdn] The timeout option must be a non-negative number of milliseconds no greater than ${MAX_TIMEOUT_MS} (0 disables it).`,
		);
	}
}

// Races the request so a fetchImpl that ignores `signal` still fails over to the next CDN.
function withTimeout<T>(
	url: string,
	timeout: number,
	request: (signal?: AbortSignal) => Promise<T>,
): Promise<T> {
	if (timeout === 0) return request();

	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			const error = new Error(
				`[rollup-plugin-import-cdn] Request to ${url} timed out after ${timeout}ms`,
			);
			controller.abort(error);
			reject(error);
		}, timeout);
		timer.unref?.();
	});

	return Promise.race([request(controller.signal), deadline]).finally(() => clearTimeout(timer));
}

function contextLogger(context: HookContext): Logger {
	return {
		warn: (message) => context.warn(message),
		// Rollup added `this.debug` in 3.25; earlier 3.x peers drop debug messages.
		debug: (message) => {
			if (typeof context.debug === "function") context.debug(message);
		},
	};
}

// Statuses a CDN may answer differently on the next request; a 404 stays kept.
const isTransientStatus = (status: number) => status === 408 || status === 429 || status >= 500;

// Only members Rollup's and Vite 8's (Rolldown) contexts share, so both Plugin types accept the plugin.
interface HookContext {
	warn(message: string): void;
	debug?(message: string): void;
	resolve(
		source: string,
		importer: string | undefined,
		options: { custom?: Record<string, unknown>; isEntry?: boolean; skipSelf?: boolean },
	): Promise<{ id: string } | null>;
}

type SourcemapPathTransform = (relativeSourcePath: string, sourcemapPath: string) => string;

interface ImportCdnPlugin {
	name: string;
	// Vite runs its own resolver before unordered plugins, and it marks every URL import external.
	enforce: "pre";
	configResolved: (config: { command: string }) => void;
	buildStart: () => void;
	buildEnd: (this: HookContext, error?: Error) => void;
	resolveId: (
		this: HookContext,
		source: string,
		importer: string | undefined,
		options: { custom?: Record<string, unknown>; isEntry: boolean },
	) => Promise<string | { id: string } | undefined>;
	load: (this: HookContext, id: string) => Promise<string | undefined>;
	resolveImportMeta: (property: string | null, options: { moduleId: string }) => string | undefined;
	outputOptions: <T extends { sourcemapPathTransform?: SourcemapPathTransform }>(options: T) => T;
}

export function importCdn(pluginOptions: ImportCdnOptions = {}): ImportCdnPlugin {
	validateOptions(pluginOptions);

	const globalFetch = typeof fetch !== "undefined" ? fetch : undefined;
	const baseFetch = pluginOptions.fetchImpl ?? globalFetch;
	if (!baseFetch) {
		throw new Error(
			"[rollup-plugin-import-cdn] No fetch implementation found. Run Rollup on a Node version with a global fetch, or pass one as the fetchImpl option.",
		);
	}

	const timeout = pluginOptions.timeout ?? DEFAULT_TIMEOUT_MS;

	// Set by the Vite-only `configResolved` hook; Rollup never calls it.
	let isVite = false;
	let isViteServe = false;

	// resolveId and load both resolve the same id, so each URL is fetched once per build.
	// A failure, timeouts included, is kept too, so a hanging CDN costs one timeout per URL.
	const responses = new Map<string, Promise<FetchedResponse>>();

	const fetchImpl: FetchImpl = async (url) => {
		let pending = responses.get(url);
		if (!pending) {
			pending = withTimeout(url, timeout, async (signal) => {
				const response = await (signal ? baseFetch(url, { signal }) : baseFetch(url));
				return {
					ok: response.ok,
					status: response.status,
					url: response.url,
					body: response.ok ? await response.text() : "",
				};
			});
			const request = pending;
			responses.set(url, request);
			// The dev server runs buildStart once, so a kept failure would last until it restarts.
			const forget = () => {
				if (isViteServe && responses.get(url) === request) responses.delete(url);
			};
			// An HTML page is usually a captive portal, which answers differently once signed in.
			request.then((response) => {
				if (isTransientStatus(response.status ?? 0) || isHtmlPage(response.body)) forget();
			}, forget);
		}
		const { body, ...response } = await pending;
		return { ...response, text: async () => body };
	};

	// Module id to the URL its source was served from, after redirects.
	const moduleUrls = new Map<string, string>();
	// Served URL to the first module id resolved to it, so a bare name that redirects to a URL
	// another module imports directly is bundled once rather than as two copies.
	const modulesByUrl = new Map<string, { id: string; main: string }>();
	// A version bump leaves an `integrity` key naming the old URL, which then checks nothing.
	const checkedIntegrity = new Set<string>();

	const options = { ...pluginOptions, fetchImpl };

	return {
		name: "plugin-import-cdn",
		enforce: "pre",
		configResolved(config) {
			isVite = true;
			isViteServe = config.command === "serve";
		},
		buildStart() {
			responses.clear();
			moduleUrls.clear();
			modulesByUrl.clear();
			checkedIntegrity.clear();
		},
		buildEnd(error) {
			// The dev server runs one build for its lifetime and loads modules on demand.
			if (error || isViteServe) return;
			for (const url of Object.keys(pluginOptions.integrity ?? {})) {
				if (checkedIntegrity.has(url)) continue;
				this.warn(
					`The integrity entry for ${url} matched no URL fetched in this build, so nothing was checked against it. Update the key if the URL changed, for example after a version bump.`,
				);
			}
		},
		async resolveId(key, importer, resolveOptions) {
			const importerUrl =
				importer === undefined
					? undefined
					: (moduleUrls.get(importer) ?? (isHttpUrl(importer) ? importer : undefined));

			// loadHook leaves dynamic imports as written, so they arrive relative to a CDN module.
			if (importerUrl && isRelativeReference(key)) {
				key = new URL(key, importerUrl).href;
			} else if (isForeignId(key)) {
				return;
			} else if (importer === undefined && !isHttpUrl(key) && isLocalEntry(key)) {
				// An entry such as `input: "src/index.js"` is a path relative to cwd, not a package.
				return;
			} else if (isVite && !isHttpUrl(key)) {
				// Running before Vite's resolver, so installed packages and Vite's own ids still win.
				const resolved = await this.resolve(key, importer, { ...resolveOptions, skipSelf: true });
				if (resolved) return resolved;
			}

			const dependency = await resolveDependency(
				key,
				options,
				contextLogger(this),
				checkedIntegrity,
			);
			if (!dependency) return;
			// Only an identical body is shared, so an integrity entry on either URL still covers it.
			const seen = modulesByUrl.get(dependency.url);
			if (seen?.main === dependency.main) return seen.id;
			if (!seen) modulesByUrl.set(dependency.url, { id: dependency.name, main: dependency.main });
			moduleUrls.set(dependency.name, dependency.url);
			return dependency.name;
		},
		async load(key) {
			// Under Vite this load runs first for every id, including other plugins' unprefixed virtual ids.
			if (isForeignId(key) || (isVite && !moduleUrls.has(key))) return;
			const dependency = await resolveDependency(
				key,
				options,
				contextLogger(this),
				checkedIntegrity,
			);
			if (!dependency) return;
			// A rebuild from Rollup's cache reuses resolved ids and skips resolveId, but not load.
			moduleUrls.set(key, dependency.url);
			// Vite does not apply resolveImportMeta, so the URL is inlined here instead.
			return rewriteImports(dependency, { inlineImportMetaUrl: isVite });
		},
		// Bundled, `import.meta.url` would name the output chunk, so `new URL("./x.wasm",
		// import.meta.url)` inside a CDN module would point at a local file instead of the CDN.
		resolveImportMeta(property, { moduleId }) {
			const url = moduleUrls.get(moduleId);
			if (property !== "url" || url === undefined) return;
			return JSON.stringify(url);
		},
		// Rollup resolves a module id against cwd for the map, so a CDN source read `../https:/host/x`.
		outputOptions(outputOptions) {
			const { sourcemapPathTransform: transform } = outputOptions;
			let urlsByPath: Map<string, string> | undefined;
			return {
				...outputOptions,
				sourcemapPathTransform(relativeSourcePath, sourcemapPath) {
					urlsByPath ??= new Map([...moduleUrls].map(([id, url]) => [path.resolve(id), url]));
					const url = urlsByPath.get(path.resolve(path.dirname(sourcemapPath), relativeSourcePath));
					if (url !== undefined) return url;
					return transform ? transform(relativeSourcePath, sourcemapPath) : relativeSourcePath;
				},
			};
		},
	};
}

export * from "./types";
