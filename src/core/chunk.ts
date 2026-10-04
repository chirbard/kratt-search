// Splits a note into chunks of consecutive lines -- the unit Jev reads.
//
// Ported from kratt-v4 (src/index/chunk.rs), where it was measured on a real
// vault. Daily notes separate thoughts with single newlines, so blank-line
// paragraphs would leave whole days as one chunk. Lines are grouped until the
// next would pass CHUNK_MAX_CHARS. A heading always starts a new chunk; a blank
// line does too once the chunk has CHUNK_MIN_CHARS, so a lone "- [ ] milk" is
// not embedded on its own. A line is only cut if it alone is too long.
export const CHUNK_MAX_CHARS = 500;
const CHUNK_MIN_CHARS = 100;

export interface Chunk {
	text: string;
	// 0-based line where the chunk starts, so a result can open at that spot.
	line: number;
}

export function splitNote(body: string): Chunk[] {
	const chunks: Chunk[] = [];
	const lines = body.split(/\r?\n/);
	let current = "";
	let start = 0;
	for (let index = 0; index < lines.length; index++) {
		const trimmed = lines[index].trim();
		if (trimmed === "") {
			if (charCount(current) >= CHUNK_MIN_CHARS) {
				flush(chunks, current, start);
				current = "";
			}
			continue;
		}
		const tooLong = charCount(current) + charCount(trimmed) + 1 > CHUNK_MAX_CHARS;
		if (trimmed.startsWith("#") || tooLong) {
			flush(chunks, current, start);
			current = "";
		}
		if (charCount(trimmed) > CHUNK_MAX_CHARS) {
			pushLongLine(chunks, trimmed, index);
			continue;
		}
		if (current === "") {
			start = index;
		} else {
			current += "\n";
		}
		current += trimmed;
	}
	flush(chunks, current, start);
	return chunks;
}

function flush(chunks: Chunk[], text: string, line: number): void {
	if (text.trim() === "") {
		return;
	}
	chunks.push({ text, line });
}

// Cut by code point, so an Estonian letter is never split.
function pushLongLine(chunks: Chunk[], line: string, lineIndex: number): void {
	let piece = "";
	for (const character of line) {
		piece += character;
		if (charCount(piece) >= CHUNK_MAX_CHARS) {
			chunks.push({ text: piece, line: lineIndex });
			piece = "";
		}
	}
	if (piece !== "") {
		chunks.push({ text: piece, line: lineIndex });
	}
}

function charCount(text: string): number {
	let count = 0;
	for (const _ of text) {
		count++;
	}
	return count;
}
