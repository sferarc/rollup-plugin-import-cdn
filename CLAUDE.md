# rollup-plugin-import-cdn

A Rollup plugin that imports ESM packages and URLs from a CDN so Rollup can process and tree-shake them like local code. Published to npm as `rollup-plugin-import-cdn`. `README.md` is the user documentation.

## Knowledge Base

Read `brain/` files relevant to your task before acting. Update after changes.

| Topic | Doc |
| --- | --- |
| Module map, options, known gaps | `brain/architecture/overview.md` |
| `resolveId`, specifier to CDN URL | `brain/architecture/resolution.md` |
| `load`, rewriting imports in fetched code | `brain/architecture/import-rewriting.md` |
| Node, pnpm, mise, commands, build | `brain/development/toolchain.md` |
| Tests and what they do not cover | `brain/development/testing.md` |
| CI checks and branch rules | `brain/development/ci.md` |
| Changesets and publishing | `brain/development/release.md` |
| Decisions, dated | `brain/decisions/index.md` |
| Plans | `brain/plans/index.md` |

## Brain

The `brain/` directory is an Obsidian vault: persistent notes on how the plugin works and why.

- **Read first.** Read brain files relevant to your task before acting.
- **Write** after mistakes, corrections, or notable learnings about the code.
- **Structure:** One topic per file. Directories with `[[wikilink]]` indexes.
- **Verifiable:** Cite the file, test, commit or pull request behind a claim, and mark unknowns as unknown.
- **Public:** This repository is public. Keep notes to the code and the project's own process.
- **Maintain:** Delete outdated notes rather than letting them drift.

## Ground rules

- Run `pnpm lint`, `pnpm exec lefthook validate`, `pnpm knip`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm is-tree-shakable` before opening a pull request. CI requires `Check`, which runs all of them.
- Add a changeset (`pnpm changeset`) for any change that should be released.
- No em or en dashes in prose. Commit subjects are imperative, with a conventional prefix.
- Never publish, tag, bump the version or set `RELEASE_ENABLED`: releases are the owner's step (`brain/development/release.md`).
