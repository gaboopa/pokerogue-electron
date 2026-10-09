# P15 — Regroup the menus

No dependencies. Can run alongside P13.

## Goal

Rearrange the application menu into the groups the new design uses: **Game · Saves · View · Tools · Cheats · Profiles**. This is still the native menu on both platforms; P16 later draws the same template as an in-window bar on Windows. Every handler and accelerator stays the same.

## Read first

`AGENTS.md`, `CONTEXT.md`, `docs/design/wrapper-ui/README.md` (screen 2 "Menus"), `src/menu.mjs`, `src/utilities.mjs`, `src/main.mjs` (`createMenu`), `test/desktop-controls.test.mjs`, `test/diagnostics.test.mjs`, `test/macos-release.test.mjs`, `test/utilities.test.mjs`, `README.md` (every place that names a menu path).

## Requirements

### 1. Structure (`createMenuTemplate`)

Windows and Linux, top level in this order:

| Menu | Items |
|---|---|
| Game | Check for Updates… · separator · Copy Diagnostic Report · separator · Quit (`role: "quit"`) |
| Saves | Back Up Saves… · Restore Backup… · separator · Open Save Folder |
| View | Reload · Toggle Full Screen · Developer Tools (unchanged) |
| Tools | header `OPENS IN BROWSER` · the six web utilities · separator · header `OFFLINE` · the two type charts · separator · header `KEYBINDINGS` · Open Keybindings File… · Reload Keybindings · Reset to Defaults |
| Cheats | Configure Cheats… |
| Profiles | unchanged |

macOS: the app menu (labelled with the product name) keeps About, Services, Hide, Hide Others, Show All and Quit, and holds Check for Updates… and Copy Diagnostic Report; there is no "Game" menu. Then File (unchanged), Saves, View, Tools, Cheats, Profiles, Window (unchanged).

- A header is `{ label, enabled: false, header: true }`. `header` is an extra key for P16 to read; Electron ignores it.
- The separate "Utilities" and "Keybindings" top-level menus are gone; their items live in Tools. The template still receives `utilities` and `keybindings` from the caller; building the Tools submenu from them (including the headers and the split between web utilities and charts) happens in `src/menu.mjs` / `src/utilities.mjs`, not in `src/main.mjs`.
- Labels use the ellipsis character: `Open Keybindings File…`, `Configure Cheats…` (today they use three dots). No other label changes.
- All accelerators and click handlers are exactly as today.

### 2. Docs

`README.md`: update every menu path to the new grouping (for example the app menu's Back Up Saves… becomes Saves › Back Up Saves…, Utilities and Keybindings become Tools). On macOS, say where Check for Updates… and Copy Diagnostic Report are.

## Tests

- Update the menu assertions in `test/desktop-controls.test.mjs`, `test/diagnostics.test.mjs`, `test/macos-release.test.mjs` and `test/utilities.test.mjs` to the new structure. Each existing check keeps its intent: the three View accelerators; Restore Backup… present (now under Saves); Profiles directly after Cheats; profile radio items; macOS app / File / Window roles; Windows has no File menu and Quit is last in its first menu.
- New assertions: top-level labels and order for both platforms; Tools contains the three headers in order, each `enabled: false`, with the six web utilities, two charts and three keybinding items under the right header; every utility accelerator is still present.
- Existing tests otherwise pass unmodified.

## Out of scope

Drawing menus in the window, the title bar, any styling (P16). New menu items. Changing what any item does.

## Stop conditions

Stop and report if an accelerator would have to change, or if a test outside the four named files needs editing.
