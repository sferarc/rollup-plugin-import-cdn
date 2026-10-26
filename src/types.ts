export const availableCDNs = ["skypack", "esm.sh", "jsdelivr"] as const;

export type AvailableCDNs = (typeof availableCDNs)[number];

export type FetchImpl = (
	url: string,
	/** The plugin passes only `signal`, aborted when `timeout` expires. */
	init?: {
		body?: string;
		headers?: Record<string, string>;
		method?: string;
		signal?: AbortSignal;
	},
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
	/** Milliseconds each request, body included, may take before it fails and the next CDN is tried; default 30000, `0` disables. */
	timeout?: number;
	/** Versions keyed by exact specifier, falling back to the package name for subpath imports unless the specifier carries its own version. */
	versions?: Record<string, string>;
}

export interface Dependency {
	name: string;
	url: string;
	main: string;
}
