import type { NormalizedInputOptions, Plugin, PluginContext } from "rollup";

// The plugin never touches its hook context, so tests call hooks with an empty one.
const context = {} as PluginContext;

function handlerOf<F>(name: string, hook: F | { handler: F } | undefined): F {
	if (hook === undefined) throw new Error(`Plugin has no ${name} hook`);
	return typeof hook === "object" && hook !== null && "handler" in hook ? hook.handler : hook;
}

export function hooks(plugin: Plugin) {
	return {
		buildStart: () =>
			handlerOf("buildStart", plugin.buildStart).call(context, {} as NormalizedInputOptions),
		resolveId: async (id: string, importer?: string) =>
			handlerOf("resolveId", plugin.resolveId).call(context, id, importer, {
				attributes: {},
				isEntry: false,
			}),
		load: async (id: string) => handlerOf("load", plugin.load).call(context, id),
	};
}
