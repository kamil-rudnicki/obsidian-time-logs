# ⏱️ Time Logs for Obsidian

Track when you finish tasks with one shortcut. Your time, in your notes.

### ✨ Why Time Logs
- ⚡️ **Fast**: Append a timestamp to the current line with a single command.
- 🧩 **Flexible**: Works with plain text or checkboxes. No new workflow to learn.
- 📦 **Portable**: Export a clean CSV across your entire vault in seconds.
- 🔒 **Private**: Everything stays local in your Obsidian vault.

### 🧭 How it works
- ▶️ Run the command: **Add time log** (assign a hotkey in Obsidian → Settings → Hotkeys).
- The plugin appends a marker like this to the end of the line:
```text
[time-logs:: 2025-08-28 -14:32; ]
```
- 📤 Later, run: **Export time logs to CSV** to generate a CSV you can analyze anywhere (Dataview, Excel, DuckDB, ClickHouse).

### ⌨️ Commands
- 🕒 **Add time log**: Append a timestamp marker to the current line.
- 📄 **Export time logs to CSV**: Scan your vault and export a `Task, From, To, File, Line` CSV.

### ⚙️ Settings
- 📁 **CSV export path**: Choose where the CSV is written (vault‑relative). Empty = `time-logs.csv` at vault root.

### 📊 Sample Dataview

Sample `dataviewjs` you can use to insert list of time entries into your note:

```js
const MAX_TASK_LENGTH = 50;
const START_DATE = "2025-01-01"; // Start date (inclusive)
const END_DATE = "2030-12-31";   // End date (inclusive)

const tasks = dv.pages()
    .file.tasks
    .where(t => t.text.includes("time-logs::"));

const rows = [];
tasks.forEach(t => {
    const match = t.text.match(/\[time-logs::\s*([^\]]+)\]/);
    if (match) {
        const timeLogString = match[1].trim();
        let taskText = t.text.replace(/\[time-logs::[^\]]+\]/, "").trim();
        
        if (taskText.length > MAX_TASK_LENGTH) {
            taskText = taskText.substring(0, MAX_TASK_LENGTH) + "...";
        }
        
        // Split time-logs by semicolon and create a row for each
        const timeLogs = timeLogString.split(';')
            .map(log => log.trim())
            .filter(log => log.length > 0); // Remove empty entries
        
        timeLogs.forEach(timeLog => {
            // Extract date from time-log (assuming format: YYYY-MM-DD -HH:MM)
            const dateMatch = timeLog.match(/(\d{4}-\d{2}-\d{2})/);
            if (dateMatch) {
                const logDate = dateMatch[1];
                if (logDate >= START_DATE && logDate <= END_DATE) {
                    rows.push([taskText, timeLog, t.link]);
                }
            }
        });
    }
});
rows.sort((a, b) => a[1].localeCompare(b[1]));
dv.table(["Task", "Time Log", "File"], rows);
```

### 🏷️ Keywords
Timesheets, time tracker, timer, clock in/out, time logs, time tracking.

### 📝 License
MIT © Kamil Rudnicki · 🔗 Learn more: https://kamilrudnicki.com

