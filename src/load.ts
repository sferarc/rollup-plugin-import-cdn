import url from "node:url";
import { init, parse } from "es-module-lexer";
import type { AvailableCDNs, Dependency, PluginOptions } from "./types";

const isUrl = (value: string) => /^(http(s){0,1}:){0,1}\/\//.test(value);

const parseCDN: Record<AvailableCDNs, (key: string, version?: string) => string> = {
	skypack: (key, version) => {
		const versionTag = version ? `@${version}` : "";
		return `https://cdn.skypack.dev/${key}${versionTag}`;
	},
};

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

	const { fetchImpl } = options;

	for (const cdnUrl of urls) {
		try {
			const response = await fetchImpl(cdnUrl);
			const main = await response.text();

			return { name, url: response.url, main };
		} catch (error) {
			console.debug(`Error fetching ${name}`, error);
		}
	}

	console.warn(`[rollup-plugin-import-cdn] Could not resolve dependency ${name}`);

	return null;
}

export async function loadHook(key: string, options: PluginOptions) {
	const dependency = await resolveDependency(key, options);
	if (!dependency) return;

	await init;

	const [imports] = parse(dependency.main);

	let position = 0;

	return imports
		.map(({ s, e }) => {
			const string = dependency.main.slice(s, e);

			const variable = dependency.main.slice(s - 1, e + 1);
			if (variable.startsWith("(") && variable.endsWith(")")) {
				return undefined;
			}

			return !isUrl(string) ? { string, start: s, end: e } : undefined;
		})
		.reduce((code, data) => {
			if (!data) return code;

			const resolvedUrl = url.resolve(dependency.url, data.string);

			const s = data.start + position;
			const e = data.end + position;
			const str = resolvedUrl.split("");
			const before = code.slice(0, s);
			const middle = code.slice(s, e);
			const after = code.slice(e);
			const lMiddle = middle.length;
			const lStr = str.length;
			position += lStr - lMiddle;
			return [...before, ...str, ...after];
		}, dependency.main.split(""))
		.join("");
}
