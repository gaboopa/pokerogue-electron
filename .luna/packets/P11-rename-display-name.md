# P11 — Rename the visible product name to PokeRogue Electron

## Goal

Everything a player or reader sees calls the product **PokeRogue Electron**. Everything that existing installations depend on keeps the old name underneath, so nobody loses Save data and already-installed copies can still Update.

## The split (decided — do not redesign)

**Changes to "PokeRogue Electron"** (written "PokéRogue Electron" in `README.md` and `BUILDING-MACOS.md` prose, following those files' existing accent convention; "PokeRogue Electron" everywhere else):

- `PRODUCT_NAME` in `src/constants.mjs`, and through it the menu title, window title, and dialogs.
- Every literal "PokeRogue Offline" in user-visible strings in `src/` (dialogs in `src/main.mjs`, the report header in `src/diagnostics.mjs`).
- `productName` and `nsis.uninstallDisplayName` in `package.json`. This renames the Windows executable, shortcuts and uninstaller, and the macOS `.app` bundle.
- The welcome title in `build/installer.nsh`.
- Docs: `README.md`, `DEVELOPMENT.md`, `BUILDING-MACOS.md`, `CONTEXT.md` (the glossary term itself), `docs/release-validation/*.md`, `docs/adr/*`, `THIRD_PARTY_NOTICES.md`, and the title of `.luna/rules.md`.
- Scripts, workflows and tests that name the executable, the `.app` bundle, the uninstaller or the display name.

**Must NOT change:**

- The `userData` folder name. It stays `PokeRogue Offline` under the OS application-data directory on every platform.
- `appId` (`com.gaboopa.pokerogueoffline`).
- Artifact file names: `PokeRogue-Offline-${version}-windows-x64.exe` and `PokeRogue-Offline-${version}-macos-arm64.dmg`, and every regex or check that matches them (`src/retention.mjs`, `src/updater.mjs`, `src/release-contract.mjs`, release-manifest scripts).
- The `app://game` origin, the npm package `name`, the update repository, Backup folder and file names.
- `.luna/packets/*` (historical).
- The phrase "Offline play" and the word "offline" where it describes behaviour rather than the product name.

## Read first

`AGENTS.md`, `CONTEXT.md`, `DEVELOPMENT.md` ("Save compatibility"), `src/constants.mjs`, `src/bootstrap.mjs`, `src/main.mjs`, `package.json` (`build`), `build/installer.nsh`, `scripts/validate-windows-install.ps1`, `docs/release-validation/windows.md`.

## Requirements

### 1. Keep the storage location (the critical part)

Electron derives `userData` from the app name, so renaming the product would silently move every player to an empty folder. Prevent that explicitly:

- Add `STORAGE_DIRECTORY_NAME = "PokeRogue Offline"` to `src/constants.mjs` with a comment saying it is the on-disk folder name and must never change.
- In `src/bootstrap.mjs`, before the first read of `userData` or `sessionData`, set `userData` to `<appData>/<STORAGE_DIRECTORY_NAME>` using `app.getPath("appData")`. The existing `POKEROGUE_R17_TEST_SOURCE` override still wins.
- For the default profile the resolved `userData` and `sessionData` must be exactly the paths today's build produces. Profiles (`src/profiles.mjs`) keep hanging off that root unchanged.
- Put the path derivation in a small pure function so it can be unit-tested without Electron.

### 2. Rename the visible name

Apply the "Changes" list above. For user-visible strings, replace only the product name; the rest of each string stays byte-identical.

### 3. Windows validation script

`scripts/validate-windows-install.ps1` currently uses one variable for both the display name and the application-data folder. Split it: the application-data path keeps `PokeRogue Offline`; the display name, executable, uninstaller and default install folder use the new name. Update `test/validate-windows-install.test.ps1` to match. You cannot run a real install; say so in the report.

### 4. Docs

- `README.md`: one short note near the top — formerly PokéRogue Offline; saves stay where they were; download file names still begin `PokeRogue-Offline`.
- `README.md`, "Install on macOS": the renamed app does not replace an older `PokeRogue Offline` app in Applications; delete the old one after checking the new one opens your saves.
- `DEVELOPMENT.md`, "Save compatibility": state the split — display name versus `STORAGE_DIRECTORY_NAME`, `appId` and artifact names — and that the last three must not change without a tested migration.
- `CONTEXT.md`: rename the glossary term and add "PokeRogue Offline" to its Avoid line, noting it survives only as the storage folder and artifact prefix.

## Tests

- Unit test for the storage path function: given an application-data directory it returns `<that>/PokeRogue Offline` regardless of `PRODUCT_NAME`.
- A test asserting `PRODUCT_NAME !== STORAGE_DIRECTORY_NAME` and that `package.json` `build.appId`, `build.win.artifactName` and `build.mac.artifactName` are unchanged, so a future edit cannot quietly undo the split.
- Update existing tests whose expectations name the executable, bundle or display name. List every changed test file in the report with a one-line reason.
- `npm test` passes.

## Verification to report

- Output of a repository-wide search for `PokeRogue Offline`, `PokéRogue Offline` and `PokeRogue-Offline` after the change, grouped into "intentionally kept" (with the reason) and nothing else.
- Checks you could not run (real Windows install or upgrade, macOS packaging, GitHub workflows) listed as pending, not passed.

## Out of scope

Editing image files (`build/*.bmp`, `*.png`, `*.ico`). Renaming the repository, the npm package, `appId`, artifact files or the storage folder. Any storage migration. Any behaviour change.

## Stop conditions

Stop and report if:

- the default profile's `userData` or `sessionData` path would differ from today's in any way;
- keeping artifact names requires changing how the updater or release contract validates them;
- the single-instance lock would no longer be shared between an old-named and a new-named build.
