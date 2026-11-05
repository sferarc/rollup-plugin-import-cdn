// Neither import is installed: the plugin fetches both from esm.sh at build time.
import kebabCase from "https://esm.sh/lodash-es@4.17.21/kebabCase";
import chunk from "lodash-es/chunk";

console.log(chunk(["a", "b", "c", "d"], 2));
console.log(kebabCase("Rollup Import CDN"));
