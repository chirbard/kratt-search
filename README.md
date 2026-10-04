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

`npm test` (core logic, no Obsidian needed), `npm run typecheck`,
`node scripts/run.ts index|search …` to run the core against a real folder —
it prints paths and ranks, never note text.

Why the pipeline is shaped this way is in kratt-v4's roadmap
(`research/jev-for-kratt`, `research/jev-test-results`).
