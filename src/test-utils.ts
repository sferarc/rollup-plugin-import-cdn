import type { NormalizedInputOptions, Plugin, PluginContext } from "rollup";

// The plugin only logs through its hook context, so this fake records `warn` and `debug`.
export function fakeContext({ withDebug = true } = {}) {
	const logs = { warn: [] as string[], debug: [] as string[] };
	const context = {
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
				isEntry: false,
			}),
		load: async (id: string) => handlerOf("load", plugin.load).call(context, id),
	};
}
