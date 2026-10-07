# P16 — Main window title bar and in-window menus

Depends on P13 (theme), P14 (themed dialogs) and P15 (menu regroup) being merged.

## Goal

The main window becomes frameless with a 48px pixel title bar above the game. On Windows and Linux the bar holds the menus (drawn in HTML from the same template as the native menu), status chips and window controls. On macOS it holds the traffic lights, the centred title and the chips; menus stay in the system menu bar.

## Read first

`AGENTS.md`, `CONTEXT.md`, `docs/design/wrapper-ui/README.md` (screens 1 and 2, "State", the Addendum), `docs/design/wrapper-ui/mock.dc.html` (sections `Main window`, `Title bar states`, `Menus`), `src/ui/theme.css`, `src/main.mjs` (`createWindow`, `createMenu`, `getLiveMainWindow`, every use of `mainWindow` and `.webContents`), `src/menu.mjs`, `src/preload-cheats.cjs`, `src/cheats.mjs` (`loadCheatDocument`), `test/window-lifecycle.test.mjs`, `test/startup-recovery.test.mjs`.

## Design (decided; do not substitute another)

- The main window hosts two `WebContentsView`s: the **game view** (the game at `app://game/index.html`, with today's preload and `webPreferences`) and, above it in z-order, the **bar view** (`src/bar-window/`, its own preload, same sandbox settings, transparent background).
- Normal state: bar view at `{0, 0, width, 48}`, game view at `{0, 48, width, height − 48}`. While a menu is open the bar view covers the whole window so the dropdown can overlap the game and a click anywhere outside closes it; when the menu closes it returns to 48px and keyboard focus goes back to the game view.
- Layout is recomputed on resize, maximize, unmaximize and full screen changes. In full screen the bar view is hidden and the game view fills the window (revealing it is P18).
- The native application menu is still set on every platform, from the same `createMenuTemplate` result. On Windows and Linux it is not visible (frameless) and exists so accelerators keep working; on macOS it is the menu.
- Everything that today talks to the game through `mainWindow.webContents` (load, reload, F5, developer tools, `keybindings:update`, `flushStorageData`, the navigation locks, `did-finish-load`) talks to the game view's `webContents`. Add one accessor for it and use it everywhere. Whether the host is a `BaseWindow` or a `BrowserWindow` with an unused page is your call; pick the one that changes fewer call sites, and say which.

## Requirements

### 1. Window

- `frame: false` on Windows and Linux. On macOS `titleBarStyle: "hidden"` with `trafficLightPosition` centred in the 48px bar.
- Size, minimum size, icon, background colour, show-when-ready and the taskbar title (`PokeRogue Electron — <profile>`) are as today.
- Child windows (Cheats, Backups, New Profile, dialogs) keep the main window as parent.

### 2. Bar (Windows and Linux)

Left to right per the spec: logo cell, the six menu labels, spacer, status chips, minimize / maximize / close. The bar is the drag region; labels, chips and controls are `no-drag`. Double-click on the bar toggles maximize (the drag region gives this for free; do not reimplement it). The maximize control reflects the maximized state.

### 3. Menus (Windows and Linux)

- The main process sends the bar a serialisable copy of the template: for each item `id`, `label`, `type` (normal / separator / radio / header), `checked`, `enabled` and a display shortcut string (`Ctrl+Shift+W`, `F11`, `Alt+F4` for Quit). Functions never cross IPC.
- Activating an item sends its `id`; the main process looks the id up in the **current** template and runs that item's `click` (or performs its `role`). An unknown id, a separator, a header or a disabled item is ignored. The sender must be the bar view.
- The template is re-sent whenever `createMenu()` runs, so the Profiles list and its radio state stay current.
- Behaviour per the spec: click a label to open, hover switches between open menus, click outside / Esc / picking an item closes, hover moves the cursor sprite, the active profile shows the teal square. Keyboard: Alt focuses the bar (first label), Left / Right move between menus, Up / Down between items (skipping separators and headers), Enter activates, Esc closes and returns focus to the game.
- Menus use the `window_3` frame and the min-widths in the spec; a menu must never extend past the window's right edge.
- Accessibility: `role="menubar"`, `menu`, `menuitem` / `menuitemradio` with `aria-checked`, `aria-expanded` on labels.

### 4. Status chips (all platforms)

- **Profile chip**: shown when the active profile is not Default; text is the profile name.
- **CHEATS ON**: shown when the loaded cheat document has `enabled: true`.
- Overflow rule (Addendum): chips never wrap; the profile chip truncates with an ellipsis and shrinks first, with its full name as the `title` tooltip; labels and window controls never shrink. At 800px wide with a 32-character profile name and CHEATS ON showing, nothing overlaps or wraps.
- State is pushed from the main process when the bar loads and whenever the menu is rebuilt. The bar never reads files.
- Leave a place for the Update chip (P17) but do not build it.

### 5. macOS

Bar shows the traffic lights (native), the centred title `PokeRogue Electron`, and the chips on the right. No menu labels, no custom window controls.

### 6. Security

- The bar view has the same `webPreferences` as the other windows, denies window opens and navigation, and loads only local files.
- The game view's `webPreferences`, preload, navigation rule (`APP_ORIGIN` only) and the network policy are unchanged.
- The bar's preload exposes only: receive state, activate item by id, menu opened / closed, minimize, toggle maximize, close.

## Tests

- Pure function that turns a template into the serialised form: ids are stable and unique, shortcuts are formatted per platform, headers / separators / radios keep their type, no functions in the output.
- Activation lookup: runs the right `click`; ignores unknown ids, separators, headers, disabled items and a wrong sender.
- Layout function (window size, full screen flag, menu open flag → bounds for the two views): normal, menu open, full screen, and the minimum size.
- The two harness shims need `WebContentsView` (and `BaseWindow` if you use it). Extend them; keep every existing assertion (reload counts, developer tools, keybinding sends, dialog parents, window roles). Say exactly what changed in each harness.
- Existing tests pass.

## Out of scope

Revealing the bar in full screen (P18). The Update chip and progress window (P17). Changing any menu item, accelerator or handler. Changes to the game or to `src/preload-cheats.cjs` beyond what moving it to the game view requires.

## Stop conditions

Stop and report, without working around it, if: the design above cannot work as described (say what fails); an existing harness assertion cannot be kept; or the change would need the game view's sandbox, preload surface or navigation rule loosened.

In your final report, list anything you could not verify without a running app (accelerators firing while the bar or the game has focus, drag region, focus return after a menu closes, macOS traffic-light position) as **pending manual check**, one line each.
