// Neither import is installed: the plugin fetches both from esm.sh at build time.
import { useState } from "https://esm.sh/preact@10.19.3/hooks";
import { h, render } from "preact";

function Counter() {
	const [count, setCount] = useState(0);
	return h("button", { onClick: () => setCount(count + 1) }, `Clicked ${count} times`);
}

render(h(Counter, null), document.getElementById("app"));
