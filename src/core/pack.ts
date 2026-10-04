// Greedy, in order: contiguous [start, end) ranges whose sizes stay under the
// budget. A single item over budget still gets a range of its own.
//
// Jev charges ~260 input tokens per request and ~56 per question, so packing
// questions into few requests saves money; sending the requests at once saves
// time. 50k characters is ~22k tokens of Estonian -- inside Jev's 32k window
// on OpenRouter with margin.
export const BATCH_CHAR_BUDGET = 50_000;

export function packBySize(sizes: number[], budget: number): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	let start = 0;
	let used = 0;
	for (let index = 0; index < sizes.length; index++) {
		if (index > start && used + sizes[index] > budget) {
			ranges.push([start, index]);
			start = index;
			used = 0;
		}
		used += sizes[index];
	}
	if (start < sizes.length) {
		ranges.push([start, sizes.length]);
	}
	return ranges;
}
