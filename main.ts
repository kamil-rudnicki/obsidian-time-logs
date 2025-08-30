import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TAbstractFile, TFile } from 'obsidian';
import * as fs from 'fs';
import * as nodePath from 'path';

interface TimeLogsSettings {
	csvExportPath: string; // vault-relative path, empty → default 'time-logs.csv'
	autoLogOnTaskDone: boolean;
}

const DEFAULT_SETTINGS: TimeLogsSettings = {
	csvExportPath: '',
	autoLogOnTaskDone: true
};

export default class TimeLogsPlugin extends Plugin {
	settings: TimeLogsSettings;
	private previousContentByPath: Map<string, string> = new Map();
	private programmaticUpdatePaths: Set<string> = new Set();

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

		// Initialize content cache only when auto-log is enabled
		if (this.settings.autoLogOnTaskDone) {
			await this.initializeFileContentCache();
		}
		// Register listener for auto time-log on task completion
		this.registerEvent(this.app.vault.on('modify', async (file) => {
			if (!(file instanceof TFile) || file.extension !== 'md') return;
			// If disabled, avoid reading file or touching caches to save CPU/memory
			if (!this.settings.autoLogOnTaskDone) return;
			if (this.programmaticUpdatePaths.has(file.path)) return;
			const newContent = await this.app.vault.read(file);
			const prevContent = this.previousContentByPath.get(file.path);
			// Keep cache updated while enabled
			if (prevContent === undefined) {
				this.previousContentByPath.set(file.path, newContent);
				return;
			}
			const maybeUpdated = this.addTimeLogForDoneTasks(prevContent, newContent);
			if (maybeUpdated !== newContent) {
				try {
					this.programmaticUpdatePaths.add(file.path);
					await this.app.vault.modify(file, maybeUpdated);
					this.previousContentByPath.set(file.path, maybeUpdated);
				} finally {
					this.programmaticUpdatePaths.delete(file.path);
				}
			} else {
				this.previousContentByPath.set(file.path, newContent);
			}
		}));
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
			// Insert new time-logs entry before existing inline dataviews if present, otherwise at the end
			const timeLogEntry = `[time-logs:: ${currentTime}; ]`;
			const dvIndex = this.findFirstInlineDataviewIndex(currentLine);
			let newLine: string;
			if (dvIndex !== -1) {
				newLine = this.insertBeforeInlineDataview(currentLine, timeLogEntry);
			} else {
				// Add space if the line doesn't end with whitespace
				const separator = currentLine.length > 0 && !/\s$/.test(currentLine) ? ' ' : '';
				newLine = currentLine + separator + timeLogEntry;
			}
			editor.setLine(cursor.line, newLine);
		}
	}

	private async initializeFileContentCache(): Promise<void> {
		for (const file of this.app.vault.getMarkdownFiles()) {
			try {
				const content = await this.app.vault.read(file);
				this.previousContentByPath.set(file.path, content);
			} catch (_e) {
				// ignore
			}
		}
	}

	private addTimeLogForDoneTasks(previousContent: string, newContent: string): string {
		const prevLines = previousContent.split(/\r?\n/);
		const currLines = newContent.split(/\r?\n/);
		const minLen = Math.min(prevLines.length, currLines.length);
		let changed = false;
		for (let i = 0; i < minLen; i++) {
			const before = prevLines[i];
			const after = currLines[i];
			if (before === after) continue;
			if (this.isUncheckedTaskLine(before) && this.isCheckedTaskLine(after) && !this.containsTimeLogs(after)) {
				currLines[i] = this.appendTimeLogToLine(after, this.getCurrentFormattedTime());
				changed = true;
			}
		}
		return changed ? currLines.join('\n') : newContent;
	}

	private isUncheckedTaskLine(line: string): boolean {
		return /^\s*-\s\[\s\]\s/.test(line);
	}

	private isCheckedTaskLine(line: string): boolean {
		return /^\s*-\s\[\s*[xX]\s*\]\s/.test(line);
	}

	private containsTimeLogs(line: string): boolean {
		return /\[time-logs::(.*?)\]/.test(line);
	}

	private appendTimeLogToLine(line: string, currentTime: string): string {
		const timeLogsRegex = /\[time-logs::(.*?)\]/;
		if (timeLogsRegex.test(line)) {
			return line.replace(timeLogsRegex, (_m, inner) => {
				const existingLogs = String(inner).trim();
				const newLogs = existingLogs ? `${existingLogs} ${currentTime};` : ` ${currentTime};`;
				return `[time-logs::${newLogs} ]`;
			});
		} else {
			const dvIndex = this.findFirstInlineDataviewIndex(line);
			const timeLogEntry = `[time-logs:: ${currentTime}; ]`;
			if (dvIndex !== -1) {
				return this.insertBeforeInlineDataview(line, timeLogEntry);
			}
			const separator = line.length > 0 && !/\s$/.test(line) ? ' ' : '';
			return line + separator + timeLogEntry;
		}
	}

	private findFirstInlineDataviewIndex(line: string): number {
		// Matches inline dataview fields like [key:: value] with optional spaces around '::'
		const matchIndex = line.search(/\[[^\[\]\n]*\s*::\s*[^\[\]\n]*\]/);
		return matchIndex;
	}

	private insertBeforeInlineDataview(line: string, insertion: string): string {
		const idx = this.findFirstInlineDataviewIndex(line);
		if (idx === -1) {
			const separator = line.length > 0 && !/\s$/.test(line) ? ' ' : '';
			return line + separator + insertion;
		}
		const before = line.slice(0, idx);
		const after = line.slice(idx);
		const sepBefore = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
		const sepAfter = after.length > 0 && !/^\s/.test(after) ? ' ' : '';
		return before + sepBefore + insertion + sepAfter + after;
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

	private async collectTimeLogRows(): Promise<Array<{ task: string; from: string; to: string; file: string; line: number }>> {
		const markdownFiles = this.app.vault.getMarkdownFiles();
		const rows: Array<{ task: string; from: string; to: string; file: string; line: number }> = [];
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
					const { from, to } = this.parseFromTo(timeLog);
					rows.push({ task: taskText, from, to, file: file.path, line: i + 1 });
				}
			}
		}
		rows.sort((a, b) => {
			const aKey = a.from || a.to || '';
			const bKey = b.from || b.to || '';
			return aKey.localeCompare(bKey);
		});
		return rows;
	}

	private normalizeTaskText(text: string): string {
		let normalized = text;
		if (normalized.startsWith('- [ ]')) normalized = normalized.slice(5).trim();
		if (normalized.startsWith('- [x]') || normalized.startsWith('- [X]')) normalized = normalized.slice(5).trim();
		return normalized;
	}

	private createCsvContent(rows: Array<{ task: string; from: string; to: string; file: string; line: number }>): string {
		const header = ['Task', 'From', 'To', 'File', 'Line'];
		const csvRows = [header, ...rows.map((r) => [r.task, r.from, r.to, r.file, String(r.line)])];
		return csvRows
			.map((cols) => cols.map((c) => this.csvEscape(c)).join(','))
			.join('\n');
	}

	private parseFromTo(timeLog: string): { from: string; to: string } {
		// Normalize whitespace
		const trimmed = timeLog.trim();
		const dateMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
		if (!dateMatch) return { from: '', to: '' };
		const date = dateMatch[1];
		const rest = trimmed.slice(date.length).trim();

		// Patterns:
		// 1) "-HH:MM[:SS]" → To only
		const toOnly = rest.match(/^-(\d{2}:\d{2}(?::\d{2})?)$/);
		if (toOnly) return { from: '', to: `${date} ${this.ensureSeconds(toOnly[1])}` };

		// 2) "HH:MM[:SS]-" → From only
		const fromOnly = rest.match(/^(\d{2}:\d{2}(?::\d{2})?)-$/);
		if (fromOnly) return { from: `${date} ${this.ensureSeconds(fromOnly[1])}`, to: '' };

		// 3) "HH:MM[:SS]-HH:MM[:SS]" → From and To
		const range = rest.match(/^(\d{2}:\d{2}(?::\d{2})?)-(\d{2}:\d{2}(?::\d{2})?)$/);
		if (range) {
			return {
				from: `${date} ${this.ensureSeconds(range[1])}`,
				to: `${date} ${this.ensureSeconds(range[2])}`
			};
		}

		// Fallback: if rest is a single time treat it as To (matches plugin's " -HH:MM")
		const single = rest.match(/^(\d{2}:\d{2}(?::\d{2})?)$/);
		if (single) return { from: '', to: `${date} ${this.ensureSeconds(single[1])}` };

		return { from: '', to: '' };
	}

	private ensureSeconds(time: string): string {
		return time.length === 5 ? `${time}:00` : time;
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

		new Setting(containerEl)
			.setName('Auto-log on task completion')
			.setDesc('When a task is checked as done, append a time log automatically.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoLogOnTaskDone)
					.onChange(async (value) => {
						this.plugin.settings.autoLogOnTaskDone = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
