// A CommonJS consumer under node16 takes the require condition, which needs .d.cts declarations (#207).
import { importCdn } from "rollup-plugin-import-cdn";

export const name: string = importCdn({ priority: ["esm.sh"] }).name;
