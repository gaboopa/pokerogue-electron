# Development guide

This document covers development and release maintenance for PokéRogue Offline. Players looking to install the app should start with [README.md](README.md).

## Repository layout

The default Windows development layout is:

```text
C:\dev\PokeRogue-Offline\pokerogue  # upstream-derived game repository
C:\dev\PokeRogue-Electron           # Electron wrapper
```

Set `POKEROGUE_GAME_PATH` to use a different game checkout. Set `POKEROGUE_UPDATE_REPOSITORY` to the GitHub `owner/repository` that publishes releases; the default is `gaboopa/pokerogue-electron`.

## Requirements

- Node.js 24 or later
- The game repository's pinned pnpm version and installed dependencies
- Populated `assets` and `locales` game submodules
- Windows x64 for Windows packaging
- Apple Silicon macOS for ARM64 DMG packaging

Install wrapper dependencies with:

```sh
npm install
```

## Commands

- `npm run dev` — build the game in Vite app mode and launch Electron.
- `npm run build:game` — stage the renderer, licenses, and exact source revisions.
- `npm run run:packaged` — launch the staged production renderer.
- `npm test` — run protocol, updater, and save-backup tests.
- `npm run package:win` — create an unsigned Windows x64 NSIS installer.
- `npm run package:mac` — create an unsigned Apple Silicon DMG.
- `npm run sync:upstream` — perform guarded synchronization with `upstream/beta`.
- `npm run release:manifest -- <artifact> <download-url> <windows|macos> <x64|arm64>` — generate checksummed release metadata.

## Upstream synchronization

`sync:upstream` refuses to run unless the game and wrapper worktrees are clean. It:

1. fetches `pagefaultgames/pokerogue` branch `beta`;
2. creates `backup/pre-upstream-*` and `updates/upstream-*` branches;
3. reports changes to events, eggs, Gacha logic, species, saves, APIs, build files, assets, and locales;
4. merges normally without resetting or rebasing away fork changes;
5. updates the referenced submodules;
6. runs typechecking, tests, the app build, and wrapper tests.

The command never pushes, tags, publishes, or merges the update branch into the release branch. Resolve any merge conflict on the generated update branch, review `staging/upstream-reports`, and repeat validation before accepting it.

Manual validation commands on Windows:

```powershell
Set-Location C:\dev\PokeRogue-Offline\pokerogue
node .\node_modules\typescript\bin\tsc --noEmit
node .\node_modules\vitest\vitest.mjs run --silent=passed-only

Set-Location C:\dev\PokeRogue-Electron
npm test
npm run build:game
```

Smoke-test events, legendary Egg Gacha rotation, existing and new saves, backup and restore, audio, localization, keyboard and controller input, resizing, fullscreen, suspend and resume, relaunch, and install-over-install persistence.

## Packaging

The Vite app build is copied into `staging/game` and its service worker is removed. Electron loads that content through the stable `app://game` origin. Large game files are packaged as read-only external resources instead of inside `app.asar`.

Each build records exact game, asset, and locale revisions in `staging/revisions.json`. Applicable upstream license and attribution files are staged under `staging/licenses`.

Windows releases are unsigned x64 NSIS installers. macOS releases are configured as unsigned Apple Silicon DMGs and must be built and tested on Apple Silicon macOS.

## Release manifests

Upload the installer and `release-manifest.json` to the same GitHub release. The manifest binds each artifact to:

- semantic app version;
- operating system and architecture;
- exact byte size;
- SHA-256 checksum;
- download URL;
- exact game, asset, and locale revisions.

Example:

```powershell
npm run release:manifest -- `
  .\release\PokeRogue-Offline-0.1.0-windows-x64.exe `
  https://github.com/gaboopa/pokerogue-electron/releases/download/v0.1.0/PokeRogue-Offline-0.1.0-windows-x64.exe `
  windows x64
```

Never alter an installer after generating its manifest. Regenerate the manifest whenever the artifact changes.

## Save compatibility

Do not change the application ID (`com.gaboopa.pokerogueoffline`), product name, Electron `userData` location, or `app://game` origin after release without implementing and testing a storage migration.

The NSIS uninstaller preserves application data. Native backups include Chromium local storage, IndexedDB, and session storage, carry a deterministic checksum, and restore transactionally with rollback.

## Security invariants

- Renderer sandboxing and context isolation remain enabled.
- Node integration remains disabled.
- Renderer HTTP, HTTPS, WebSocket, popups, external navigation, and permission requests remain blocked.
- No arbitrary filesystem, process, shell, command, or network bridge is exposed to game code.
- Only explicitly initiated update checks may use the network.
- Update URLs remain HTTPS-only and restricted to approved GitHub hosts.
- Every redirect, release manifest, artifact platform, architecture, size, and checksum is validated.
- The updater never downloads or executes arbitrary upstream source code.

Changes weakening any invariant require explicit security review and corresponding tests.
