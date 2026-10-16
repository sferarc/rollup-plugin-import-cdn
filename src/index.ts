import { builtinModules } from "node:module";
import path from "node:path";
import type { Plugin as RollupPlugin } from "rollup";
import { parseIntegrity } from "./integrity";
import { isRelativeReference, loadHook, resolveDependency } from "./load";
import { availableCDNs, type FetchImpl, type PluginOptions } from "./types";

type ImportCdnOptions = Omit<PluginOptions, "fetchImpl"> &
	Partial<Pick<PluginOptions, "fetchImpl">>;

type FetchedResponse = Omit<Awaited<ReturnType<FetchImpl>>, "text"> & { body: string };

const builtins = new Set(builtinModules);

const isForeignId = (id: string) =>
	id.startsWith("\0") ||
	id.startsWith("node:") ||
	builtins.has(id) ||
	path.posix.isAbsolute(id) ||
	path.win32.isAbsolute(id);

const isHttpUrl = (id: string) => /^https?:\/\//.test(id);

const isKnownCdn = (value: unknown) =>
	typeof value === "string" && (availableCDNs as readonly string[]).includes(value);

function validateOptions({ priority, cache, integrity }: ImportCdnOptions) {
	if (priority !== undefined) {
		const entries: unknown[] = Array.isArray(priority) ? priority : [priority];
		for (const entry of entries) {
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
}

export function importCdn(pluginOptions: ImportCdnOptions = {}): RollupPlugin {
	validateOptions(pluginOptions);

	const globalFetch = typeof fetch !== "undefined" ? fetch : undefined;
	const baseFetch = pluginOptions.fetchImpl ?? globalFetch;
	if (!baseFetch) {
		throw new Error(
			"[rollup-plugin-import-cdn] No fetch implementation found. Run Rollup on a Node version with a global fetch, or pass one as the fetchImpl option.",
		);
	}

	// resolveId and load both resolve the same id, so each URL is fetched once per build.
	const responses = new Map<string, Promise<FetchedResponse>>();

	const fetchImpl: FetchImpl = async (url) => {
		let pending = responses.get(url);
		if (!pending) {
			pending = baseFetch(url).then(async (response) => ({
				ok: response.ok,
				status: response.status,
				url: response.url,
				body: response.ok ? await response.text() : "",
			}));
			responses.set(url, pending);
		}
		const { body, ...response } = await pending;
		return { ...response, text: async () => body };
	};

	// Module id to the URL its source was served from, after redirects.
	const moduleUrls = new Map<string, string>();

	const options = { ...pluginOptions, fetchImpl };

	return {
		name: "plugin-import-cdn",
		buildStart() {
			responses.clear();
			moduleUrls.clear();
		},
		async resolveId(key: string, importer?: string) {
			const importerUrl =
				importer === undefined
					? undefined
					: (moduleUrls.get(importer) ?? (isHttpUrl(importer) ? importer : undefined));

			// loadHook leaves dynamic imports as written, so they arrive relative to a CDN module.
			if (importerUrl && isRelativeReference(key)) {
				key = new URL(key, importerUrl).href;
			} else if (isForeignId(key)) {
				return;
			}

			const dependency = await resolveDependency(key, options);
			if (!dependency) return;
			moduleUrls.set(dependency.name, dependency.url);
			return dependency.name;
		},
		async load(key: string) {
			if (isForeignId(key)) return;
			return loadHook(key, options);
		},
	};
}

export * from "./types";
