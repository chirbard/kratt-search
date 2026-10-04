// Vectors are stored as int8 with one scale per vector: a quarter of float32's
// size, so a 12k-chunk vault is ~12 MB instead of ~50 MB -- small enough to
// load on a phone and to sync. Cosine ranking barely moves under int8.

export interface Quantized {
	values: Int8Array;
	scale: number;
}

export function quantize(vector: number[]): Quantized {
	let largest = 0;
	for (const value of vector) {
		const magnitude = Math.abs(value);
		if (magnitude > largest) {
			largest = magnitude;
		}
	}
	const scale = largest > 0 ? largest / 127 : 1;
	const values = new Int8Array(vector.length);
	for (let index = 0; index < vector.length; index++) {
		values[index] = Math.round(vector[index] / scale);
	}
	return { values, scale };
}

export function norm(vector: number[]): number[] {
	let sum = 0;
	for (const value of vector) {
		sum += value * value;
	}
	const length = Math.sqrt(sum);
	if (length === 0) {
		return vector;
	}
	const unit: number[] = [];
	for (const value of vector) {
		unit.push(value / length);
	}
	return unit;
}

// Cosine between a unit-length query and one stored int8 vector, read in place
// from the shared buffer. The stored vector's scale cancels out of cosine, so
// only its own length is needed.
export function cosineAt(query: Float32Array, store: Int8Array, offset: number, dim: number): number {
	let dot = 0;
	let storedNorm = 0;
	for (let index = 0; index < dim; index++) {
		const stored = store[offset + index];
		dot += query[index] * stored;
		storedNorm += stored * stored;
	}
	if (storedNorm === 0) {
		return 0;
	}
	return dot / Math.sqrt(storedNorm);
}
