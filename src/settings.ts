import { App, Platform, PluginSettingTab, Setting } from "obsidian";
import type KrattSearch from "./main.ts";

export interface Settings {
	apiKey: string;
	embedModel: string;
	jevModel: string;
	// Comma-separated folder prefixes; empty means the whole vault.
	includeFolders: string;
	excludeFolders: string;
	// Off on phones by default: if both devices write the synced index, the
	// sync tool makes conflict copies. Keep it current from the computer.
	updateIndexHere: boolean;
}

export const DEFAULTS: Settings = {
	apiKey: "",
	embedModel: "perplexity/pplx-embed-v1-0.6b",
	jevModel: "typesafe/jev-1.13",
	includeFolders: "",
	excludeFolders: "Templates",
	updateIndexHere: !Platform.isMobile,
};

export function folderList(value: string): string[] {
	const folders: string[] = [];
	for (const part of value.split(",")) {
		const folder = part.trim().replace(/\/+$/, "");
		if (folder !== "") {
			folders.push(folder);
		}
	}
	return folders;
}

export class SettingsTab extends PluginSettingTab {
	plugin: KrattSearch;

	constructor(app: App, plugin: KrattSearch) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		this.textSetting("OpenRouter API key", "Used for embeddings and Jev. Stored in this plugin's data.json.", "apiKey", true);
		this.textSetting("Folders to search", "Comma-separated, e.g. notes. Empty searches the whole vault.", "includeFolders", false);
		this.textSetting("Folders to skip", "Comma-separated.", "excludeFolders", false);
		this.textSetting("Embedding model", "Changing it means rebuilding the index.", "embedModel", false);
		this.textSetting("Jev model", "Pinned on purpose: results were measured on this version.", "jevModel", false);
		new Setting(containerEl)
			.setName("Keep the index up to date on this device")
			.setDesc("Leave off on phones when the index syncs from a computer, so two devices never write it at once.")
			.addToggle((toggle) => toggle.setValue(this.plugin.settings.updateIndexHere).onChange(async (value) => {
				this.plugin.settings.updateIndexHere = value;
				await this.plugin.saveSettings();
			}));
		new Setting(containerEl)
			.setName("Index")
			.setDesc(this.plugin.indexSummary())
			.addButton((button) => button.setButtonText("Rebuild").onClick(async () => {
				await this.plugin.rebuildIndex();
				this.display();
			}));
	}

	private textSetting(name: string, description: string, key: "apiKey" | "includeFolders" | "excludeFolders" | "embedModel" | "jevModel", secret: boolean): void {
		new Setting(this.containerEl).setName(name).setDesc(description).addText((text) => {
			if (secret) {
				text.inputEl.type = "password";
			}
			text.setValue(this.plugin.settings[key]).onChange(async (value) => {
				this.plugin.settings[key] = value.trim();
				await this.plugin.saveSettings();
			});
		});
	}
}
