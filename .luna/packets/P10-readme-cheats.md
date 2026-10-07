# P10 — README: cheats and positioning

Depends on P7, P8 and P9 being merged. Documentation only.

## Goal

The README never mentions the cheat system, and undersells what makes PokeRogue Offline different from other desktop wrappers. Fix both in `README.md` without changing any code.

## Read first

`README.md`, `CONTEXT.md`, `KEYBINDINGS.md`, `src/cheats.mjs`, `src/cheat-window/index.html` and `renderer.mjs` (the authoritative list of cheats and their labels), `src/utilities.mjs`.

## Requirements

### 1. "What does this version do?"

Rework the existing list so it leads with the three things that set this project apart, each one line, each true of the code as merged:

- **Protects your progress** — integrity-checked Backups made automatically before an Update, a Restore or a cheat change, with a Backup list to restore from.
- **Yours, offline** — the complete game runs from your computer with gameplay networking blocked; no account, no telemetry; profiles keep separate Save data side by side.
- **More to play with** — a built-in cheat control center, offline type charts and reference shortcuts.

Keep any existing bullet that is still accurate and not covered by these.

### 2. New "Cheats" section (after "Saves and backups")

- How to open it: **Cheats → Configure Cheats…**
- What it offers: list every cheat the control center exposes, using the labels the window shows. Take the list from the source files above; do not add, rename or describe a cheat that is not there.
- What happens when you apply or disable cheats: a verified Backup is made first and the app restarts.
- Progress earned with cheats on stays in that Save data — so recommend a separate profile for cheat play, linking to the Profiles subsection.
- One sentence that this is a single-player offline build, so cheats affect nobody else.

### 3. Consistency pass

- Product name spelling in headings and prose follows the README's existing convention.
- Use the terms in `CONTEXT.md` (Backup, Save data, Update, Profile).
- Every menu path and label quoted in the README must match `src/menu.mjs` and `src/main.mjs` exactly.

## Verification

- `git diff --stat` shows only `README.md`.
- For each cheat named in the README, cite in the final report the source line it came from.
- `npm test` still passes (some tests read packaged docs).

## Out of scope

Screenshots (a human will add them). Renaming "Cheats" in the app. Cheat presets. Changes to any other file.

## Stop conditions

Stop and report if a claim in section 1 is not true of the merged code — say which, rather than softening or dropping it silently.
