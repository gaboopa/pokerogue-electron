# P13 — Pixel theme and reskin of the existing windows

First of six packets (P13–P18) implementing `docs/design/wrapper-ui/README.md`. No dependencies.

## Goal

Give the Cheat Control Center, Backups, New Profile and the two type chart windows the game's pixel look: a shared theme stylesheet, a shared 48px title bar, frameless windows. Behaviour of every window stays the same except where listed below.

## Read first

`AGENTS.md`, `CONTEXT.md`, `docs/design/wrapper-ui/README.md` (all of it, including the Addendum; sections "Global rules", "Design tokens", "Components", and screens 3, 4, 5 and 8 are yours), `docs/design/wrapper-ui/mock.dc.html` (inline styles are the exact layout reference; search for `Cheat Control Center`, `Backups`, `New Profile`, `Type chart`), `src/cheat-window/`, `src/backup-window/`, `src/profile-window/`, `src/cheat-main.mjs`, `src/backup-main.mjs`, `src/profile-main.mjs`, `src/main.mjs` (`toggleChartWindow`), `src/utilities.mjs`, `scripts/build-game.mjs`, `test/window-lifecycle.test.mjs`.

## Requirements

### 1. Assets

- `scripts/build-game.mjs`, after staging the game: copy `staging/game/fonts/pokemon-emerald-pro.ttf`, `staging/game/images/ui/windows/window_1.png`, `window_3.png`, `staging/game/images/ui/cursor.png` and `staging/game/logo128.png` into `src/assets/ui/` (same file names). A missing source file is an error that names the file.
- `src/assets/ui/` is already in `.gitignore`. Do not commit those files. They do not exist in your worktree (there is no `staging/`), and that is expected.
- Every window must still be usable without them: font falls back to `monospace`, frames fall back to a plain 4px `#d7d7d7` border.

### 2. Shared theme

- `src/ui/theme.css`: the `@font-face`, the tokens as CSS custom properties, and the shared components from the spec's "Components" section (title bar, primary / secondary / destructive button, input, checkbox, switch, chip, list row with cursor sprite, the two frames). Each window's own `styles.css` keeps only its layout.
- Follow the spec's global rules exactly: Emerald only at 16 / 32 / 48px, 4px strokes, no border radius, `-webkit-font-smoothing: none`, `image-rendering: pixelated` on frames and cursor, the 4px optical offset.
- Native checkboxes, the switch and number inputs stay real `<input>` elements (restyled with `appearance: none`), so keyboard use and the existing renderer code keep working. Number inputs show no spin buttons.
- Visible keyboard focus on every control: the amber ring from the spec.

### 3. Title bar

- All five windows become `frame: false` and show the shared title bar: title on the left, close cell on the right, `-webkit-app-region: drag` on the bar and `no-drag` on the close cell.
- Close uses each window's existing close bridge. The chart windows have no preload; their close cell calls `window.close()`.
- Windows that are resizable today stay resizable.

### 4. Per window

Sizes, copy and layout are in the spec (screens 3, 4, 5, 8). The points that change behaviour or text:

- **Cheat Control Center**: 800 × 900, min 680 × 700. Window title and title bar `Cheat Control Center`. The `POKÉROGUE OFFLINE` eyebrow is removed; the subtitle becomes `Backed up first. Applied after restart.` Field labels become the uppercase forms in the spec. When Enable is off the three groups are at `opacity: .55` and stay editable. Renderer logic is otherwise unchanged.
- **Backups**: 800 × 560, min 680 × 440. Footer order: `Choose Folder…` on the left; `Close` then `Restore` on the right. Integrity text coloured by status. Selected row shows the cursor sprite. When a Failed row is selected, the error line shows that row's error followed by ` Choose another Backup.`; selecting another row clears it. Empty state is two lines: `No Backups yet.` and `Use Saves › Back Up Saves… to create one.` Date format per the spec (short month, day, hour, minute; the year only when it is not the current year). Put the date formatter in a small pure function that takes the current date as an argument, so it can be tested.
- **New Profile**: 480 × 360, not resizable. Hint line `Gets its own saves, cheats and Backups. The app restarts.`, replaced by the error text while there is an error; the input border turns to the error colour; typing clears the error.
- **Type charts**: a new `src/chart-window/index.html` (plus css and a tiny renderer) shows the image under the title bar; `toggleChartWindow` loads it with the chart id in the query string instead of loading the PNG directly. Content size is 670 × 1048 and 1300 × 648 (`useContentSize`), the image fills the area below the bar without distortion. The bar shows the chart's label and, on the right before the close cell, its shortcut (`Ctrl+Shift+Y` / `Ctrl+Shift+H`; `⌘⇧Y` / `⌘⇧H` on macOS) at 16px `#a99db5`. Toggle behaviour is unchanged.

### 5. Security settings

`webPreferences`, `setWindowOpenHandler` deny, `will-navigate` prevention and the IPC sender checks stay exactly as they are. The chart page loads only local files.

### 6. Docs

`README.md`: if it names the cheat window "Offline Cheat Control Center" or describes the Backups buttons or empty-state text, update those sentences.

## Tests

- New test for the Backup date formatter: same year omits the year, a different year includes it, an unparseable value gives an empty string.
- `test/window-lifecycle.test.mjs` identifies windows by size in its `BrowserWindow` shim (`width === 760` is the editor). Update that detection for the new sizes; keep every assertion.
- A test that `scripts/build-game.mjs` lists the five asset copies is not required. Do not add tests that need `src/assets/ui/` to exist.
- Existing tests pass. If any other test has to change, say which and why.

## Out of scope

The main window, menus, confirmation dialogs, update progress (P14–P18). Any change to cheat, Backup, Restore or profile logic. New dependencies.

## Stop conditions

Stop and report if a requirement needs a change to `webPreferences`, to an IPC channel's behaviour, or to any file under `src/` named `backup.mjs`, `backup-coordinator.mjs`, `backup-worker.mjs`, `cheats.mjs` or `profiles.mjs`.
