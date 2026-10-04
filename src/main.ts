import { Notice, Plugin, TFile, requestUrl, type TAbstractFile } from "obsidian";
import type { Client, Post } from "./core/api.ts";
import { chunkCount } from "./core/store.ts";
import { Indexer } from "./indexer.ts";
import { SearchModal } from "./modal.ts";
import { DEFAULTS, SettingsTab, type Settings } from "./settings.ts";

// Edits are batched: a note being typed in changes every second.
const UPDATE_DELAY_MS = 60_000;

// Obsidian's requestUrl: no CORS, and it works on mobile.
const obsidianPost: Post = async (url, body, apiKey) => {
	const response = await requestUrl({
		url,
		method: "POST",
		headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
		body: JSON.stringify(body),
		throw: false,
	});
	if (response.status >= 400) {
		throw new Error(`HTTP ${response.status}: ${response.text.slice(0, 300)}`);
	}
	return response.json;
};

export default class KrattSearch extends Plugin {
	settings: Settings = { ...DEFAULTS };
	indexer!: Indexer;
	private pending: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.indexer = new Indexer(this.app, this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`, this.settings.embedModel);
		this.addSettingTab(new SettingsTab(this.app, this));
		this.addCommand({
			id: "open-search",
			name: "Find a note",
			hotkeys: [{ modifiers: ["Mod", "Shift"], key: "k" }],
			callback: () => this.openSearch(),
		});
		this.addCommand({ id: "update-index", name: "Update index", callback: () => void this.updateIndex(false) });
		this.addCommand({ id: "rebuild-index", name: "Rebuild index", callback: () => void this.rebuildIndex() });
		this.addRibbonIcon("search", "Find a note (kratt)", () => this.openSearch());
		this.app.workspace.onLayoutReady(() => void this.start());
	}

	private async start(): Promise<void> {
		await this.indexer.load();
		this.registerEvent(this.app.vault.on("modify", (file) => this.noteChanged(file)));
		this.registerEvent(this.app.vault.on("create", (file) => this.noteChanged(file)));
		this.registerEvent(this.app.vault.on("delete", (file) => this.noteChanged(file)));
		this.registerEvent(this.app.vault.on("rename", (file) => this.noteChanged(file)));
		if (this.settings.updateIndexHere && this.settings.apiKey !== "") {
			await this.updateIndex(true);
		}
	}

	private noteChanged(file: TAbstractFile): void {
		if (!this.settings.updateIndexHere || !(file instanceof TFile) || file.extension !== "md") {
			return;
		}
		if (this.pending !== null) {
			window.clearTimeout(this.pending);
		}
		this.pending = window.setTimeout(() => {
			this.pending = null;
			void this.updateIndex(true);
		}, UPDATE_DELAY_MS);
	}

	private openSearch(): void {
		if (this.settings.apiKey === "") {
			new Notice("kratt-search: add your OpenRouter API key in the plugin settings.");
			return;
		}
		if (chunkCount(this.indexer.index) === 0) {
			new Notice("kratt-search: no index yet. Run \"Update index\" (about a cent for a large vault).");
			return;
		}
		new SearchModal(this.app, this.client(), this.indexer.index).open();
	}

	async updateIndex(quiet: boolean): Promise<void> {
		if (this.settings.apiKey === "") {
			new Notice("kratt-search: add your OpenRouter API key first.");
			return;
		}
		try {
			const message = await this.indexer.update(this.client(), this.settings, false);
			if (!quiet || !message.startsWith("Index is up to date")) {
				new Notice(`kratt-search: ${message}`);
			}
		} catch (error) {
			new Notice(`kratt-search: indexing failed: ${String(error)}`);
		}
	}

	async rebuildIndex(): Promise<void> {
		try {
			new Notice(`kratt-search: ${await this.indexer.update(this.client(), this.settings, true)}`);
		} catch (error) {
			new Notice(`kratt-search: rebuild failed: ${String(error)}`);
		}
	}

	indexSummary(): string {
		const index = this.indexer.index;
		return `${Object.keys(index.files).length} notes, ${chunkCount(index)} chunks, built with ${index.embedModel}.`;
	}

	private client(): Client {
		return { post: obsidianPost, apiKey: this.settings.apiKey, embedModel: this.settings.embedModel, jevModel: this.settings.jevModel };
	}

	async loadSettings(): Promise<void> {
		this.settings = { ...DEFAULTS, ...(await this.loadData()) };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
