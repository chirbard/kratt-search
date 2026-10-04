import { App, Modal, TFile } from "obsidian";
import type { Client } from "./core/api.ts";
import { FINALISTS, search, type Candidate, type Outcome } from "./core/search.ts";
import type { Index } from "./core/store.ts";

const SHOWN = 10;
// Head to head is relative -- something always wins. Jev's own yes/no score is
// absolute: when even the best note is below this, say nothing clearly matched.
const NOTHING_MATCHED_BELOW = 0.3;
const SNIPPET_CHARS = 160;

// Searches on Enter, not per keystroke: every search costs money.
export class SearchModal extends Modal {
	client: Client;
	index: Index;
	results: Candidate[] = [];
	selected = 0;
	statusEl!: HTMLElement;
	listEl!: HTMLElement;

	constructor(app: App, client: Client, index: Index) {
		super(app);
		this.client = client;
		this.index = index;
	}

	onOpen(): void {
		this.modalEl.addClass("kratt-search");
		const input = this.contentEl.createEl("input", { type: "text", placeholder: "Describe the note you're looking for, then press Enter" });
		input.addClass("kratt-search-input");
		this.statusEl = this.contentEl.createDiv({ cls: "kratt-search-status" });
		this.listEl = this.contentEl.createDiv({ cls: "kratt-search-results" });
		input.addEventListener("keydown", (event) => this.onKey(event, input));
		input.focus();
	}

	private onKey(event: KeyboardEvent, input: HTMLInputElement): void {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			this.move(event.key === "ArrowDown" ? 1 : -1);
			return;
		}
		if (event.key !== "Enter" || event.isComposing) {
			return;
		}
		event.preventDefault();
		if (this.results.length > 0 && input.dataset.searched === input.value) {
			void this.openResult(this.results[this.selected]);
			return;
		}
		input.dataset.searched = input.value;
		void this.run(input.value.trim());
	}

	private async run(query: string): Promise<void> {
		if (query === "") {
			return;
		}
		this.listEl.empty();
		this.statusEl.setText("Searching…");
		try {
			this.show(await search(this.client, this.index, query, FINALISTS));
		} catch (error) {
			this.statusEl.setText(`Search failed: ${String(error)}`);
		}
	}

	private show(outcome: Outcome): void {
		this.results = outcome.results.slice(0, SHOWN);
		this.selected = 0;
		let status = `${(outcome.millis / 1000).toFixed(1)} s · $${outcome.cost.toFixed(4)}`;
		if (outcome.failures > 0) {
			status += ` · ${outcome.failures} judgements failed`;
		}
		this.statusEl.setText(status);
		if (bestJev(outcome.results) < NOTHING_MATCHED_BELOW) {
			this.listEl.createDiv({ cls: "kratt-search-nothing", text: "Nothing clearly matched. Closest notes:" });
		}
		for (let rank = 0; rank < this.results.length; rank++) {
			this.renderResult(this.results[rank], rank);
		}
		this.highlight();
	}

	private renderResult(result: Candidate, rank: number): void {
		const row = this.listEl.createDiv({ cls: "kratt-search-result" });
		row.createDiv({ cls: "kratt-search-title", text: baseName(result.path) });
		row.createDiv({ cls: "kratt-search-path", text: result.path });
		row.createDiv({ cls: "kratt-search-snippet", text: snippet(result.text) });
		row.addEventListener("click", () => void this.openResult(result));
		row.addEventListener("mouseenter", () => {
			this.selected = rank;
			this.highlight();
		});
	}

	private move(step: number): void {
		if (this.results.length === 0) {
			return;
		}
		this.selected = (this.selected + step + this.results.length) % this.results.length;
		this.highlight();
	}

	private highlight(): void {
		const rows = this.listEl.querySelectorAll(".kratt-search-result");
		for (let index = 0; index < rows.length; index++) {
			rows[index].toggleClass("is-selected", index === this.selected);
		}
	}

	// Opens at the chunk's line, so the matching part is on screen.
	private async openResult(result: Candidate): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(result.path);
		if (!(file instanceof TFile)) {
			return;
		}
		this.close();
		await this.app.workspace.getLeaf(false).openFile(file, { eState: { line: result.line } });
	}
}

function bestJev(results: Candidate[]): number {
	let best = 0;
	for (const result of results) {
		if (result.jev !== null && result.jev > best) {
			best = result.jev;
		}
	}
	return best;
}

function baseName(path: string): string {
	const name = path.slice(path.lastIndexOf("/") + 1);
	return name.endsWith(".md") ? name.slice(0, -3) : name;
}

function snippet(text: string): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > SNIPPET_CHARS ? `${flat.slice(0, SNIPPET_CHARS)}…` : flat;
}
