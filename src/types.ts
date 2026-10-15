export const availableCDNs = ["skypack"] as const;

export type AvailableCDNs = (typeof availableCDNs)[number];

export type FetchImpl = (
	url: string,
	init?: { body?: string; headers?: Record<string, string>; method?: string },
) => Promise<{
	ok: boolean;
	status?: number;
	text(): Promise<string>;
	url: string;
}>;

export interface PluginOptions {
	/** Directory for an on-disk cache of responses, used only for URLs pinned to an exact version. */
	cache?: string;
	fetchImpl: FetchImpl;
	priority?: Array<AvailableCDNs | ((key: string, version?: string) => string)>;
	versions?: Record<string, string>;
}

export interface Dependency {
	name: string;
	url: string;
	main: string;
}
