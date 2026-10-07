# P8 — Copy Diagnostic Report

Depends on P7 (Profiles) being merged.

You are Luna. The "Luna" section of `AGENTS.md` is addressed to the orchestrator that hands work to you. Do not run the `luna` CLI, create branches or delegate; implement this packet directly in this worktree.

## Goal

One menu item that copies a plain-text, privacy-safe description of the installation to the clipboard, so a bug report can include it instead of a back-and-forth about versions.

## Read first

`AGENTS.md`, `CONTEXT.md`, `src/main.mjs` (`paths()`, `createMenu()`), `src/menu.mjs`, `src/backup-coordinator.mjs` (`parseBackupName`), `scripts/build-game.mjs` (writes `revisions.json`), `package.json` (`extraResources` ships it to `resources/revisions.json`).

## Requirements

### 1. `src/diagnostics.mjs` (new, no `electron` import)

A pure function that takes a facts object and returns the report text. Layout:

```text
PokeRogue Offline diagnostic report
Version: 0.1.4 (packaged)
Platform: win32 x64, Windows 10.0.26200
Electron 42.11.10, Chrome <version>, Node <version>
Game revision: <sha>
Assets revision: <sha>
Locales revision: <sha>
Profile: default (2 profiles)
Backups: 7, latest 2026-10-06T21-11-04.123Z (update)
Pending operation: none
```

- `(packaged)` or `(development)`.
- A revision that cannot be read prints `unavailable`.
- `Profile:` prints `default` or `named` — never the profile's name — and the total count including the default.
- `Backups:` counts directories in the active profile's Backup folder whose name `parseBackupName` accepts; `latest` is the newest stamp and its operation. With none: `Backups: 0`.
- `Pending operation:` is the current Backup intent's operation and state, or `none`.

### 2. Privacy rule

The report must contain no filesystem path, user name, computer name, profile name, Save data, cheat settings or keybindings. Only the fields above.

### 3. `src/main.mjs` and `src/menu.mjs`

- Add **Copy Diagnostic Report** to the application submenu, directly after **Open Save Folder**.
- The handler gathers the facts, writes the text with Electron's `clipboard.writeText`, then shows an info dialog: title `Diagnostic report copied`, message `The report is on your clipboard. It contains version and revision details only — no Save data or file paths.`
- Read `revisions.json` from `process.resourcesPath` when packaged and from `staging/` in development. A missing or malformed file is not an error.
- Gathering must never throw to the user: any fact that fails prints `unavailable`.

### 4. Docs

`README.md`, Troubleshooting: one short entry telling people to paste the diagnostic report when opening an issue.

## Tests

- `test/diagnostics.test.mjs`: full report from complete facts matches expected text exactly; missing revisions print `unavailable`; zero Backups; named profile prints `named` and not its name; a facts object containing a path or profile name in unused fields does not leak it.
- Menu template test: the item exists and sits after Open Save Folder.
- Existing tests pass unmodified.

## Out of scope

A diagnostics window. Health checks or pass/fail marks. Verifying Backups. Uploading or sending the report anywhere.

## Stop conditions

Stop and report if producing the report would need a network request, or any change to Backup, Restore or Update code.
