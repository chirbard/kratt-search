import { chooseMany, embed, yesProbabilities, type ChoiceQuestion, type Client } from "./api.ts";
import { BATCH_CHAR_BUDGET, packBySize } from "./pack.ts";
import type { Index } from "./store.ts";
import { cosineAt, norm } from "./vectors.ts";

// The design measured on a real vault ("Why this design" in README.md):
//   1. cosine over chunks -> each note's best chunk -> top SHORTLIST notes
//   2. Jev asks of each "is this about what the user asks?"
//   3. the top FINALISTS are compared head to head, every pair both ways
// On three labelled real questions it put two targets at #1 for ~$0.0015.
export const SHORTLIST = 100;
export const FINALISTS = 10;

const RANK_TASK = "The user is searching their notes. Is this note about what the user asks?";
const PAIR_TASK = "The user is searching their notes. Which of these two notes is more about what the user asks?";

export interface Candidate {
	path: string;
	text: string;
	line: number;
	cosine: number;
	jev: number | null;
	// share of head-to-head comparisons won; null outside the finalists
	wins: number | null;
}

export interface Outcome {
	results: Candidate[];
	cost: number;
	millis: number;
	failures: number;
}

export async function search(client: Client, index: Index, query: string, finalists: number): Promise<Outcome> {
	const started = Date.now();
	const embedded = await embed(client, [query]);
	const shortlist = bestChunks(index, embedded.value[0], SHORTLIST);
	const scored = await scoreAll(client, query, shortlist);
	const ranked = byJev(shortlist);
	const finals = await headToHead(client, query, ranked.slice(0, finalists));
	return {
		results: finalOrder(ranked, finals.value),
		cost: embedded.cost + scored.cost + finals.cost,
		millis: Date.now() - started,
		failures: scored.failures + finals.failures,
	};
}

// Each note scored by its best chunk; the top `count` notes, best first.
export function bestChunks(index: Index, queryVector: number[], count: number): Candidate[] {
	const query = Float32Array.from(norm(queryVector));
	const best = new Map<string, Candidate>();
	for (const path of Object.keys(index.files)) {
		for (const chunk of index.files[path].chunks) {
			const row = index.rows[chunk.hash];
			if (row === undefined) {
				continue;
			}
			const cosine = cosineAt(query, index.vectors, row * index.dim, index.dim);
			const current = best.get(path);
			if (current === undefined || cosine > current.cosine) {
				best.set(path, { path, text: chunk.text, line: chunk.line, cosine, jev: null, wins: null });
			}
		}
	}
	const all = Array.from(best.values());
	all.sort((left, right) => right.cosine - left.cosine);
	return all.slice(0, count);
}

function noteText(candidate: Candidate): string {
	return `${candidate.path}\n\n${candidate.text}`;
}

interface Scored {
	cost: number;
	failures: number;
}

// Every candidate asked the same yes/no question; packed, sent all at once.
// A failed request leaves its candidates unscored rather than failing search.
async function scoreAll(client: Client, query: string, candidates: Candidate[]): Promise<Scored> {
	const instructions: unknown[] = [];
	const sizes: number[] = [];
	for (const candidate of candidates) {
		instructions.push({ task: RANK_TASK, note: noteText(candidate) });
		sizes.push(noteText(candidate).length + RANK_TASK.length);
	}
	const ranges = packBySize(sizes, BATCH_CHAR_BUDGET);
	const requests: Promise<void>[] = [];
	const totals: Scored = { cost: 0, failures: 0 };
	for (const [start, end] of ranges) {
		requests.push(scoreRange(client, query, candidates, instructions, start, end, totals));
	}
	await Promise.all(requests);
	return totals;
}

async function scoreRange(client: Client, query: string, candidates: Candidate[], instructions: unknown[], start: number, end: number, totals: Scored): Promise<void> {
	try {
		const answer = await yesProbabilities(client, query, instructions.slice(start, end));
		for (let offset = 0; offset < answer.value.length; offset++) {
			candidates[start + offset].jev = answer.value[offset];
		}
		totals.cost += answer.cost;
	} catch (error) {
		console.error("kratt-search: scoring request failed", error);
		totals.failures += end - start;
	}
}

function byJev(candidates: Candidate[]): Candidate[] {
	const ranked = candidates.slice();
	ranked.sort((left, right) => (right.jev ?? -1) - (left.jev ?? -1));
	return ranked;
}

// Every pair both ways round: cancels a preference for the first option.
export function orderedPairs(count: number): Array<[number, number]> {
	const pairs: Array<[number, number]> = [];
	for (let first = 0; first < count; first++) {
		for (let second = first + 1; second < count; second++) {
			pairs.push([first, second]);
			pairs.push([second, first]);
		}
	}
	return pairs;
}

interface Finals {
	value: number[];
	cost: number;
	failures: number;
}

async function headToHead(client: Client, query: string, finalists: Candidate[]): Promise<Finals> {
	const pairs = orderedPairs(finalists.length);
	const questions: ChoiceQuestion[] = [];
	const sizes: number[] = [];
	for (const [first, second] of pairs) {
		const options = { a: noteText(finalists[first]), b: noteText(finalists[second]) };
		questions.push({ instructions: PAIR_TASK, options });
		sizes.push(options.a.length + options.b.length + PAIR_TASK.length);
	}
	const winners: Array<number | null> = new Array(pairs.length).fill(null);
	const finals: Finals = { value: new Array(finalists.length).fill(0), cost: 0, failures: 0 };
	const requests: Promise<void>[] = [];
	for (const [start, end] of packBySize(sizes, BATCH_CHAR_BUDGET)) {
		requests.push(askPairs(client, query, questions, pairs, winners, start, end, finals));
	}
	await Promise.all(requests);
	return tallyWins(winners, finals, finalists.length);
}

async function askPairs(client: Client, query: string, questions: ChoiceQuestion[], pairs: Array<[number, number]>, winners: Array<number | null>, start: number, end: number, finals: Finals): Promise<void> {
	try {
		const answer = await chooseMany(client, query, questions.slice(start, end));
		for (let offset = 0; offset < answer.value.length; offset++) {
			const [first, second] = pairs[start + offset];
			winners[start + offset] = winnerOf(answer.value[offset], first, second);
		}
		finals.cost += answer.cost;
	} catch (error) {
		console.error("kratt-search: comparison request failed", error);
		finals.failures += end - start;
	}
}

function winnerOf(label: string, first: number, second: number): number | null {
	if (label === "a") {
		return first;
	}
	if (label === "b") {
		return second;
	}
	return null;
}

export function tallyWins(winners: Array<number | null>, finals: Finals, count: number): Finals {
	const each = 2 * Math.max(count - 1, 1);
	const wins: number[] = new Array(count).fill(0);
	for (const winner of winners) {
		if (winner !== null) {
			wins[winner]++;
		}
	}
	for (let index = 0; index < count; index++) {
		finals.value[index] = wins[index] / each;
	}
	return finals;
}

// Finalists by win share (ties by Jev score), then everyone else by Jev score.
export function finalOrder(ranked: Candidate[], wins: number[]): Candidate[] {
	const finalists: Candidate[] = [];
	for (let index = 0; index < wins.length; index++) {
		finalists.push({ ...ranked[index], wins: wins[index] });
	}
	finalists.sort((left, right) => (right.wins ?? 0) - (left.wins ?? 0) || (right.jev ?? 0) - (left.jev ?? 0));
	return finalists.concat(ranked.slice(wins.length));
}
