# P7 — Profiles

## Goal

Let a player keep several independent sets of Save data and cheat settings (for example one clean profile and one with cheats) and switch between them from the menu. Switching restarts the app.

## Design (decided — do not redesign)

A profile is a `userData` directory.

- **Default profile**: the existing `userData` location, exactly as today. No files move. No migration. A player who never creates a profile must see no behaviour change at all.
- **Named profile**: `<root>/Profiles/<name>/`, where `<root>` is the default `userData` location.
- **Active profile**: recorded in `<root>/active-profile.json` as `{ "schemaVersion": 1, "profile": "<name>" }` (`null` for the default profile). A missing file means the default profile.
- `src/bootstrap.mjs` resolves the active profile before any session opens and points `userData` and `sessionData` at it with the existing `setProfilePaths()`.

Everything per-player already derives from `userData` (`paths()` in `src/main.mjs`, `pathsFor()` in `src/backup-coordinator.mjs`), so Save data, `cheats.json`, Backups, the intent journal, retention and the `Updates` folder become per-profile with no change to those modules.

Shared across profiles (lives in `<root>`): `keymap.json` and `active-profile.json`.

## Read first

`AGENTS.md`, `CONTEXT.md`, `DEVELOPMENT.md` ("Save compatibility", "Security invariants"), `src/bootstrap.mjs`, `src/main.mjs`, `src/menu.mjs`, `src/cheat-main.mjs` and `src/cheat-window/` (the pattern to copy for the new window), `test/desktop-controls.test.mjs`, `test/startup-recovery.test.mjs`.

## Requirements

### 1. `src/profiles.mjs` (new; `node:fs` and `node:path` only, no `electron` import)

- Profile name rule: 1–32 characters, letters, digits, space, `_`, `-`; must start and end with a letter or digit. Reject Windows reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`) and `Default`, all case-insensitively.
- Resolve the active profile synchronously (bootstrap runs before `ready`). Fall back to the default profile, and write one line to stderr saying why, when the file is unreadable, malformed, names an invalid profile, or names a profile whose directory is missing, is not a directory, or is a symbolic link. Never create a directory while resolving.
- List profiles: valid-named real directories directly under `<root>/Profiles`, sorted. Ignore everything else.
- Create a profile: refuse a name that matches an existing profile case-insensitively; create the directory non-recursively so a race fails instead of merging.
- Set the active profile: write to a temporary file and rename, as `writeCheatDocument` in `src/cheats.mjs` does.
- The resolved profile directory must be a direct child of `<root>/Profiles`. Assert this after resolving; never build a path from an unvalidated name.

### 2. `src/bootstrap.mjs`

- `<root>` is what `sourceUserData` is today, including under `POKEROGUE_R17_TEST_SOURCE`.
- Keep taking the single-instance lock while `userData` is still `<root>`, then switch to the profile directory. Two instances must never run at once, even on different profiles.
- For the default profile, `userData` and `sessionData` must be byte-for-byte what they are today.
- For a named profile, both are the profile directory.
- In worker mode, `sourceUserData` and `sourceSessionData` are the active profile's directory, so the worker backs up the profile the parent was running.
- Publish `{ root, name }` (name `null` for default) on `globalThis[Symbol.for("pokerogue.profile-context")]`, frozen, following the existing worker-context pattern.

### 3. `src/main.mjs` and `src/menu.mjs`

- `paths()` gains `root` and reads `keymap.json` from `root`. When the profile context is absent (tests load `main.mjs` directly), `root` is `userData`.
- New top-level **Profiles** menu after **Cheats**: one radio item per profile with **Default** first and the active one checked, a separator, then **New Profile…**.
- Choosing the active profile does nothing. Choosing another:
  1. If a Backup request is active, a Backup intent exists, or a restore marker exists, show the "busy" dialog below and stop.
  2. Show the confirm dialog below. On cancel, rebuild the menu so the radio check returns to the active profile.
  3. Set the active profile, flush storage as `requestColdBackup` does, then relaunch and quit as the cheat controller's `relaunch` does.
- **New Profile…** opens a small window in `src/profile-window/` built like `src/cheat-window/`: same `webPreferences`, `setWindowOpenHandler` deny, `will-navigate` prevented, and IPC handlers that reject any sender other than this window. It has one name field, **Create and Restart**, and **Cancel**. The main process validates the name again, applies the same busy check, creates the profile, makes it active, and relaunches. Failures are returned to the window and shown inline.
- Window title: for a named profile the main window title is `PokeRogue Offline — <name>` and must not be replaced by the page's own title. For the default profile, title behaviour is unchanged.

### 4. New user-visible text (exact)

- Menu: `Profiles`, `Default`, `New Profile…`
- Confirm: title `Switch profile`, message `Switch to "<name>"?`, detail `PokeRogue Offline will restart. Each profile has its own Save data, cheat settings and Backups.`, buttons `Switch and Restart`, `Cancel` (default and cancel on `Cancel`).
- Busy: type info, title `Profile switch unavailable`, message `Finish the pending Backup, Restore or Update before switching profiles.`
- New-profile window: title `New Profile`, label `Profile name`, buttons `Create and Restart`, `Cancel`. Inline errors: `Use 1–32 letters, digits, spaces, hyphens or underscores, starting and ending with a letter or digit.`, `That name is reserved.`, `A profile with that name already exists.`

All existing text stays byte-identical, including the cheat dialog's "shared saves" wording.

### 5. Docs

- `CONTEXT.md`: add the term **Profile** ("An independent set of Save data, cheat settings and Backups; the default profile is the original installation's data."). Avoid: account, user, slot.
- `README.md`: a short "Profiles" subsection under "Saves and backups" — what a profile holds, that keybindings are shared, that switching restarts the app, where the folders are.
- `DEVELOPMENT.md`, "Save compatibility": the default profile's location is the one that must never move; named profiles live under `Profiles/`.
- `docs/adr/0001-profiles-are-userdata-directories.md`: the decision above, and the two rejected alternatives (Electron session partitions — would need the Backup inventory re-rooted; moving the default profile into `Profiles/` — would need a storage migration).

## Tests

- `test/profiles.test.mjs`: name rule (accept and reject cases, reserved names, case-insensitive collision); resolve fallbacks (missing file, malformed JSON, invalid name, missing directory, symlinked directory) all return the default profile and create nothing; create then set-active then resolve round-trips; listing ignores files and invalid names. Use `mkdtemp` under the OS temp folder.
- Menu template test alongside the existing ones in `test/desktop-controls.test.mjs`: Profiles menu position, Default first, active item checked, New Profile… present.
- If a development probe can show cheaply that a second launch is refused while an instance runs on a different profile, add it. If not, report it as pending — do not claim it.
- All existing tests pass unmodified. If an existing test has to change, say which and why in the report.

## Out of scope

Renaming, deleting, copying or importing profiles. Per-profile keybindings. A shared `Updates` folder. Any change to Backup, Restore, Update or retention behaviour.

## Stop conditions

Stop and report instead of working around it if:

- the change needs any edit to `src/backup.mjs`, `src/backup-coordinator.mjs`, `src/backup-worker.mjs`, `src/retention.mjs` or `src/updater.mjs`;
- the default profile's `userData`, `sessionData` or `app://game` origin would change in any way;
- the single-instance lock cannot be made to cover all profiles.
