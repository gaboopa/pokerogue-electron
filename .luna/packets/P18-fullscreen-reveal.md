# P18 — Reveal the title bar in full screen

Depends on P16 (main window bar) being merged. Can run alongside P17.

## Goal

In full screen the title bar is hidden (P16). Reveal it as an overlay on top of the game when the pointer reaches the top edge or Alt is pressed, so the menus and window controls stay reachable. Windows and Linux only; macOS already reveals its own menu bar and needs nothing.

## Read first

`AGENTS.md`, `CONTEXT.md`, `docs/design/wrapper-ui/README.md` (screen 1, "Full screen"), `src/main.mjs` (the two views, the layout function, the `before-input-event` handler), `src/bar-window/`, `src/preload-cheats.cjs`.

## Requirements

- While in full screen, the bar view is shown at `{0, 0, width, 48}` **over** the game view (the game view keeps the full window; the game must not resize or reflow when the bar appears) when either:
  - the pointer is within 4px of the top edge of the window, or
  - Alt is pressed and released on its own (not as part of a chord such as Alt+F4 or Alt+Tab).
- It hides again when no menu is open and either the pointer has been below the bar for 600ms, or Esc / Alt is pressed. While a menu is open it stays (the bar view covers the window, as in P16).
- Leaving full screen restores the normal P16 layout whatever the reveal state was.
- Detect the pointer from the main process (cursor position against the window bounds on a short interval that runs only while the window is full screen and focused), not by adding to the game's preload. Detect Alt with `before-input-event` on the game view. The interval must be cleared when leaving full screen, on blur and when the window closes.
- Revealing the bar does not steal keyboard focus from the game unless it was revealed with Alt, in which case focus goes to the first menu label as in P16.
- Game input is untouched: keys other than the lone Alt are not intercepted.

## Tests

- The reveal rule as a pure function / small state machine with an injected clock: pointer at the top reveals; leaving for less than 600ms keeps it; 600ms hides; an open menu holds it; lone Alt toggles; Alt as part of a chord does nothing; leaving full screen resets.
- Extend the layout-function test from P16 with the "full screen, revealed" case.
- Existing tests pass.

## Out of scope

Animation. Any change outside full screen. macOS. Changes to `src/preload-cheats.cjs`.

## Stop conditions

Stop and report if this cannot be done without changing the game's preload or intercepting game keys.

In your final report, list what needs a running app to confirm (pointer detection on a second monitor and at display scaling other than 100%, Alt behaviour) as **pending manual check**.
