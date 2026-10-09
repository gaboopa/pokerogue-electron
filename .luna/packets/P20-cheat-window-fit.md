# P20 — Make the Cheat Control Center fit its window

No dependencies (builds on P13, already merged).

## Goal

The Cheat Control Center's content is about 1,130px tall in an 800 × 900 window, so its middle scrolls and the last group starts below the fold. Make everything visible at once, without scrolling, in a window that fits a display with 900px of usable height. Layout only: no control, label, value range or behaviour changes.

## Read first

`AGENTS.md`, `CONTEXT.md`, `docs/design/wrapper-ui/README.md` ("Global rules", "Design tokens", "Components", screen 3, the Addendum), `src/cheat-window/index.html`, `src/cheat-window/styles.css`, `src/cheat-window/renderer.mjs`, `src/ui/theme.css`, `src/cheat-main.mjs`, `test/window-lifecycle.test.mjs` (its `BrowserWindow` shim identifies the editor by `options.width === 800`).

## Requirements

### 1. Window

- Default size 1140 × 880, minimum 1140 × 700 (`src/cheat-main.mjs`). When the window is created, cap the height at the work area height of the display the parent window is on (and the width at its work area width), so it never opens taller than the screen.
- Update the size check in the `test/window-lifecycle.test.mjs` shim to the new width.

### 2. Layout (the vertical budget is the whole point; measured character width of the 32px font is about 12px)

Top to bottom, inside the 880px content height (a number input is 52px tall: 32 text + 12 padding + 8 border; with its 16px label and 8px gap an input row is 76):

| Block | Height |
|---|---|
| Title bar (unchanged) | 48 |
| Top row | 88 |
| Economy & progression | 252 |
| Minimum Poké Ball inventory | 164 |
| Battle & Pokémon | 164 |
| Gaps between those four blocks (3 × 8) and `main` padding (12 top, 12 bottom) | 48 |
| Footer (unchanged: padding `16px 24px 20px`) | 92 |

That totals 856, leaving 24px spare at 880. Treat the table as a ceiling for each block, not a target to fill.

- **Top row replaces the header and the hero panel.** One `window_1` frame holding, left to right: the switch and `Enable cheats`; a flexible spacer; the state chip (`CHEATS ACTIVE` / `VANILLA`, same element id `state`); `Maximum Fun Preset`. The 48px `Cheat Control Center` heading is removed (the title bar already says it). The line `Backed up first. Applied after restart.` moves into the footer, left of `Cancel`, at 16px `#a99db5`, in the flexible space after `Reset to Vanilla`; it truncates with an ellipsis if there is no room.
- **Checkbox grids are three columns** (they are two today), so Economy's five boxes take two rows and Battle's six take two rows. Column gap 20px, row gap 12px. No label may wrap or be clipped at 1140px wide: the longest is `Guaranteed player shinies`.
- **Group spacing:** inside each group, 12px between the heading, the input row and the checkbox grid; group padding as today.
- **Message line:** no space is reserved for it. When it has text it appears as a 32px `#ef7082` line directly above the footer, over the bottom of the scroll area's padding, without moving the groups (for example absolutely positioned at the bottom of `main` with the panel colour behind it). `role="status"` stays.
- **Small screens:** if the window is shorter than the content (height capped by the display, or the user shrinks it to the 700 minimum), `main` scrolls as it does today, with the title bar and footer fixed. No horizontal scrolling at 1140 wide.
- The dimmed state (`opacity: .55` on the three groups when Enable is off) and the busy state are unchanged.
- Element ids used by `renderer.mjs` stay the same. `renderer.mjs` needs no change unless an id it reads moves; say so if you touch it.

### 3. Spec

Add to the Addendum in `docs/design/wrapper-ui/README.md`: the Cheat Control Center is 1140 × 880 (min 1140 × 700) with a merged top row, three-column checkboxes and no heading, because the handoff's 800 × 900 layout needs about 1,130px of height at the specified type size.

## Assets

`src/assets/ui/` is ignored by git and may be absent in your worktree, and `staging/` always is. That is expected and is not a stop condition. Do not add tests that need those files, and leave the folder alone if it is present.

## Tests

- Existing tests pass, with only the shim's width check changed. Run `node --test test/*.test.mjs`; the R17 cold-worker probe failing inside the sandbox is a known limitation.
- You cannot measure rendered layout in your sandbox; the reviewer will render the page at 1140 × 880 and at 1140 × 700 and measure it. In your report, give your own arithmetic for each block's height from your CSS so the reviewer can compare.

## Out of scope

Any change to cheat logic, labels, ranges, the other windows or the shared theme's components (add a rule to `theme.css` only if a shared component is genuinely missing).

## Stop conditions

Stop and report if the budget cannot be met without shrinking type below the spec's sizes (16 / 32px), removing a control, or changing `src/cheats.mjs`.
