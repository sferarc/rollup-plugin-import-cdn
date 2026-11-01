# Plans

GitHub Issues are the source of truth for todos, pending work, progress and the roadmap: [issues labelled `product:rollup-plugin-import-cdn`](https://github.com/sferarc/rollup-plugin-import-cdn/issues?q=is%3Aissue+is%3Aopen+label%3Aproduct%3Arollup-plugin-import-cdn). Notes here keep the vision, the phases and planning detail that does not fit an issue; they are not a todo list.

## Vision

Let a Rollup or Vite build import ESM packages and URLs from a CDN and bundle them like local code, with exact versions, an on-disk cache and integrity checks so builds stay reproducible.

## Phases

- **Close the known gaps (done).** Every item in [[2026-10-20-plugin-gaps]] is done or decided.
- **First release from this repository (done).** `0.4.0` published on 2026-11-01. Tracked in [#111](https://github.com/sferarc/rollup-plugin-import-cdn/issues/111): the npm trusted publisher ([#108](https://github.com/sferarc/rollup-plugin-import-cdn/issues/108)), enabling releases ([#109](https://github.com/sferarc/rollup-plugin-import-cdn/issues/109)) and merging the `0.4.0` version pull request ([#110](https://github.com/sferarc/rollup-plugin-import-cdn/issues/110)). See [[decisions/2026-10-08-release-off-until-enabled]] and [[development/release]].
- **Keep the built-in CDNs honest (current).** The URL shapes the plugin relies on were checked by hand with `curl`; a weekly live build now checks them ([#115](https://github.com/sferarc/rollup-plugin-import-cdn/issues/115), [[development/testing]]). The default `priority` moves from Skypack, which served React 17 for pinned 18.x and 19.x versions, to esm.sh ([#116](https://github.com/sferarc/rollup-plugin-import-cdn/issues/116), [[decisions/2026-11-01-default-priority-esm-sh]]).

## Plan notes

One file per plan.

- [[2026-10-20-plugin-gaps]]: fixes for the known gaps and untested areas, ordered by risk and cost; every item done or decided by 2026-10-21
