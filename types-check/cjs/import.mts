import { importCdn } from "rollup-plugin-import-cdn";

export const name: string = importCdn({ priority: ["esm.sh"] }).name;
