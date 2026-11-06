// No top-level import or export: that would make these module augmentations, which fail for a URL.
declare module "https://esm.sh/es-module-lexer@3.0.4" {
	export * from "es-module-lexer";
}

declare module "https://esm.sh/*";
