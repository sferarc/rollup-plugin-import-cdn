export const availableCDNs = ["skypack"] as const;

export type AvailableCDNs = (typeof availableCDNs)[number];

export type FetchImpl = (
	url: string,
	/** Never passed by the plugin; kept for compatibility with `fetch`. */
	init?: { body?: string; headers?: Record<string, string>; method?: string },
) => Promise<{
	ok: boolean;
	status?: number;
	text(): Promise<string>;
	url: string;
}>;

export interface PluginOptions {
	/** Directory for an on-disk cache of responses, used only for URLs whose path contains an exact `@x.y.z` version. */
	cache?: string;
	/** Defaults to the global `fetch`; `importCdn` throws when neither is available. */
	fetchImpl: FetchImpl;
	/** SRI values (`sha384-<base64>`, space-separated for several) keyed by the requested or final CDN URL; a body that does not match fails the build. */
	integrity?: Record<string, string>;
	/** CDNs tried in order until one succeeds, default `["skypack"]`; a function gets the specifier and its `versions` entry. */
	priority?: Array<AvailableCDNs | ((key: string, version?: string) => string)>;
	/** Versions keyed by exact specifier, falling back to the package name for subpath imports unless the specifier carries its own version. */
	versions?: Record<string, string>;
}

export interface Dependency {
	name: string;
	url: string;
	main: string;
}
