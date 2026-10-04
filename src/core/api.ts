// OpenRouter calls: embeddings, and Jev's System One endpoint. The transport is
// injected so the plugin uses Obsidian's requestUrl (no CORS, works on mobile)
// while tests and scripts use fetch.

export type Post = (url: string, body: unknown, apiKey: string) => Promise<unknown>;

const EMBED_URL = "https://openrouter.ai/api/v1/embeddings";
const SYSTEM_ONE_URL = "https://openrouter.ai/api/v1/systemone";

export interface Costed<T> {
	value: T;
	cost: number;
}

export interface Client {
	post: Post;
	apiKey: string;
	embedModel: string;
	jevModel: string;
}

export async function embed(client: Client, texts: string[]): Promise<Costed<number[][]>> {
	const body = { model: client.embedModel, input: texts, encoding_format: "float" };
	const response = asRecord(await client.post(EMBED_URL, body, client.apiKey));
	const data = response["data"];
	if (!Array.isArray(data)) {
		throw new Error(`embedding response has no data: ${JSON.stringify(response).slice(0, 300)}`);
	}
	const vectors: number[][] = new Array(texts.length);
	for (const item of data) {
		const entry = asRecord(item);
		const index = entry["index"];
		const vector = entry["embedding"];
		if (typeof index !== "number" || !Array.isArray(vector) || index >= texts.length) {
			throw new Error("malformed embedding item");
		}
		vectors[index] = vector as number[];
	}
	for (let index = 0; index < texts.length; index++) {
		if (vectors[index] === undefined) {
			throw new Error(`embedding ${index} missing`);
		}
	}
	return { value: vectors, cost: usageCost(response) };
}

// Many yes/no questions about one state, in one request. Questions are named
// q1..qN so answers can be put back in order.
export async function yesProbabilities(client: Client, state: string, instructions: unknown[]): Promise<Costed<number[]>> {
	const questions: Record<string, unknown> = {};
	for (let index = 0; index < instructions.length; index++) {
		questions[`q${index + 1}`] = { type: "noul", instructions: instructions[index] };
	}
	const response = await systemOne(client, state, questions);
	const probabilities: number[] = [];
	for (let index = 0; index < instructions.length; index++) {
		const answer = asRecord(asRecord(response["answers"])[`q${index + 1}`]);
		const probability = answer["noul"];
		if (typeof probability !== "number") {
			throw new Error(`noul answer q${index + 1} missing`);
		}
		probabilities.push(probability);
	}
	return { value: probabilities, cost: usageCost(response) };
}

export interface ChoiceQuestion {
	instructions: string;
	options: Record<string, string>;
}

export async function chooseMany(client: Client, state: string, choices: ChoiceQuestion[]): Promise<Costed<string[]>> {
	const questions: Record<string, unknown> = {};
	for (let index = 0; index < choices.length; index++) {
		questions[`q${index + 1}`] = { type: "choice", instructions: choices[index].instructions, criteria: choices[index].options };
	}
	const response = await systemOne(client, state, questions);
	const labels: string[] = [];
	for (let index = 0; index < choices.length; index++) {
		const answer = asRecord(asRecord(response["answers"])[`q${index + 1}`]);
		const label = answer["choice"];
		if (typeof label !== "string") {
			throw new Error(`choice answer q${index + 1} missing`);
		}
		labels.push(label);
	}
	return { value: labels, cost: usageCost(response) };
}

async function systemOne(client: Client, state: string, questions: Record<string, unknown>): Promise<Record<string, unknown>> {
	const body = { model: client.jevModel, state, questions };
	return asRecord(await client.post(SYSTEM_ONE_URL, body, client.apiKey));
}

function usageCost(response: Record<string, unknown>): number {
	const cost = asRecord(response["usage"])["cost"];
	if (typeof cost === "number") {
		return cost;
	}
	return 0;
}

function asRecord(value: unknown): Record<string, unknown> {
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return {};
}

// The transport for scripts and tests outside Obsidian.
export const fetchPost: Post = async (url, body, apiKey) => {
	const response = await fetch(url, {
		method: "POST",
		headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
	}
	return JSON.parse(text);
};
