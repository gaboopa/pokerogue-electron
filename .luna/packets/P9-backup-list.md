# P9 — Backup list window

Depends on P7 (Profiles) and P8 (Copy Diagnostic Report) being merged.

## Goal

**Restore Backup…** currently opens a raw folder picker over timestamped directory names (`chooseAndRestore` in `src/main.mjs`). Replace that first step with a window that lists the active profile's Backups with their date, reason and integrity status, and restores the chosen one through the existing restore flow.

This is presentation only. The restore, rollback and recovery logic does not change.

## Read first

`AGENTS.md`, `CONTEXT.md`, `docs/backup-consistency.md`, `src/main.mjs` (`chooseAndRestore`, `reportRestoreFailure` and the recovery dialog that offers "Choose another Backup"), `src/backup.mjs` (`validateBackup`), `src/backup-coordinator.mjs` (`parseBackupName`), `src/cheat-main.mjs` and `src/cheat-window/` (the window pattern to copy).

## Requirements

### 1. Split `chooseAndRestore`

- Extract everything after the folder is chosen (from `validateBackup(selected)` onward) into a function that takes a Backup path. Behaviour and text stay byte-identical.
- The folder-picker path remains, used by (a) the recovery dialog's "Choose another Backup" button, exactly as today, and (b) the new window's "Choose Folder…" button.
- The **Restore Backup…** menu item opens the new window instead of the picker. Its label is unchanged.

### 2. Listing (main process)

- List directories directly inside the active profile's Backup folder whose names do not start with `.`. Skip symbolic links.
- For each: name, creation time and reason from `parseBackupName` when it matches (reason is `manual`, `update`, `restore` or `cheat`); otherwise reason `unknown` and the time from the manifest's `createdAt` if readable, else blank.
- Newest first.

### 3. Window (`src/backup-window/`, built like `src/cheat-window/`)

- Same `webPreferences`, `setWindowOpenHandler` deny, `will-navigate` prevented, IPC handlers reject any sender other than this window.
- Title `Backups`. A table with columns `Created`, `Reason`, `Integrity`. `Created` is shown in the player's local time. Reasons display as `Manual`, `Before Update`, `Before Restore`, `Before cheat change`, `Unknown`.
- `Integrity` starts as `Checking…`. The renderer asks the main process to verify each row, one at a time, top to bottom; the main process runs `validateBackup` and returns `Verified` or `Failed`, with the error message available as the cell's tooltip. A failed row cannot be restored.
- Buttons: `Restore` (enabled when a verified row is selected), `Choose Folder…`, `Close`. Empty state: `No Backups yet. Use Back Up Saves… to create one.`
- `Restore` closes the window and calls the extracted restore function, which shows the existing "Restart to restore Backup" confirmation. The Backup is validated again there, as today.

### 4. Trust boundary

The renderer only ever sends a Backup **name**. The main process must check that the name is in a fresh listing and resolves to a direct child of the Backup folder before using it. Never accept a path from the renderer.

### 5. Docs

`README.md`, "Saves and backups": update the **Restore Backup** bullet to describe the list (date, reason, integrity check) and mention Choose Folder… for Backups kept elsewhere.

## Tests

- Listing: sorts newest first; maps each operation to its reason; unknown names become `unknown`; dot-directories, files and symlinks are skipped; empty and missing folders return an empty list.
- Name check: rejects names not in the listing, names with path separators, `..`, and absolute paths.
- Menu test: Restore Backup… label unchanged.
- Existing tests pass unmodified, in particular `test/startup-recovery.test.mjs` and `test/backup*.test.mjs`. If one has to change because of the `chooseAndRestore` split, say which and why.

## Out of scope

Deleting, renaming, exporting or annotating Backups. Showing Backup size. Listing other profiles' Backups. Any change to retention, to the Backup format, or to restore, rollback and recovery behaviour.

## Stop conditions

Stop and report if the change needs any edit to `src/backup.mjs`, `src/backup-coordinator.mjs`, `src/backup-worker.mjs` or `src/retention.mjs`, or any change to an existing dialog's text or buttons.
