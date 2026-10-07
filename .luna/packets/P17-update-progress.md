# P17 — Update chip, progress window and Cancel

Depends on P16 (main window bar) being merged.

## Goal

While an Update downloads, show its progress in the title bar and in a small window, and let the player cancel it. Today progress is only the taskbar bar and a download cannot be cancelled.

## Read first

`AGENTS.md`, `CONTEXT.md`, `docs/design/wrapper-ui/README.md` (screen 1 "Status cluster", screen 7 "Update progress", the Addendum), `docs/design/wrapper-ui/mock.dc.html` (search `Updating to`), `src/updater.mjs` (`downloadVerified`, its stall timer and cleanup of the partial file), `src/main.mjs` (`performUpdateCheck`), `src/bar-window/`, `src/dialog-main.mjs` (window pattern), `test/updater.test.mjs`.

## Requirements

### 1. Cancel in the downloader

- `downloadVerified` accepts an optional `signal` (`AbortSignal`). Aborting it stops the download the same way the stall timer does and leaves no partial or final file behind, exactly as a stalled download leaves none.
- The rejection for a caller-requested abort must be distinguishable from a stall and from a network error (for example an error with `code: "UPDATE_CANCELLED"`). Stall and verification behaviour, the host allowlist and the size / SHA-256 checks are unchanged.

### 2. `performUpdateCheck`

- Keeps `setProgressBar` as today.
- Also publishes `{ version, received, total }` on each whole-percent change, and `null` when the download ends for any reason, to the bar view and to the progress window if open.
- On cancel: no dialog is shown, nothing is retried, the reservation is released (`backupRequestActive` false) and the function returns `{ available: true, downloaded: false, cancelled: true }`. No cold Backup is requested.
- Every other path (no update, declined, success, error dialog text) is unchanged.

### 3. Update chip (bar)

Shown only while a download is in progress, left of the profile chip, per the spec: teal outline, version text, a 64 × 16 bar filled to the percentage. It is a button (keyboard-activatable, `aria-label` with version and percent) that opens the progress window. It never shrinks; the profile chip still shrinks first.

### 4. Progress window (`src/update-window/`)

- Opened from the chip; one instance; child of the main window, not modal, frameless with the shared title bar (teal stripe, title `Updating to <version>`, close cell closes the window without cancelling the download). 560 wide, height fitted to content, not resizable.
- Four rows per the spec. `Download installer` is current while downloading and shows `62% · 58 / 94 MB` on the right; when the bytes are all received `Verify size + SHA-256` becomes current and the first row is marked done. `Back up saves (restart)` and `Open installer` are always pending (Addendum).
- The 20-segment bar per the spec; `role="progressbar"` with `aria-valuenow`.
- Footer: `Gameplay keeps running while this downloads.` and a secondary `Cancel` that aborts the download.
- The window closes itself when the download ends (finished, failed or cancelled).
- Same security settings as the other windows. Its preload exposes only: receive progress, cancel, close. The cancel handler checks the sender and does nothing when no download is running.

## Tests

- `downloadVerified` with an aborted signal: rejects with the cancel code, leaves no file, and a signal aborted before the call starts no request. Existing stall and verification tests pass unmodified.
- The byte formatter (`58 / 94 MB`, percent) and the "which step is current" rule as pure functions.
- `performUpdateCheck` on cancel shows no dialog and releases the reservation, if the existing harness can reach it; otherwise say why not.
- Existing tests pass.

## Out of scope

Reopening the window after the restart, or showing the Backup and installer steps as live. Automatic update checks. Pausing or resuming a download. Any change to the cold Backup or installer hand-off.

## Stop conditions

Stop and report if cancelling would need a change to how verification, the allowlist or the cold Backup request work, or if a partial file could be left behind.
