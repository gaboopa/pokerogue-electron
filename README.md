# PokeRogue Offline Electron

A private Electron wrapper for the upstream PokeRogue browser game. Gameplay is local-only. The renderer cannot access HTTP, HTTPS, WebSocket, authentication, cloud-save, leaderboard, or telemetry services. Network access exists only in the Electron main process when the user explicitly chooses **Check for Updates**.

## Repository layout

The default development layout is:

```text
C:\dev\PokeRogue-Offline\pokerogue  # game fork and its assets/locales submodules
C:\dev\PokeRogue-Electron           # this wrapper
```

Set `POKEROGUE_GAME_PATH` to use another game checkout. Set `POKEROGUE_UPDATE_REPOSITORY` to the GitHub `owner/repository` that publishes wrapper releases; the default is `gaboopa/pokerogue-electron`.

## Requirements

- Node.js 24 or later
- The game repository's pinned pnpm version and installed dependencies
- Windows x64 for Windows packaging
- Apple Silicon macOS for unsigned ARM64 DMG packaging

Install wrapper dependencies with `npm install`. The wrapper never runs an online game backend.

## Commands

- `npm run dev` — build the game in Vite app mode and launch Electron.
- `npm run build:game` — stage the renderer, licenses, and exact source revisions.
- `npm run run:packaged` — launch the staged renderer.
- `npm run test` — run protocol, updater, and save-backup tests.
- `npm run package:win` — create an unsigned Windows x64 NSIS installer.
- `npm run package:mac` — create an unsigned Apple Silicon DMG.
- `npm run sync:upstream` — create safety branches, merge `upstream/beta`, update submodules, report watched changes, and validate the result.
- `npm run release:manifest -- <artifact> <download-url> <windows|macos> <x64|arm64>` — generate `release/release-manifest.json`.

## Upstream synchronization

`sync:upstream` refuses to run unless both repositories are clean. It creates `backup/pre-upstream-*` and `updates/upstream-*` branches before merging. It never resets, rebases, pushes, tags, publishes, or merges the update branch into the release branch. On a conflict, resolve it on the update branch and run:

```powershell
Set-Location C:\dev\PokeRogue-Offline\pokerogue
.\node_modules\.bin\tsc.cmd --noEmit
.\node_modules\.bin\vitest.cmd run --silent=passed-only

Set-Location C:\dev\PokeRogue-Electron
npm test
npm run build:game
```

Review `staging/upstream-reports` and smoke-test events, egg rotation, saves, audio, input, and offline behavior before accepting the update branch.

## Release updates

Upload the platform installer and `release-manifest.json` to the same GitHub release. The manifest binds the installer to its SHA-256 checksum, byte size, platform, architecture, and exact game/assets/locales revisions. The app validates all of these values and every redirect host before opening a downloaded installer.

Updates are never checked silently. Windows opens the verified NSIS installer after confirmation. macOS opens the verified DMG; because private builds are unsigned, the user must replace the app and may need to approve it in system security settings. Saves remain in the stable per-user Electron data directory and are backed up before update handoff.

## Save safety

The application menu can back up saves, restore a validated backup, and open the save directory. Backups include only Chromium local storage used by the game, carry a tree checksum, and are restored transactionally with rollback. The NSIS uninstaller is configured not to delete application data.

Do not change the application ID (`com.gaboopa.pokerogueoffline`), product name, or `app://game` origin after releasing builds without adding an explicit storage migration.

## Security invariants

- Renderer sandbox enabled; Node integration disabled; context isolation enabled.
- All game content loads from the privileged `app://game` origin.
- Renderer HTTP(S), WebSockets, popups, navigation, and permissions are denied.
- Update URLs are HTTPS-only and restricted to explicit GitHub hosts.
- No arbitrary filesystem, shell, process, network, or command API is exposed to game code.
- The packaged service worker is removed during staging.

## Manual acceptance checks

Before each private release, test offline startup, new and existing saves, multiple save slots, backup/restore, import/export, events, legendary egg rotation, fonts, audio, localization, keyboard/controller input, resize/fullscreen, suspend/resume, relaunch, and install-over-install persistence on the target operating system.
