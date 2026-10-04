import { test } from "node:test";
import assert from "node:assert/strict";
import { packBySize } from "../src/core/pack.ts";
import { addVectors, chunksOf, deserialize, emptyIndex, missingHashes, serialize } from "../src/core/store.ts";
import { bestChunks, finalOrder, orderedPairs, search, tallyWins, type Candidate } from "../src/core/search.ts";
import type { Client, Post } from "../src/core/api.ts";

test("packing keeps ranges under budget and covers everything", () => {
	assert.deepEqual(packBySize([40, 40, 40], 80), [[0, 2], [2, 3]]);
	assert.deepEqual(packBySize([900, 10], 100), [[0, 1], [1, 2]]);
	assert.deepEqual(packBySize([], 100), []);
});

test("pairs are asked both ways, adjacently", () => {
	assert.deepEqual(orderedPairs(3), [[0, 1], [1, 0], [0, 2], [2, 0], [1, 2], [2, 1]]);
});

test("win share counts each note's comparisons", () => {
	const finals = tallyWins([1, 1, 0, 0, 1, 1], { value: [0, 0, 0], cost: 0, failures: 0 }, 3);
	assert.deepEqual(finals.value, [0.5, 1, 0]);
});

test("finalists sort by wins, the rest stay in Jev order", () => {
	const make = (path: string, jev: number): Candidate => ({ path, text: "", line: 0, cosine: 0, jev, wins: null });
	const ordered = finalOrder([make("a", 0.9), make("b", 0.8), make("c", 0.7)], [0.25, 1]);
	assert.deepEqual(ordered.map((candidate) => candidate.path), ["b", "a", "c"]);
});

async function smallIndex() {
	let index = emptyIndex("fake");
	index.files["notes/car.md"] = { mtime: 1, chunks: await chunksOf("notes/car.md", "groceries\n\n# Auto\nauto jäi seisma") };
	index.files["notes/soup.md"] = { mtime: 1, chunks: await chunksOf("notes/soup.md", "hernesupp") };
	const missing = missingHashes(index);
	const hashes = Array.from(missing.keys());
	const vectors: number[][] = [];
	for (const hash of hashes) {
		vectors.push(missing.get(hash)!.includes("auto") ? [1, 0] : [0, 1]);
	}
	return addVectors(index, hashes, vectors);
}

test("the index round-trips and ranks a note by its best chunk", async () => {
	const index = deserialize(...Object.values(serialize(await smallIndex())) as [string, ArrayBuffer]);
	const best = bestChunks(index, [1, 0], 10);
	assert.equal(best[0].path, "notes/car.md");
	assert.ok(best[0].text.includes("auto"));
	assert.equal(best[0].line, 2);
});

test("removing a file drops its vectors", async () => {
	const index = await smallIndex();
	delete index.files["notes/soup.md"];
	const compacted = addVectors(index, [], []);
	assert.equal(compacted.scales.length, Object.keys(compacted.rows).length);
	assert.equal(bestChunks(compacted, [0, 1], 10).length, 1);
});

// The whole pipeline against a fake OpenRouter: the note mentioning "auto"
// wins every yes/no and every pair, and costs are summed.
test("search runs embed, score and head to head", async () => {
	const post: Post = async (url, body) => {
		const request = body as Record<string, any>;
		if (url.endsWith("/embeddings")) {
			return { data: [{ index: 0, embedding: [1, 0.2] }], usage: { cost: 0.001 } };
		}
		const answers: Record<string, unknown> = {};
		for (const [name, question] of Object.entries(request.questions as Record<string, any>)) {
			if (question.type === "noul") {
				answers[name] = { noul: String(question.instructions.note).includes("auto") ? 0.9 : 0.1 };
			} else {
				answers[name] = { choice: String(question.criteria.a).includes("auto") ? "a" : "b" };
			}
		}
		return { answers, usage: { cost: 0.0005 } };
	};
	const client: Client = { post, apiKey: "k", embedModel: "e", jevModel: "j" };
	const outcome = await search(client, await smallIndex(), "car broke down", 10);
	assert.equal(outcome.results[0].path, "notes/car.md");
	assert.equal(outcome.results[0].wins, 1);
	assert.equal(outcome.failures, 0);
	assert.ok(Math.abs(outcome.cost - 0.002) < 1e-9);
});
