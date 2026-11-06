// The README's TypeScript section: URL imports typed through cdn-modules.d.ts.
import anything from "https://esm.sh/canvas-confetti";
import { init, parse } from "https://esm.sh/es-module-lexer@3.0.4";

await init;
export const [imports] = parse("import a from 'a';");

// @ts-expect-error The declaration carries es-module-lexer's real types, not `any`.
parse(42);

// The wildcard declaration types any other esm.sh import as `any`.
export const untyped: number = anything;
