// Neither import is installed: the plugin fetches both from esm.sh at build time.
import uniq from "https://esm.sh/lodash-es@4.17.21/uniq";
import capitalize from "lodash-es/capitalize";

console.log(uniq(["a", "b", "a", "c"]));
console.log(capitalize("rolldown import CDN"));
