import { Editor, MarkdownView, Plugin } from 'obsidian';

export default class TimeLogsPlugin extends Plugin {

	async onload() {
		// Add the "Add time log" command
		this.addCommand({
			id: 'add-time-log',
			name: 'Add time log',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.addTimeLog(editor);
			}
		});
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
}
