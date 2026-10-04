# kratt search

An Obsidian plugin that finds the note you mean, on desktop and mobile.

Describe the note, press Enter. Chunk embeddings shortlist 100 notes, Jev
(TypeSafe's decision model) judges each one, and the top ten are compared head
to head. Measured on a real 1,486-note vault: about $0.0015 and 2 s per search;
indexing ~12k chunks costs under a cent, once.

**New here? Ask your AI to explain the project, starting from `src/core/search.ts`.**

## Install

```sh
npm install && npm run build
mkdir -p <vault>/.obsidian/plugins/kratt-search
cp main.js manifest.json styles.css <vault>/.obsidian/plugins/kratt-search/
```

Enable it in Settings → Community plugins, paste your OpenRouter key, set
"Folders to search", then run the command **kratt search: Update index**.
Search with `Mod+Shift+K` or the ribbon icon.

## Develop

Needs Node 22.18+. `npm test` (core logic, no Obsidian needed), `npm run typecheck`,
`node scripts/run.ts index|search …` to run the core against a real folder —
it prints paths and ranks, never note text.

## Why this design

Measured on a real, mixed Estonian/English vault of 1,486 notes, with
questions whose right answer was confirmed by the vault's owner:

- **Plain embedding search misses notes that mean the question without
  sharing its words.** "When did my car break down" ranked the right daily
  note 36th; it said, in Estonian, that the car "decided it's three-cylinder
  now". Other targets sat at 17th and 77th.
- **Reranking whole notes cannot fix that** — the right note was outside any
  affordable shortlist. A dedicated reranker (Qwen3-Reranker) also scored
  Estonian journal text near zero.
- **Chunks make reading deep cheap.** At ~500 characters a chunk, Jev reads
  100 candidates for a fraction of a cent. That reached two of three targets
  at #1, at about a twentieth of the price of having Jev read every note.
- **Head to head** sorts the finalists more sharply than yes/no scores alone.
  It always crowns a winner, so the window says "nothing clearly matched" when
  Jev's own yes score is low everywhere.

Known limits: Jev reads dates as text, so "the last time…" needs judgement
from you; each search sends ~100 chunks of your notes to OpenRouter and Jev's
provider; and the evidence is three questions, not a benchmark.
