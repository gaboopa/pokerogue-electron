# PokéRogue Offline

Play [PokéRogue](https://github.com/pagefaultgames/pokerogue) as a standalone desktop app, with no internet connection required during gameplay.

[Download the latest release](https://github.com/gaboopa/pokerogue-electron/releases/latest)

> [!IMPORTANT]
> This is an unofficial community project. It is not made by, endorsed by, or affiliated with the PokéRogue developers, Nintendo, Game Freak, or The Pokémon Company.

## What does this version do?

PokéRogue Offline packages the browser game as a desktop application. The complete game and its assets are installed on your computer, so you can:

- play without an internet connection;
- keep saves locally on your computer;
- use multiple save slots;
- back up and restore saves from the application menu;
- receive updated events, Pokémon data, and Egg Gacha rotations through new app releases;
- check for app updates manually without connecting gameplay to PokéRogue's servers.

There are no online accounts, cloud saves, leaderboards, telemetry, or connections to the official PokéRogue game API.

## Install on Windows

1. Open the [latest release](https://github.com/gaboopa/pokerogue-electron/releases/latest).
2. Download the file ending in `windows-x64.exe`.
3. Open the downloaded installer.
4. Follow the installation prompts, then launch **PokéRogue Offline**.

If PokéRogue Offline is already installed, the installer detects the existing registered installation and replaces it instead of creating another installed copy. Your saves remain in the separate user-data folder.

Windows may warn that the publisher is unknown because releases are not code-signed. If you downloaded the installer from this repository's Releases page, choose **More info**, review the filename, and then choose **Run anyway**.

### Windows requirements

- 64-bit Windows 10 or Windows 11
- About 1.5 GB of free disk space during installation

## Install on macOS

1. Open the [latest release](https://github.com/gaboopa/pokerogue-electron/releases/latest) on an Apple Silicon Mac (M1 or newer).
2. Download the file ending in `macos-arm64.dmg`.
3. Open the DMG and drag **PokeRogue Offline** into **Applications**.
4. Open the app from Applications.

This first macOS distribution is unsigned and unnotarized. If macOS blocks the first launch, try opening the app once, then open **System Settings -> Privacy & Security**, scroll to Security, choose **Open Anyway**, and confirm. Apple makes this button available for about an hour after the blocked launch. See [Apple's guidance](https://support.apple.com/en-ie/102445).

### macOS requirements

- Apple Silicon Mac (M1 or newer)
- The macOS version reported by the downloaded app's `LSMinimumSystemVersion`
- About 1.5 GB of free disk space during installation

## Saves and backups

Your saves are stored separately from the installed application. Installing a newer version or reinstalling the app normally keeps your progress.

Use the **PokéRogue Offline** application menu to:

- **Back Up Saves** — create a timestamped local backup;
- **Restore Backup** — restore a backup after it passes an integrity check;
- **Open Save Folder** — open the folder containing saves and backups.

The app also retains PokéRogue's save export and import features. Back up important progress before changing computers or removing application data.

## Updating

The app never checks silently. Select **PokéRogue Offline → Check for Updates** when you want to check.

When an update is available, the app:

1. downloads the installer from this repository's GitHub Releases;
2. verifies its expected size and SHA-256 checksum;
3. backs up your saves;
4. asks before opening the installer.

Gameplay remains available if you are offline or GitHub cannot be reached.

## Troubleshooting

### Windows says the app is from an unknown publisher

The installer is currently unsigned. Confirm that it came from the [official Releases page for this repository](https://github.com/gaboopa/pokerogue-electron/releases), then use **More info → Run anyway** if you want to continue.

### macOS says the app cannot be opened

Confirm that the DMG came from this repository's official Releases page. Try opening the app once, then use **System Settings -> Privacy & Security -> Open Anyway**. Do not remove quarantine attributes with Terminal commands.

### My antivirus flags the installer

Unsigned Electron installers can trigger reputation-based warnings. Do not disable your antivirus globally. Confirm the download source and compare the file's SHA-256 checksum with `release-manifest.json` attached to the same release.

In PowerShell, calculate the checksum with:

```powershell
Get-FileHash .\PokeRogue-Offline-*-windows-x64.exe -Algorithm SHA256
```

### Will reinstalling erase my saves?

Normally, no. Saves are kept in your user application-data directory, outside the installation folder. They can still be lost if that data directory is manually deleted or removed by a cleanup program, so keeping backups is recommended.

### Why is an older installer still in my Downloads folder?

Updating replaces the installed application, but it does not delete files you downloaded. You can safely delete older `PokeRogue-Offline-*-windows-x64.exe` files yourself after the newer version is installed and working.

### Why is an event or Egg Gacha rotation different from the online game?

Events and rotations are part of each packaged release. Check for a newer app version. A new upstream change will not appear until it has been reviewed, rebuilt, tested, and published here.

### The update check failed

You can keep playing. Check your connection and try again later, or download the newest installer directly from the Releases page.

## Privacy and security

- Gameplay content loads only from the files installed with the app.
- The game window cannot access websites, WebSockets, official game APIs, popups, or external navigation.
- Update access is isolated to the desktop application's main process and restricted to GitHub release hosts.
- Updates are initiated by the user and verified before they are opened.

The source code for the wrapper and its update verification is available in this repository for review.

## Developers and contributors

See [DEVELOPMENT.md](DEVELOPMENT.md) for local setup, builds, upstream synchronization, packaging, release manifests, and security requirements.

Issues and contributions are welcome. When reporting a problem, include your operating system, app version, and the steps needed to reproduce it. Never attach private save files unless you have reviewed their contents and intend to share them.

## Credits and licensing

PokéRogue is developed by [Pagefault Games and its contributors](https://github.com/pagefaultgames/pokerogue). This wrapper exists to make the upstream game available as a local desktop application and is not a replacement for or official distribution from that team.

Packaged releases include the upstream license, credits, REUSE metadata, asset notices, localization notices, and exact source revisions used for the build. Some upstream assets may have no explicit licensing information. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before redistributing a build.
