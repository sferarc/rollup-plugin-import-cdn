import type { Plugin as RollupPlugin } from "rollup";
import { loadHook, resolveDependency } from "./load";
import type { PluginOptions } from "./types";
import type { PartialBy } from "./utils";

export function importCdn(pluginOptions: PartialBy<PluginOptions, "fetchImpl"> = {}): RollupPlugin {
	const globalFetch = typeof fetch !== "undefined" ? fetch : undefined;
	const fetchImpl = pluginOptions.fetchImpl ?? globalFetch;
	if (!fetchImpl) {
		throw new Error("A fetch implementation is required for plugin-import-cdn to work.");
	}

	const options = { ...pluginOptions, fetchImpl };

	return {
		name: "plugin-import-cdn",
		async resolveId(key: string) {
			const dependency = await resolveDependency(key, options);
			return dependency?.name;
		},
		async load(key: string) {
			return loadHook(key, options);
		},
	};
}

export * from "./types";
