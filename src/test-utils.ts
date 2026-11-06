import type { NormalizedInputOptions, Plugin, PluginContext } from "rollup";

// The plugin only logs through its hook context and reads `meta`, so this fake records `warn` and `debug`.
export function fakeContext({ withDebug = true } = {}) {
	const logs = { warn: [] as string[], debug: [] as string[] };
	const context = {
		meta: { rollupVersion: "4.0.0", watchMode: false },
		warn: (message: string) => logs.warn.push(message),
		...(withDebug && { debug: (message: string) => logs.debug.push(message) }),
	} as unknown as PluginContext;
	return { context, logs };
}

function handlerOf<F>(name: string, hook: F | { handler: F } | undefined): F {
	if (hook === undefined) throw new Error(`Plugin has no ${name} hook`);
	return typeof hook === "object" && hook !== null && "handler" in hook ? hook.handler : hook;
}

export function hooks(plugin: Plugin, { context, logs } = fakeContext()) {
	return {
		logs,
		buildStart: () =>
			handlerOf("buildStart", plugin.buildStart).call(context, {} as NormalizedInputOptions),
		resolveId: async (id: string, importer?: string) =>
			handlerOf("resolveId", plugin.resolveId).call(context, id, importer, {
				attributes: {},
				importerAttributes: {},
				isEntry: false,
			}),
		load: async (id: string) => {
			// Rollup 5 requires rawId, which Rollup 4's load options reject as an excess property in a literal.
			const loadOptions = { attributes: {}, rawId: id };
			return handlerOf("load", plugin.load).call(context, id, loadOptions);
		},
	};
}
