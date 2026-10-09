# P19 — UI polish from the real-app review

Depends on P16 (main window bar) being merged. Can run alongside P17.

## Goal

Three small fixes found by running the app after P13–P16.

## Read first

`AGENTS.md`, `CONTEXT.md`, `docs/design/wrapper-ui/README.md` (the Addendum), `src/preload-cheats.cjs`, `src/dialog-window/renderer.mjs`, `src/dialog-window/styles.css`, `src/dialog-main.mjs`, `src/bar-window/bar.css`, `src/bar-window/renderer.mjs`.

## Requirements

### 1. Hide the in-game cheats badge

The game build draws its own red `CHEATS ACTIVE` badge (element id `desktop-cheats-active`) when cheats are on. The title bar's `CHEATS ON` chip now says the same thing, so the badge is redundant. `src/preload-cheats.cjs` currently waits for that element and moves it to the left (`positionCheatBadge`). Change it to hide the element instead (`display: none`), keeping the same wait-for-element approach. Do not touch the game build or anything else in the preload (the key remapper and the `pokerogueDesktop` bridge are unchanged).

### 2. Confirmation dialog shows a scrollbar it does not need

In the real app the "Restart to back up saves" dialog opens a few pixels too short, so its body shows a vertical scrollbar although the text fits. The height the renderer reports is slightly under what the layout needs (fractional line heights round down; the scrollbar that appears while the window is still 96px tall also narrows the text during measurement).

- Measure with the body's scrollbar suppressed (so the text wraps at its final width), and round the reported height up.
- After the main process has applied the size, the renderer checks once more: if the content area still overflows, report the corrected height. At most two corrections, so it cannot loop.
- A scrollbar appears only when the dialog has been capped at the display's work area.

### 3. Profiles menu: cursor and active marker overlap

In an open menu the highlighted row shows the cursor sprite in the leading column, and the active profile shows a 12 × 12 teal square in the same column. When the active profile row is highlighted, both are drawn on top of each other. On a highlighted row that is also the active profile, show only the cursor sprite; the teal square shows whenever the row is not highlighted.

## Assets

`src/assets/ui/` is ignored by git and may be absent in your worktree, and `staging/` always is. That is expected and is not a stop condition. Do not add tests that need those files, and leave the folder alone if it is present.

## Tests

- The preload change: if `test/keyboard-preload.test.mjs` (or another existing test) can load the preload with a fake `document`, add a check that the badge element ends up hidden; if it cannot without a large new harness, say so and leave it untested.
- The dialog height rule (round up, at most two corrections) as a small pure function with a test.
- Existing tests pass. Run the suite with `node --test test/*.test.mjs`; the R17 cold-worker probe failing inside the sandbox is a known limitation.

## Out of scope

Any other change to the game preload, the dialog's behaviour or text, or the menus.

## Stop conditions

Stop and report if hiding the badge would need a change to the game build or to the cheat configuration bridge.
