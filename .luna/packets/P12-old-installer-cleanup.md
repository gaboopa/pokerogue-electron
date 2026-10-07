# P12 — Offer to remove old installers from Downloads

Depends on P11 (rename) being merged.

## Goal

After a player updates, older installers they downloaded by hand are still sitting in their Downloads folder. On the first launch of each new version, if such files exist, ask once whether to move them to the Recycle Bin (Trash on macOS). Nothing outside the app's own folders is touched without a yes.

## Read first

`AGENTS.md`, `CONTEXT.md`, `src/retention.mjs` (existing cleanup of the app's own `Updates` folder, and the installer-name pattern), `src/updater.mjs` (`compareVersions`), `src/main.mjs` (`paths()`, startup sequence in `app.whenReady()`, `showMessageBox`), `src/cheats.mjs` (`writeCheatDocument`, the atomic-write pattern).

## Requirements

### 1. Finding candidates (pure, in `src/retention.mjs`)

A function that takes a list of file names and the current version and returns the names to offer:

- The name is an artifact name for either platform (`PokeRogue-Offline-<version>-windows-x64.exe` or `PokeRogue-Offline-<version>-macos-arm64.dmg`), optionally with a browser duplicate suffix before the extension, such as `PokeRogue-Offline-0.1.4-windows-x64 (1).exe`.
- Its version is less than or equal to the current version. Newer versions are never offered.
- Reuse the existing installer pattern and `compareVersions`; do not write a second version parser.

### 2. Scanning Downloads (main process)

- Folder: `app.getPath("downloads")`, top level only, never recursive.
- Only regular files: skip directories and symbolic links (`lstat`).
- A missing or unreadable Downloads folder means nothing to offer. It is never an error shown to the player.

### 3. Asking once per version

- State file `<root>/installer-cleanup.json` (`root` from `paths()`, shared across profiles): `{ "schemaVersion": 1, "askedForVersion": "<version>" }`, written atomically.
- At startup, after the game window is created, and only when startup was not blocked by recovery and no Backup intent is pending: if `askedForVersion` differs from the running version, scan.
  - Nothing found: record the version, show nothing.
  - Something found: show the dialog below.
    - **Keep**: record the version.
    - **Move**: call `shell.trashItem` for each file. If all succeed, record the version. If any fail, do not record it (so the offer returns next launch) and show the failure dialog.
- An unreadable or malformed state file is treated as "not asked".
- Never delete permanently. `shell.trashItem` only.
- The scan must not delay the game window appearing.

### 4. Text (exact)

- Dialog: type question, title `Remove old installers?`, message `Move <n> installer you no longer need to the Recycle Bin?` (plural `installers` when n > 1; `Trash` instead of `Recycle Bin` on macOS), detail: the file names one per line, then a blank line, then `They are in your Downloads folder. This version is already installed.` Buttons `Move to Recycle Bin` (or `Move to Trash`), `Keep`. Default and cancel on `Keep`.
- Failure: type warning, title `Some installers were not removed`, message `<n> file could not be moved. You can delete it yourself from your Downloads folder.` (plural `files` / `them` when n > 1).
- List at most 10 names in the detail; if there are more, add a final line `and <k> more`.

### 5. Docs

- `README.md`, the Troubleshooting entry about an older installer in the Downloads folder: rewrite to describe the offer, and that declining means the app will not ask again until the next version.
- `README.md`, "Privacy and security": one bullet — the app looks only at file names in your Downloads folder that match its own installer names, and moves nothing without asking.

## Tests

- Candidate function: accepts both artifact types and duplicate suffixes; rejects newer versions, near-miss names (wrong prefix, extra extension, `.partial`), and names with path separators.
- State logic with a temp directory and injected `trashItem`: nothing found records the version silently; Keep records; Move with all successes records; Move with a failure does not record; a malformed state file is treated as not asked; same version asked already means no scan.
- Existing tests pass. If a startup test needs the new step stubbed, say which and why.

## Out of scope

Settings or a menu item for this. Scanning any folder other than Downloads. Deleting the installer for a newer version. Changing the existing `Updates` folder cleanup.

## Stop conditions

Stop and report if the feature would need a network request, a permanent delete, or reading file contents in Downloads.
