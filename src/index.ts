import { builtinModules } from "node:module";
import path from "node:path";
import type { Plugin as RollupPlugin } from "rollup";
import { loadHook, resolveDependency } from "./load";
import type { FetchImpl, PluginOptions } from "./types";
import type { PartialBy } from "./utils";

type FetchedResponse = Omit<Awaited<ReturnType<FetchImpl>>, "text"> & { body: string };

const builtins = new Set(builtinModules);

const isForeignId = (id: string) =>
	id.startsWith("\0") ||
	id.startsWith("node:") ||
	builtins.has(id) ||
	path.posix.isAbsolute(id) ||
	path.win32.isAbsolute(id);

export function importCdn(pluginOptions: PartialBy<PluginOptions, "fetchImpl"> = {}): RollupPlugin {
	const globalFetch = typeof fetch !== "undefined" ? fetch : undefined;
	const baseFetch = pluginOptions.fetchImpl ?? globalFetch;
	if (!baseFetch) {
		throw new Error("A fetch implementation is required for plugin-import-cdn to work.");
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

	const options = { ...pluginOptions, fetchImpl };

	return {
		name: "plugin-import-cdn",
		buildStart() {
			responses.clear();
		},
		async resolveId(key: string) {
			if (isForeignId(key)) return;
			const dependency = await resolveDependency(key, options);
			return dependency?.name;
		},
		async load(key: string) {
			if (isForeignId(key)) return;
			return loadHook(key, options);
		},
	};
}

export * from "./types";
