import { test } from "node:test";
import assert from "node:assert/strict";
import { CHUNK_MAX_CHARS, splitNote } from "../src/core/chunk.ts";

test("single-newline lines group up to the maximum", () => {
	const body = `${"a".repeat(300)}\n${"b".repeat(150)}\n${"c".repeat(300)}`;
	const chunks = splitNote(body);
	assert.equal(chunks.length, 2);
	assert.ok(chunks[1].text.startsWith("c"));
	assert.equal(chunks[1].line, 2);
});

test("a heading starts a new chunk and keeps its line", () => {
	const chunks = splitNote("intro\n# Auto\nAuto otsustas, et ta on nüüd kolme silindriline");
	assert.equal(chunks.length, 2);
	assert.equal(chunks[1].line, 1);
	assert.ok(chunks[1].text.includes("kolme silindriline"));
});

test("a blank line splits only after the minimum", () => {
	assert.equal(splitNote("- [ ] piim\n\n- [ ] leib").length, 1);
	assert.equal(splitNote(`${"a".repeat(100)}\n\nnext`).length, 2);
});

test("an overlong line is cut by character, not byte", () => {
	const chunks = splitNote("õ".repeat(CHUNK_MAX_CHARS * 2 + 10));
	assert.equal(chunks.length, 3);
	assert.equal([...chunks[0].text].length, CHUNK_MAX_CHARS);
});

test("blank notes give no chunks", () => {
	assert.deepEqual(splitNote("\n  \n"), []);
});
