# kratt-search

Instructions for any coding agent in this repo. `CLAUDE.md` only imports this
file. What the plugin does and why is in `README.md`; how is in the code,
starting from `src/core/search.ts`. This file holds only what the code cannot
tell you.

## Rules

- **`src/core/` never imports `obsidian`.** It is tested with Node's runner
  and run from `scripts/run.ts` against real folders. Obsidian-specific code
  (`main.ts`, `indexer.ts`, `modal.ts`, `settings.ts`) stays thin around it.
- **Style:** simple imperative code — explicit loops, guard clauses, small
  named functions. No clever chains.
- **Never print note text** when verifying. `scripts/run.ts` prints paths,
  ranks, cost and time only; keep it that way. A user's notes are not yours to
  read.
- **Per-device state never goes in `data.json`.** It syncs between devices
  with the rest of `.obsidian`. A synced "this device writes the index" flag
  once made two devices write the index at once and produced sync conflicts.
  Use `app.saveLocalStorage`.
- **Pipeline constants are measured, not tuned by feel** (`SHORTLIST`,
  `FINALISTS`, chunk sizes, the prompt wording). Change one only with a
  before/after run on labelled questions.

## Done means

`npm run typecheck`, `npm test` and `npm run build` pass, **and** the change
ran: core changes through `scripts/run.ts` on a real or synthetic folder, UI
changes in Obsidian on desktop and, where it matters, on a phone. Say what you
ran and what it printed.
