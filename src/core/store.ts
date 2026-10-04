import { CHUNK_MAX_CHARS, splitNote } from "./chunk.ts";
import { quantize } from "./vectors.ts";

// The index: every note's chunks, and one int8 vector per distinct chunk
// input. Vectors are keyed by a hash of what was embedded (path + chunk text),
// so an unchanged chunk is never embedded again.

export interface StoredChunk {
	hash: string;
	line: number;
	text: string;
}

export interface Index {
	version: number;
	embedModel: string;
	dim: number;
	files: Record<string, { mtime: number; chunks: StoredChunk[] }>;
	// hash -> row in `vectors`
	rows: Record<string, number>;
	scales: number[];
	vectors: Int8Array;
}

export const INDEX_VERSION = 1;

export function emptyIndex(embedModel: string): Index {
	return { version: INDEX_VERSION, embedModel, dim: 0, files: {}, rows: {}, scales: [], vectors: new Int8Array(0) };
}

export function embedInput(path: string, text: string): string {
	return `${path}\n\n${text}`;
}

export async function chunksOf(path: string, body: string): Promise<StoredChunk[]> {
	const chunks: StoredChunk[] = [];
	for (const chunk of splitNote(body)) {
		chunks.push({ hash: await sha256(embedInput(path, chunk.text)), line: chunk.line, text: chunk.text });
	}
	return chunks;
}

// Hashes referenced by some file but with no vector yet.
export function missingHashes(index: Index): Map<string, string> {
	const missing = new Map<string, string>();
	for (const path of Object.keys(index.files)) {
		for (const chunk of index.files[path].chunks) {
			if (index.rows[chunk.hash] === undefined && !missing.has(chunk.hash)) {
				missing.set(chunk.hash, embedInput(path, chunk.text));
			}
		}
	}
	return missing;
}

// Appends vectors, then drops rows no file references any more, so deleted and
// edited chunks do not accumulate forever.
export function addVectors(index: Index, hashes: string[], vectors: number[][]): Index {
	if (hashes.length === 0) {
		return compact(index);
	}
	const dim = vectors[0].length;
	if (index.dim !== 0 && index.dim !== dim) {
		throw new Error(`embedding width changed from ${index.dim} to ${dim}; rebuild the index`);
	}
	const oldRows = index.scales.length;
	const grown = new Int8Array((oldRows + hashes.length) * dim);
	grown.set(index.vectors);
	for (let added = 0; added < hashes.length; added++) {
		const quantized = quantize(vectors[added]);
		grown.set(quantized.values, (oldRows + added) * dim);
		index.rows[hashes[added]] = oldRows + added;
		index.scales.push(quantized.scale);
	}
	index.vectors = grown;
	index.dim = dim;
	return compact(index);
}

function compact(index: Index): Index {
	const live = new Set<string>();
	for (const path of Object.keys(index.files)) {
		for (const chunk of index.files[path].chunks) {
			live.add(chunk.hash);
		}
	}
	const keep: string[] = [];
	for (const hash of Object.keys(index.rows)) {
		if (live.has(hash)) {
			keep.push(hash);
		}
	}
	if (keep.length === Object.keys(index.rows).length) {
		return index;
	}
	const vectors = new Int8Array(keep.length * index.dim);
	const scales: number[] = [];
	const rows: Record<string, number> = {};
	for (let row = 0; row < keep.length; row++) {
		const old = index.rows[keep[row]];
		vectors.set(index.vectors.subarray(old * index.dim, (old + 1) * index.dim), row * index.dim);
		scales.push(index.scales[old]);
		rows[keep[row]] = row;
	}
	return { ...index, rows, scales, vectors };
}

// Two files: JSON metadata, and the raw int8 vectors.
export function serialize(index: Index): { meta: string; vectors: ArrayBuffer } {
	const { vectors, ...rest } = index;
	const copy = vectors.slice();
	return { meta: JSON.stringify(rest), vectors: copy.buffer as ArrayBuffer };
}

export function deserialize(meta: string, vectors: ArrayBuffer): Index {
	const parsed = JSON.parse(meta);
	return { ...parsed, vectors: new Int8Array(vectors) };
}

export function chunkCount(index: Index): number {
	let count = 0;
	for (const path of Object.keys(index.files)) {
		count += index.files[path].chunks.length;
	}
	return count;
}

async function sha256(text: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	const bytes = new Uint8Array(digest);
	let hex = "";
	for (const byte of bytes) {
		hex += byte.toString(16).padStart(2, "0");
	}
	return hex;
}

export { CHUNK_MAX_CHARS };
