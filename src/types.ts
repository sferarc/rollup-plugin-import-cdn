export type AvailableCDNs = "skypack";

export type FetchImpl = (
	url: string,
	init?: { body?: string; headers?: Record<string, string>; method?: string },
) => Promise<{
	ok: boolean;
	text(): Promise<string>;
	url: string;
}>;

export interface PluginOptions {
	fetchImpl: FetchImpl;
	priority?: Array<AvailableCDNs | ((key: string) => string)>;
	versions?: Record<string, string>;
}

export interface Dependency {
	name: string;
	url: string;
	main: string;
}
