// Runs the plugin's core outside Obsidian, for verification:
//   node scripts/run.ts index <vault-folder> <index-dir>
//   node scripts/run.ts search <index-dir> "<query>" [expected-path-substring]
// Prints paths, ranks, cost and time only -- never note text.
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { embed, fetchPost, type Client } from "../src/core/api.ts";
import { addVectors, chunkCount, chunksOf, deserialize, emptyIndex, missingHashes, serialize } from "../src/core/store.ts";
import { FINALISTS, search } from "../src/core/search.ts";

const client: Client = {
	post: fetchPost,
	apiKey: process.env.OPENROUTER_API_KEY ?? "",
	embedModel: "perplexity/pplx-embed-v1-0.6b",
	jevModel: "typesafe/jev-1.13",
};

function markdownFiles(root: string, folder: string, out: string[]): void {
	for (const name of readdirSync(folder)) {
		if (name.startsWith(".")) {
			continue;
		}
		const path = join(folder, name);
		if (statSync(path).isDirectory()) {
			markdownFiles(root, path, out);
		} else if (name.endsWith(".md")) {
			out.push(relative(root, path));
		}
	}
}

async function runIndex(vault: string, dir: string): Promise<void> {
	let index = emptyIndex(client.embedModel);
	const files: string[] = [];
	markdownFiles(vault, vault, files);
	for (const path of files) {
		const body = readFileSync(join(vault, path), "utf8").normalize("NFC");
		index.files[path.normalize("NFC")] = { mtime: 0, chunks: await chunksOf(path.normalize("NFC"), body) };
	}
	const missing = missingHashes(index);
	const hashes = Array.from(missing.keys());
	let cost = 0;
	for (let start = 0; start < hashes.length; start += 128) {
		const batch = hashes.slice(start, start + 128);
		const inputs: string[] = [];
		for (const hash of batch) {
			inputs.push(missing.get(hash)!);
		}
		const result = await embed(client, inputs);
		index = addVectors(index, batch, result.value);
		cost += result.cost;
	}
	mkdirSync(dir, { recursive: true });
	const saved = serialize(index);
	writeFileSync(join(dir, "index.json"), saved.meta);
	writeFileSync(join(dir, "index.bin"), Buffer.from(saved.vectors));
	console.log(`${files.length} notes, ${chunkCount(index)} chunks, ${hashes.length} embedded, $${cost.toFixed(4)}`);
}

async function runSearch(dir: string, query: string, expected: string | undefined): Promise<void> {
	const index = deserialize(readFileSync(join(dir, "index.json"), "utf8"), readFileSync(join(dir, "index.bin")).buffer as ArrayBuffer);
	const outcome = await search(client, index, query, FINALISTS);
	console.log(`"${query}"  ${(outcome.millis / 1000).toFixed(2)} s  $${outcome.cost.toFixed(5)}  failures=${outcome.failures}`);
	for (let rank = 0; rank < outcome.results.length; rank++) {
		const result = outcome.results[rank];
		const hit = expected !== undefined && result.path.normalize("NFC").includes(expected.normalize("NFC"));
		if (rank < 5 || hit) {
			console.log(`  ${hit ? "->" : "  "} #${rank + 1}  ${result.path}  jev=${result.jev?.toFixed(2)} wins=${result.wins?.toFixed(2) ?? "-"}`);
		}
	}
}

const [mode, first, second, third] = process.argv.slice(2);
if (mode === "index" && existsSync(first)) {
	await runIndex(first, second);
} else if (mode === "search") {
	await runSearch(first, second, third);
} else {
	console.log("usage: node scripts/run.ts index <vault-folder> <index-dir> | search <index-dir> <query> [expected]");
}
