import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TAbstractFile, TFile } from 'obsidian';
import * as fs from 'fs';
import * as nodePath from 'path';

interface TimeLogsSettings {
	csvExportPath: string; // vault-relative path, empty → default 'time-logs.csv'
}

const DEFAULT_SETTINGS: TimeLogsSettings = {
	csvExportPath: ''
};

export default class TimeLogsPlugin extends Plugin {
	settings: TimeLogsSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new TimeLogsSettingTab(this.app, this));
		// Add the "Add time log" command
		this.addCommand({
			id: 'add-time-log',
			name: 'Add time log',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.addTimeLog(editor);
			}
		});

		// Add the "Export time logs to CSV" command
		this.addCommand({
			id: 'export-time-logs-csv',
			name: 'Export time logs to CSV',
			callback: async () => {
				try {
					const rows = await this.collectTimeLogRows();
					const csv = this.createCsvContent(rows);
					const filePath = await this.writeCsvToVault(csv);
					new Notice(`Time logs exported (${rows.length} rows) → ${filePath}`);
				} catch (error) {
					new Notice('Failed to export time logs');
					console.error(error);
				}
			}
		});
	}
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	onunload() {
		// Clean up when plugin is disabled
	}

	private addTimeLog(editor: Editor) {
		const currentTime = this.getCurrentFormattedTime();
		const cursor = editor.getCursor();
		const currentLine = editor.getLine(cursor.line);
		
		// Check if the current line already contains a time-logs entry
		const timeLogsRegex = /\[time-logs::(.*?)\]/;
		const match = currentLine.match(timeLogsRegex);
		
		if (match) {
			// Append to existing time-logs entry
			const existingLogs = match[1].trim();
			const newLogs = existingLogs ? `${existingLogs} ${currentTime};` : ` ${currentTime};`;
			const newLine = currentLine.replace(timeLogsRegex, `[time-logs::${newLogs} ]`);
			
			// Replace the entire line
			editor.setLine(cursor.line, newLine);
		} else {
			// Insert new time-logs entry at the end of the current line
			const timeLogEntry = `[time-logs:: ${currentTime}; ]`;
			// Add space if the line doesn't end with whitespace
			const separator = currentLine.length > 0 && !currentLine.endsWith(' ') ? ' ' : '';
			const newLine = currentLine + separator + timeLogEntry;
			editor.setLine(cursor.line, newLine);
		}
	}

	private getCurrentFormattedTime(): string {
		const now = new Date();
		const year = now.getFullYear();
		const month = String(now.getMonth() + 1).padStart(2, '0');
		const day = String(now.getDate()).padStart(2, '0');
		const hours = String(now.getHours()).padStart(2, '0');
		const minutes = String(now.getMinutes()).padStart(2, '0');
		
		return `${year}-${month}-${day} -${hours}:${minutes}`;
	}

	private async collectTimeLogRows(): Promise<Array<{ task: string; timeLog: string; file: string; line: number }>> {
		const markdownFiles = this.app.vault.getMarkdownFiles();
		const rows: Array<{ task: string; timeLog: string; file: string; line: number }> = [];
		const timeLogsRegex = /\[time-logs::(.*?)\]/;
		const dateRegex = /\b\d{4}-\d{2}-\d{2}\b/;

		for (const file of markdownFiles) {
			const content = await this.app.vault.read(file);
			const lines = content.split(/\r?\n/);
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const match = line.match(timeLogsRegex);
				if (!match) continue;
				const timeLogsRaw = match[1].trim();
				if (!timeLogsRaw) continue;
				const taskTextRaw = line.replace(timeLogsRegex, '').trim();
				const taskText = this.normalizeTaskText(taskTextRaw);
				const timeLogs = timeLogsRaw
					.split(';')
					.map((s) => s.trim())
					.filter((s) => s.length > 0);
				for (const timeLog of timeLogs) {
					if (!dateRegex.test(timeLog)) continue;
					rows.push({ task: taskText, timeLog, file: file.path, line: i + 1 });
				}
			}
		}
		rows.sort((a, b) => a.timeLog.localeCompare(b.timeLog));
		return rows;
	}

	private normalizeTaskText(text: string): string {
		let normalized = text;
		if (normalized.startsWith('- [ ]')) normalized = normalized.slice(5).trim();
		if (normalized.startsWith('- [x]') || normalized.startsWith('- [X]')) normalized = normalized.slice(5).trim();
		return normalized;
	}

	private createCsvContent(rows: Array<{ task: string; timeLog: string; file: string; line: number }>): string {
		const header = ['Task', 'Time Log', 'File', 'Line'];
		const csvRows = [header, ...rows.map((r) => [r.task, r.timeLog, r.file, String(r.line)])];
		return csvRows
			.map((cols) => cols.map((c) => this.csvEscape(c)).join(','))
			.join('\n');
	}

	private csvEscape(value: string): string {
		const mustQuote = /[",\n]/.test(value);
		let escaped = value.replace(/"/g, '""');
		if (mustQuote) escaped = `"${escaped}"`;
		return escaped;
	}

	private async writeCsvToVault(csvContent: string): Promise<string> {
		const desiredPath = (this.settings?.csvExportPath || '').trim();
		const filePath = desiredPath.length > 0 ? desiredPath : 'time-logs.csv';

		if (this.isAbsoluteOsPath(filePath)) {
			await fs.promises.mkdir(nodePath.dirname(filePath), { recursive: true });
			await fs.promises.writeFile(filePath, csvContent, 'utf8');
			return filePath;
		}

		await this.ensureParentFolderExists(filePath);
		const existing = this.app.vault.getAbstractFileByPath(filePath);
		if (existing && existing instanceof TFile) {
			await this.app.vault.modify(existing, csvContent);
			return filePath;
		}
		await this.app.vault.create(filePath, csvContent);
		return filePath;
	}

	private isAbsoluteOsPath(p: string): boolean {
		try {
			return nodePath.isAbsolute(p);
		} catch (_e) {
			return false;
		}
	}

	private async ensureParentFolderExists(filePath: string): Promise<void> {
		const lastSlash = filePath.lastIndexOf('/');
		if (lastSlash === -1) return; // root
		const folder = filePath.substring(0, lastSlash);
		if (!folder) return;
		const existing: TAbstractFile | null = this.app.vault.getAbstractFileByPath(folder);
		if (!existing) {
			try {
				await this.app.vault.createFolder(folder);
			} catch (_e) {
				// ignore if race or already created
			}
		}
	}
}

class TimeLogsSettingTab extends PluginSettingTab {
	plugin: TimeLogsPlugin;

	constructor(app: App, plugin: TimeLogsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Time Logs Settings' });

		new Setting(containerEl)
			.setName('CSV export path')
			.setDesc("Vault-relative path for exported CSV. Leave empty to use 'time-logs.csv' in root.")
			.addText((text) =>
				text
					.setPlaceholder('e.g. exports/time-logs.csv')
					.setValue(this.plugin.settings.csvExportPath)
					.onChange(async (value) => {
						this.plugin.settings.csvExportPath = value.trim();
						await this.plugin.saveSettings();
					})
			);
	}
}
