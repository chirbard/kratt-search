import { App, Notice, TFile, normalizePath } from "obsidian";
import { embed, type Client } from "./core/api.ts";
import { addVectors, chunkCount, chunksOf, deserialize, emptyIndex, missingHashes, serialize, type Index } from "./core/store.ts";
import { folderList, type Settings } from "./settings.ts";

const EMBED_BATCH = 128;
const PARALLEL_BATCHES = 4;

// Keeps the chunk index in the plugin's own folder -- never among the notes.
export class Indexer {
	app: App;
	dir: string;
	index: Index;
	busy = false;

	constructor(app: App, dir: string, embedModel: string) {
		this.app = app;
		this.dir = dir;
		this.index = emptyIndex(embedModel);
	}

	async load(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const metaPath = normalizePath(`${this.dir}/index.json`);
		const binPath = normalizePath(`${this.dir}/index.bin`);
		if (!(await adapter.exists(metaPath)) || !(await adapter.exists(binPath))) {
			return;
		}
		this.index = deserialize(await adapter.read(metaPath), await adapter.readBinary(binPath));
	}

	private async save(): Promise<void> {
		const saved = serialize(this.index);
		await this.app.vault.adapter.write(normalizePath(`${this.dir}/index.json`), saved.meta);
		await this.app.vault.adapter.writeBinary(normalizePath(`${this.dir}/index.bin`), saved.vectors);
	}

	inScope(path: string, settings: Settings): boolean {
		if (!path.endsWith(".md")) {
			return false;
		}
		for (const folder of folderList(settings.excludeFolders)) {
			if (path === folder || path.startsWith(`${folder}/`)) {
				return false;
			}
		}
		const include = folderList(settings.includeFolders);
		if (include.length === 0) {
			return true;
		}
		for (const folder of include) {
			if (path.startsWith(`${folder}/`)) {
				return true;
			}
		}
		return false;
	}

	// Re-chunks notes whose mtime changed, drops deleted ones, embeds only new
	// chunks. `fresh` starts from nothing -- after a model change.
	async update(client: Client, settings: Settings, fresh: boolean): Promise<string> {
		if (this.busy) {
			return "Index update already running.";
		}
		this.busy = true;
		try {
			return await this.updateLocked(client, settings, fresh);
		} finally {
			this.busy = false;
		}
	}

	private async updateLocked(client: Client, settings: Settings, fresh: boolean): Promise<string> {
		if (fresh || this.index.embedModel !== settings.embedModel) {
			this.index = emptyIndex(settings.embedModel);
		}
		const changed = await this.syncFiles(settings);
		const missing = missingHashes(this.index);
		if (changed === 0 && missing.size === 0) {
			return "Index is up to date.";
		}
		const notice = new Notice(`kratt-search: embedding ${missing.size} chunks…`, 0);
		const cost = await this.embedMissing(client, missing, notice);
		await this.save();
		notice.hide();
		return `Indexed ${Object.keys(this.index.files).length} notes, ${chunkCount(this.index)} chunks ($${cost.toFixed(4)}).`;
	}

	private async syncFiles(settings: Settings): Promise<number> {
		const seen = new Set<string>();
		let changed = 0;
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!this.inScope(file.path, settings)) {
				continue;
			}
			seen.add(file.path);
			const known = this.index.files[file.path];
			if (known !== undefined && known.mtime === file.stat.mtime) {
				continue;
			}
			await this.reindexFile(file);
			changed++;
		}
		for (const path of Object.keys(this.index.files)) {
			if (!seen.has(path)) {
				delete this.index.files[path];
				changed++;
			}
		}
		return changed;
	}

	private async reindexFile(file: TFile): Promise<void> {
		const body = (await this.app.vault.cachedRead(file)).normalize("NFC");
		this.index.files[file.path] = { mtime: file.stat.mtime, chunks: await chunksOf(file.path, body) };
	}

	private async embedMissing(client: Client, missing: Map<string, string>, notice: Notice): Promise<number> {
		const hashes = Array.from(missing.keys());
		let cost = 0;
		let done = 0;
		for (let start = 0; start < hashes.length; start += EMBED_BATCH * PARALLEL_BATCHES) {
			const requests: Promise<{ hashes: string[]; vectors: number[][]; cost: number }>[] = [];
			for (let batch = start; batch < Math.min(start + EMBED_BATCH * PARALLEL_BATCHES, hashes.length); batch += EMBED_BATCH) {
				requests.push(embedBatch(client, hashes.slice(batch, batch + EMBED_BATCH), missing));
			}
			for (const result of await Promise.all(requests)) {
				this.index = addVectors(this.index, result.hashes, result.vectors);
				cost += result.cost;
				done += result.hashes.length;
			}
			notice.setMessage(`kratt-search: embedded ${done} / ${hashes.length} chunks`);
		}
		if (hashes.length === 0) {
			this.index = addVectors(this.index, [], []);
		}
		return cost;
	}
}

async function embedBatch(client: Client, hashes: string[], missing: Map<string, string>) {
	const inputs: string[] = [];
	for (const hash of hashes) {
		inputs.push(missing.get(hash) ?? "");
	}
	const result = await embed(client, inputs);
	return { hashes, vectors: result.value, cost: result.cost };
}
