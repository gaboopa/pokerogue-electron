# P21 — Simplification pass

No dependencies.

## Goal

Remove dead and duplicated code found in an over-engineering audit. Every item is behaviour-preserving except item 3, which drops support for one obsolete file format. The diff must be a net deletion; do not add abstractions beyond the two helpers named below.

## Read first

`AGENTS.md`, `CONTEXT.md`, `src/main.mjs`, `src/cheat-main.mjs`, `src/backup-main.mjs`, `src/profile-main.mjs`, `src/keymap-store.mjs`, `src/backup-list.mjs`, `scripts/release-manifest-lib.mjs`, `src/updater.mjs` (`sha256File`), `test/window-lifecycle.test.mjs` and `test/startup-recovery.test.mjs` (their Electron shims identify windows by constructor options).

## Requirements

### 1. Delete the unused shop-fee script

Delete `scripts/fix-shop-fee-overrides.mjs` and `test/shop-fee-hotfix.test.mjs`. Nothing else references them.

### 2. One helper for child windows

Add `src/child-window.mjs` exporting one function that creates a `BrowserWindow` with what the five child windows repeat today: `show: false`, `autoHideMenuBar: true`, `frame: false`, the secure `webPreferences` (`sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true`, plus the `preload` path when the window has one), `setWindowOpenHandler(() => ({ action: "deny" }))`, and `will-navigate` → `preventDefault()`. Use it for the cheat, Backups and New Profile windows and for the update and chart windows in `src/main.mjs`.

- The options each `BrowserWindow` is constructed with must be the same keys and values as today (the test shims read them), and each window keeps its own show, `closed` and load logic where those differ.
- Leave `src/dialog-main.mjs` and the main window alone.

### 3. Drop the unversioned restore-marker format

In `applyPendingRestore` (`src/main.mjs`), remove the `legacyPending` conversion and its recovery-copy branch. A marker with no `version`/`status` then takes the existing "unsupported or incomplete format" path, which records it as failed without applying it.

- Update `test/startup-recovery.test.mjs` to match: remove the test that exists only for the legacy format, and keep the legacy-shaped marker in the "failed recovery-copy scans" test only if it still passes on the unsupported-format path (rename the test if its title no longer fits).

### 4. One wrapper for the bar IPC handlers

In `registerBarIpc`, the nine `bar:*` handlers each repeat `barView && event.sender.id === barView.webContents.id`. Register them through one local wrapper that does that check. Channel names, the preload and behaviour stay the same. The two `update:*` handlers are unchanged.

### 5. `diagnosticFacts`

Remove the `try {} catch {}` around `process.platform`, `process.arch` and `process.versions.electron/chrome/node`; assign those directly. Keep the guards around `app.*`, `process.getSystemVersion()` and everything that reads files.

### 6. Replace `scripts/dev.mjs`

Delete `scripts/dev.mjs` and set the `dev` script in `package.json` to `npm run build:game && electron .`.

### 7. Reuse `sha256File`

In `scripts/release-manifest-lib.mjs`, hash the artifact with `sha256File` from `../src/updater.mjs` instead of the hand-rolled `Writable`, and drop the imports that become unused.

### 8. `ensureKeymap`

Replace the `stat` then `wx` write with the `wx` write alone, ignoring `EEXIST` and rethrowing anything else. It still returns `path`.

### 9. One progress throttle

In `performUpdateCheck`, `onProgress` keeps two last-percent variables (`Math.floor` for the taskbar bar, `Math.round` for the published progress). Use one rounded percent: when it changes, call `setProgressBar(received / total)` and `publishUpdateProgress(...)` together.

### 10. `profileContext()`

`globalThis[Symbol.for("pokerogue.profile-context")]` appears seven times in `src/main.mjs`. Add one small function returning it and use it at each site.

### 11. `operationReasons`

In `src/backup-list.mjs`, remove the `operationReasons` map (each key maps to itself) and use `parsed.operation`.

## Assets

`src/assets/ui/` is ignored by git and may be absent in your worktree, and `staging/` always is. That is expected and is not a stop condition.

## Tests

- Run `node --test test/*.test.mjs`. All tests pass except those removed or adjusted under items 1 and 3; the R17 cold-worker probe failing inside the sandbox is a known limitation.
- Do not add new tests; no new logic is introduced.

## Out of scope

`scripts/package-win-cache.mjs`, `scripts/package-mac-local.mjs`, `src/backup*.mjs` other than `backup-list.mjs`, any user-visible text, and any security setting.

## Stop conditions

Stop and report if an item cannot be done without changing a window's constructor options, a user-visible string, or a test outside items 1 and 3.
