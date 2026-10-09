# Handoff: PokeRogue Electron — Wrapper UI (pixel redesign)

## Overview
A redesign of every surface the Electron wrapper adds around the game: the main window's top bar and menus, the Cheat Control Center, Backups, New Profile, all `dialog.showMessageBox` confirmations, update download progress, and the two type chart windows. The visual language comes from the game's own assets (Pokémon Emerald Pro font, `ui/windows/window_*.png` 9-slice frames, `ui/cursor.png`, and colors sampled from `ui/bg.png`). The goal is for the wrapper to feel like part of the game.

## About the design files
`Wrapper UI Final.dc.html` is a **design reference built in HTML**. It's a prototype that shows the intended look and behavior, not production code. Open it in a browser with `support.js` and `assets/` next to it. Rebuild these designs inside the existing wrapper (`src/*-window/` HTML/CSS/renderer.mjs plus the main-process files) using the repo's current patterns: plain HTML, a CSS file per window, ES-module renderers, preload bridges, and sandboxed windows. Don't ship the `.dc.html`.

## Fidelity
**High-fidelity.** Colors, type sizes, strokes, spacing and copy are final. Match them exactly.

## Global rules
- **2× pixel grid.** 1 source pixel = 2 CSS px. Use Emerald Pro only at **16 / 32 / 48 px**. The font's glyph grid is 64 units out of 1024 unitsPerEm, so 16px is 1:1, and any other size (20, 24…) renders blurry. Strokes are **4px**, square-dot indicators **8 or 12px**, and there are no border radii anywhere.
- `-webkit-font-smoothing: none`. Set `image-rendering: pixelated` on frames and the cursor, but **not** on `logo128.png` (it's scaled down).
- **Text optical offset.** Emerald sits high in its line box. Give single-line text in fixed-height bars 4px more bottom padding than top (e.g. buttons use `padding: 4px 20px 12px`, where the extra 4px sits above the inset shadow).
- **Frames** use CSS border-image. Use `window_1.png` for hero/emphasis panels, and `window_3.png` for groups, menus, table wells and dialog bodies:
  `border: 16px solid transparent; border-image: url(window_3.png) 8 fill / 16px stretch; image-rendering: pixelated;`
- Copy the font and frame/cursor PNGs from `staging/game/` into `src/assets/` at build time (or reference them through the app protocol). They are already shipped with the game.

## Design tokens
| Token | Hex | Use |
|---|---|---|
| ink | #181818 | Title bars, footers, input fill, checkbox fill |
| panel | #362d3e | Window background (also the frame fill) |
| row-hover | #472d3c | Hover/selected rows, secondary button, open menu label |
| secondary-shade | #2b2231 | Secondary button bottom shade |
| divider | #443c4c | Menu separators, table header rule, disabled button |
| red | #c73625 | Primary button, title-bar stripe |
| red-shade | #8f2419 | Primary bottom shade |
| red-hover | #d8432f | Primary hover |
| error | #ef7082 | Error text, destructive button outline/text, input error border |
| teal | #20b098 | On / Verified / progress / active-profile dot |
| amber | #ffb745 | CHEATS badge, focus ring, section headings, input focus border, caret |
| stroke | #d7d7d7 | Input/checkbox/switch borders, chip outline, muted title text |
| text | #f8f8f8 | Primary text |
| text-2 | #c9bfd3 | Dialog detail text |
| meta | #a99db5 | Shortcuts, hints, pending steps |

**Type:** 48 = window heading (Cheats only); 32 = body, menus, buttons, inputs, list rows; 16 = shortcuts, field labels (UPPERCASE), table column heads (UPPERCASE), hints, menu group heads.

**Spacing:** 4 / 8 / 12 / 16 / 20 / 24. Window body padding is 20px. Footers use `16px 24px 20px`.

**Shadows:** windows in the mock use `0 30px 80px rgba(0,0,0,.55)` (the OS provides this). Dropdown menus get a hard `8px 8px 0 rgba(0,0,0,.35)`.

## Components
- **Title bar (shared):** 48px tall, background `#181818`, bottom stripe `inset 0 -4px 0 <accent>` (red by default; for dialogs the accent follows the type). Title is 32px `#d7d7d7`, padding-left 16px. The close cell is 48×48 with a 32px “x”, and on hover it gets a `#c73625` background and `#f8f8f8` text. Set `-webkit-app-region: drag` on the bar and `no-drag` on its controls.
- **Primary button:** bg `#c73625`, `box-shadow: inset 0 -4px 0 #8f2419`, text 32px `#f8f8f8`, padding `4px 20px 12px`. Hover bg `#d8432f`. Focus adds `0 0 0 4px #ffb745`. Disabled: bg `#443c4c`, text `#8d8499`, shade `#2b2231`, cursor default.
- **Secondary button:** bg `#472d3c`, shade `#2b2231`, hover `#553848`.
- **Destructive (outline):** transparent bg, `inset 0 0 0 4px #ef7082`, text `#ef7082`, padding `4px 16px 12px`, hover bg `#2a1a1e`.
- **Input:** bg `#181818`, 4px border `#d7d7d7` (focus `#ffb745`, error `#ef7082`), 32px text, padding `4px 10px 8px`, caret `#ffb745`. The label above it is 16px UPPERCASE `#d7d7d7` with an 8px gap.
- **Checkbox:** 24×24, 4px `#d7d7d7` border, `#181818` fill. When checked, an 8×8 `#20b098` square sits in the center. The whole row (box + 32px label, 12px gap) is the hit target.
- **Switch:** 64×32, 4px border. Off: fill `#181818`, knob at left 4px. On: fill `#20b098`, knob at left 36px. The knob is 16×16 `#f8f8f8`.
- **Chips:** profile chip = bg `#362d3e`, `inset 0 0 0 4px #d7d7d7`, 32px `#f8f8f8`, padding `2px 12px 6px`. CHEATS ON = bg `#ffb745`, text `#181818`, same padding.
- **List row / menu row:** 32px text, padding `6px 12px 10px 8px`, a 20px leading column. On hover or selection the bg becomes `#472d3c` and `cursor.png` (6×10 shown at 12×20) appears in the leading column.

## Screens

### 1. Main window (1280 × 800, min 800 × 600)
- **Frameless** on Windows: `frame: false` (or `titleBarStyle: 'hidden'` without overlay) plus the custom bar. On macOS use `titleBarStyle: 'hidden'` with `trafficLightPosition` vertically centered in the 48px bar (≈ `{x: 20, y: 18}`). The macOS bar shows traffic lights, the centered title “PokeRogue Electron” (32px `#d7d7d7`), and the right-side chips. **No menus in the window on macOS**: they stay in the system menu bar.
- Game view fills the height below the bar (800 − 48).
- **Windows bar, left to right:** 56px logo cell (logo128 at 32px) → menu labels `Game · Saves · View · Tools · Cheats · Profiles` (32px, padding `0 14px 4px`, hover `#362d3e`, open `#472d3c`) → flex spacer → status cluster (8px gap, 12px right padding) → window controls 3 × 48px (minimize = 16×4 bar, maximize = 16×16 box with 4px stroke, close = “x”).
- **Status cluster (shown only when it applies):**
  1. Update chip while downloading: `inset 0 0 0 4px #20b098`, version text + a 64×16 bar (4px `#d7d7d7` border, `#20b098` fill at percent). Clicking it opens the Update progress window.
  2. Profile chip when the active profile ≠ Default (shows the profile name).
  3. CHEATS ON whenever the loaded cheat config has `enabled: true`, in any profile.
- **Full screen:** hide the bar. Reveal it as an overlay when the pointer is within 4px of the top edge or Alt is pressed.
- The game window title stays `PokeRogue Electron — <profile>` for the taskbar/Alt-Tab.

### 2. Menus
Rendered in-window on Windows as custom HTML popovers below each label: `window_3` frame, min-widths Game 360, Saves 320, View 380, Tools 460, Cheats 320, Profiles 300. On macOS, build the same structure as the native `Menu` (the app menu replaces “Game”).

Behavior: click a label to open its menu. While one is open, hovering another label switches to it. Click outside, Esc, or picking an item closes it. Alt focuses the bar, arrow keys move between items, Enter activates. Hover moves the cursor sprite. The active profile shows a 12×12 teal square.

| Menu | Items (shortcut) |
|---|---|
| Game | Check for Updates… · — · Copy Diagnostic Report · — · Quit (Alt+F4) |
| Saves | Back Up Saves… · Restore Backup… · — · Open Save Folder |
| View | Reload (Ctrl+R) · Toggle Full Screen (F11) · Developer Tools (F12) |
| Tools | head OPENS IN BROWSER: Wiki (Ctrl+Shift+W), Pokédex (Ctrl+Shift+D), SearchDex (Ctrl+Shift+E), Type Calculator (Ctrl+Shift+T), Team Builder (Ctrl+Shift+B), Smogon (Ctrl+Shift+S) · — · head OFFLINE: Type Chart (Ctrl+Shift+Y), Horizontal Type Chart (Ctrl+Shift+H) · — · head KEYBINDINGS: Open Keybindings File…, Reload Keybindings, Reset to Defaults |
| Cheats | Configure Cheats… |
| Profiles | Default · each profile (radio) · — · New Profile… |

Group heads are 16px `#ffb745`, indented 36px, and not clickable. Separators are 4px `#443c4c` with 8px vertical margin. The handlers are the same as today (`createMenuTemplate` args, `createUtilitiesSubmenu`). Accelerators must still be registered (keep a hidden native menu, or use `globalShortcut`/`before-input-event`) so shortcuts work while the bar isn't focused.

### 3. Cheat Control Center (800 × 900, min 680 × 700)
- Header: 48px heading “Cheat Control Center” + 32px `#d7d7d7` “Backed up first. Applied after restart.” On the right is the state chip: `CHEATS ACTIVE` (amber fill, ink text) or `VANILLA` (transparent, 4px `#d7d7d7` outline, `#d7d7d7` text).
- Hero panel (`window_1`): Switch + “Enable cheats” on the left, secondary “Maximum Fun Preset” on the right.
- Three `window_3` groups with 32px amber headings: **Economy & progression** (3-col number inputs: MINIMUM MONEY 0–999999999, XP MULTIPLIER 1–100, EXTRA CANDY / FRIENDSHIP 0–100, then a 2-col checkbox grid: Disable level cap, Free shop purchases, Free rerolls, Free Gacha pulls, Instant egg hatching), **Minimum Poké Ball inventory** (5 cols: POKÉ, GREAT, ULTRA, ROGUE, MASTER, 0–999), **Battle & Pokémon** (2-col checkboxes: Force battle retries, Guaranteed escape, Perfect player IVs, Guaranteed player shinies, Guaranteed enemy shinies, Guaranteed critical hits).
- When Enable is off, the three groups render at `opacity: .55` but stay editable (new; reduces confusion).
- Message line: 32px `#ef7082`, min-height 32 (“No changes were applied.” on cancel, or `error.message`).
- Footer: `#181818`, top stripe `inset 0 4px 0 #c73625`. It holds destructive “Reset to Vanilla”, a spacer, secondary “Cancel”, and primary “Apply & Restart”.
- Logic is unchanged from `cheat-window/renderer.mjs`. Maximum Fun = `MAXIMUM_FUN_CHEATS`, Reset = `NEUTRAL_CHEATS`. While busy, add `.busy` (opacity .6, pointer-events none).
- Title changes from “Offline Cheat Control Center”/“POKÉROGUE OFFLINE” to “Cheat Control Center”, and the eyebrow line is dropped.

### 4. Backups (800 × 560, min 680 × 440)
- Body: a `window_3` well filling the height. The header row is 16px UPPERCASE amber: CREATED / REASON / INTEGRITY (grid `20px 1.3fr 1.3fr 140px`, 12px gap) with a 4px `#443c4c` underline. Rows are 32px and the list scrolls.
- Integrity colors: Verified `#20b098`, Failed `#ef7082`, Checking… `#a99db5`.
- Selected row: bg `#472d3c` + cursor sprite.
- Error line under the well: 32px `#ef7082`. When a Failed row is selected, show its `error` + “ Choose another Backup.”
- Empty state, centered in the well: “No Backups yet.” (32px `#f8f8f8`) / “Use Saves › Back Up Saves… to create one.” (32px `#a99db5`). The copy now names the new menu path.
- Footer: secondary “Choose Folder…” on the left. On the right are secondary “Close” and primary “Restore”, which is disabled unless the selected row is Verified. Primary moves to the far right (it used to be first).
- Date format is shorter: `Oct 7, 9:14 PM` (`toLocaleString` with `{month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}`, plus the year when it isn't the current year).

### 5. New Profile (480 × 360, not resizable; was 420 × 260)
- Label “Profile name” 32px `#d7d7d7`, then the input (focused border amber, autofocus).
- Hint line: 16px `#a99db5` “Gets its own saves, cheats and Backups. The app restarts.” On error it is replaced by the error text at 32px `#ef7082`, and the input border turns `#ef7082`. Errors come from `profileNameError`/`createProfile`: “Use 1–32 letters, digits, spaces, hyphens or underscores, starting and ending with a letter or digit.” / “That name is reserved.” / “A profile with that name already exists.” Typing clears the error.
- Buttons, right-aligned with a 16px gap: secondary Cancel, primary Create and Restart.

### 6. Confirmation dialogs (560 wide, height fits content)
Replace `dialog.showMessageBox` with one reusable modal BrowserWindow (parent = caller, `modal: true`, frameless, not resizable) that accepts the same options object `{type, title, message, detail, buttons, defaultId, cancelId}` and resolves `{response}`. Keep `dialog.showMessageBox` as a fallback when there's no parent window (startup recovery).
- The title bar has no close button, and its stripe color comes from `type`: info `#20b098`, warning `#ffb745`, question `#d7d7d7`, error `#c73625`.
- Body: a `window_3` panel with `message` (32px `#f8f8f8`) and `detail` (32px `#c9bfd3`, `white-space: pre-line` so installer lists keep their line breaks).
- Buttons are right-aligned. `buttons[0]` is primary (red), the rest are secondary, and the button at `defaultId` gets the amber focus ring and is focused on open. Enter = focused button, Esc = `cancelId`.
- Covers every call in `main.mjs`, `cheat-main.mjs` (Shared save warning) and the installer cleanup prompt. `dialog.showErrorBox` becomes `type: 'error'` with a single “OK”.

### 7. Update progress (560 wide)
Today progress only shows through `setProgressBar`. Keep that, and add:
- the title-bar chip (see 1),
- this window, opened by clicking the chip. Title “Updating to <version>”, teal stripe. Four step rows (32px): Download installer (right side, 16px: `62% · 58 / 94 MB`), Verify size + SHA-256, Back up saves (restart), Open installer. The current step shows the cursor sprite in `#f8f8f8`, done steps a 12×12 teal square, pending steps `#a99db5`.
- A segmented bar: 32px tall, 4px `#d7d7d7` border, `#181818` fill, 4px inner padding, 20 segments with 4px gaps, filled segments `#20b098`.
- Footer row: 16px `#a99db5` “Gameplay keeps running while this downloads.” plus a secondary Cancel button (aborts the download, same as the stall timeout).
- Feed it from the existing `received / total` callback in `performUpdateCheck`, sent over IPC to the main window (for the chip) and to this window.

### 8. Type chart windows
Same `toggleChartWindow` behavior. Frameless, with the shared 48px title bar (title + 16px `#a99db5` shortcut on the right, then close). Window size = image size + 48px height (670 × 1048, 1300 × 648). The mock shows them at 50%.

## State (renderer-side)
- Main window bar: `openMenu`, `hoverItem`, `profileName|null`, `cheatsEnabled`, `update {version, received, total}|null`. Push these from main over IPC when `createMenu()` runs, cheats change, or download progress ticks.
- Cheats: same as today, plus derived `enabled` for dimming.
- Backups: `selected`, `rows[{name, createdAt, reason, status, error}]`.
- Dialog: `options`, `focusedIndex`.

## Assets
Everything comes from the repo's staged game, so there are no new artwork dependencies:
- `assets/pokemon-emerald-pro.ttf` ← `staging/game/fonts/`
- `assets/window_1.png`, `assets/window_3.png` ← `staging/game/images/ui/windows/` (24×24 9-slice, slice 8)
- `assets/cursor.png` ← `staging/game/images/ui/cursor.png` (6×10)
- `assets/logo128.png` ← `staging/game/logo128.png`
- `assets/bg.png` (only a stand-in for the game canvas in the mock)
- `assets/type-chart.png`, `assets/type-chart-2.png` ← `src/assets/`

## Files
- `Wrapper UI Final.dc.html`: the full spec (main window, title bar states, menus, all windows, dialogs, tokens). Its tweaks toggle profile, cheats on, update in progress, and the empty Backups state.
- `support.js`: the runtime needed to open the `.dc.html` locally.

## Addendum: decisions made after the handoff

These override the text above where they differ.

- **Cheat Control Center.** The window is 1140 × 880 (minimum 1140 × 700), with a merged top row, three-column checkboxes and no heading. The handoff's 800 × 900 layout needs about 1,130px of height at the specified type size.

- **In this repository the mock is `mock.dc.html`** (renamed from `Wrapper UI Final.dc.html`). Its inline styles are the reference for exact layout. `support.js` and the mock's `assets/` folder are not versioned, so it does not render from here; read it as source.
- **Title bar overflow.** Chips never wrap (`white-space: nowrap`). The profile chip truncates with an ellipsis and is the first thing to shrink; menu labels and window controls never shrink. The 800px minimum width stays.
- **Assets.** `scripts/build-game.mjs` copies the font, `window_1.png`, `window_3.png`, `cursor.png` and `logo128.png` from `staging/game/` into `src/assets/ui/` when it stages the game. That folder is ignored by git, so the files are absent in a fresh checkout until the game is staged; every window must stay usable (fallback monospace font, no frames) without them.
- **Views.** The mock's "BrowserView" label means `WebContentsView`.
- **Update progress steps.** "Back up saves (restart)" and "Open installer" are a static roadmap. The app restarts right after the download, so they are never shown as current or done.
- **Native dialogs that remain.** Dialogs shown with no live main window (startup recovery, the pre-launch error in `src/bootstrap.mjs`) keep the operating system's look.
