# P14 — Themed confirmation dialogs

Depends on P13 (theme) being merged.

## Goal

Replace the operating system's message boxes with one reusable themed modal window, wherever a parent window exists. Every dialog's title, message, detail, buttons, default and cancel behaviour stays byte-identical; only the look changes.

## Read first

`AGENTS.md`, `CONTEXT.md`, `docs/design/wrapper-ui/README.md` (screen 6 "Confirmation dialogs", the Addendum), `docs/design/wrapper-ui/mock.dc.html` (search `Confirmation dialogs`), `src/ui/theme.css`, `src/main.mjs` (`showMessageBox` near the top and every caller; every `dialog.showErrorBox`), `src/cheat-main.mjs` (`confirm`), `src/backup-main.mjs` (window pattern), `test/window-lifecycle.test.mjs` and `test/startup-recovery.test.mjs` (the `electron` shims and how they record dialogs).

## Requirements

### 1. The dialog window (`src/dialog-main.mjs`, `src/dialog-window/`)

- `showThemedMessageBox(parent, options)` returns a promise of `{ response }`, the same shape as `dialog.showMessageBox`. Options used: `type`, `title`, `message`, `detail`, `buttons` (default `["OK"]`), `defaultId`, `cancelId`.
- A `BrowserWindow` with `parent`, `modal: true`, `frame: false`, not resizable, not minimizable, 560 wide, height fitted to the content after layout (cap it at the parent display's work area and let the body scroll beyond that). Same `webPreferences` and navigation locks as the other windows, with its own preload.
- Look per the spec: title bar without a close button, stripe colour from `type` (`none` is treated as `info`), `window_3` body with `message` and `detail` (`white-space: pre-line`, long unbroken paths must wrap rather than overflow), buttons right-aligned with `buttons[0]` primary and rightmost, the rest secondary to its left in order.
- The button at `defaultId` is focused on open. Enter activates the focused button, Tab / arrow keys move focus, Esc resolves `cancelId`. If `cancelId` is not given, Esc does nothing when there is more than one button and resolves `0` when there is one.
- If the window is closed any other way (parent closed, app quitting), the promise resolves with `cancelId` (or `0` when not given). It must never stay pending.
- The renderer may only send a button index. The main process checks that the sender is that dialog's window and that the index is a valid button; anything else is ignored. Options reach the renderer by IPC, never through the URL.
- Several dialogs can be open at once (different parents); each resolves independently.

### 2. Wiring

- `showMessageBox` in `src/main.mjs`: themed when there is a live parent, `dialog.showMessageBox(options)` when there is none (unchanged fallback).
- `confirm` in `src/cheat-main.mjs` uses the themed dialog with the same parent rule it has today.
- Every `dialog.showErrorBox(title, message)` in `src/main.mjs` that can run with a live main window becomes a themed dialog of `type: "error"`, the title as `title`, the text as `message`, one `OK` button; it stays `dialog.showErrorBox` when there is no live window. Do not touch `src/bootstrap.mjs`.
- The recovery dialog that calls `dialog.showMessageBox` with no parent stays native.

### 3. Text

No dialog text, button label, button order, `defaultId` or `cancelId` changes anywhere.

## Tests

- Unit tests for the main-process side with a fake window: resolves the clicked index; rejects an index out of range and a sender that is not the dialog's window; resolves `cancelId` when the window closes without an answer; two concurrent dialogs resolve independently.
- The two harnesses record dialogs through the `electron` shim's `dialog.showMessageBox`. Keep every existing assertion about dialog titles, messages, buttons, parents and responses. You may change harness plumbing (for example a loader stub for `./dialog-main.mjs` that records into the same `state.dialogs` / `state.dialogParents` and answers from the same response queue) but may not delete or loosen an assertion. Say exactly what you changed in each harness.
- Existing tests pass.

## Out of scope

`dialog.showOpenDialog` (the folder picker stays native). `src/bootstrap.mjs`. Rewording any dialog. The main window title bar and menus (P16).

## Stop conditions

Stop and report if keeping an existing assertion is impossible, or if any Backup / Restore / Update flow would need its control flow changed rather than just the function it calls to ask.
