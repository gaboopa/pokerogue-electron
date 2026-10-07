# PokéRogue Electron

Play [PokéRogue](https://github.com/pagefaultgames/pokerogue) as a standalone desktop app, with no internet connection required during gameplay.

[Download the latest release](https://github.com/gaboopa/pokerogue-electron/releases/latest)

> [!IMPORTANT]
> This is an unofficial community project. It is not made by, endorsed by, or affiliated with the PokéRogue developers, Nintendo, Game Freak, or The Pokémon Company.

Formerly PokéRogue Offline. Existing saves stay where they are, and download file names still begin with `PokeRogue-Offline`.

## What does this version do?

PokéRogue Electron packages the browser game as a desktop application. The complete game and its assets are installed on your computer, and the game window cannot reach the network.

On top of the game, it adds:

- Backups made automatically before every Update, Restore and cheat change. Each one carries a checksum that is verified before it can be restored.
- Profiles, which keep separate saves, cheat settings and Backups side by side. You can have one for normal play and one for cheats.
- A cheat control center covering money, XP, shinies, IVs, eggs and more.
- Type charts that work offline, plus menu shortcuts that open the wiki, Pokédex and team-building sites in your browser.

New events, Pokémon data and Egg Gacha rotations arrive through new app releases. The app only checks for one when you ask.

There are no online accounts, cloud saves, leaderboards, telemetry, or connections to the official PokéRogue game API.

## Install on Windows

1. Open the [latest release](https://github.com/gaboopa/pokerogue-electron/releases/latest).
2. Download the file ending in `windows-x64.exe`.
3. Open the downloaded installer.
4. Follow the installation prompts, then launch **PokéRogue Electron**.

If PokéRogue Electron is already installed, the installer replaces it. Your saves are stored elsewhere and are kept.

Windows may warn that the publisher is unknown because releases are not code-signed. If you downloaded the installer from this repository's Releases page, choose **More info**, review the filename, and then choose **Run anyway**.

### Windows requirements

- 64-bit Windows 10 or Windows 11
- About 1.5 GB of free disk space during installation

## Install on macOS

The prebuilt macOS DMG is an unsigned, unnotarized Apple Silicon build. Depending on the macOS version, Gatekeeper may reject it as damaged without showing **Open Anyway**. The supported no-cost alternative is to build it locally on the Mac where it will be used.

Follow [BUILDING-MACOS.md](BUILDING-MACOS.md). After installing Node.js 24 and Apple's Command Line Tools, the local build is started with:

```sh
npm run package:mac:local
```

The local command downloads the exact game revision, installs locked dependencies, runs tests, builds an ad-hoc signed Apple Silicon DMG, verifies it, and opens it when complete. The resulting DMG is intended only for the Mac that built it and must not be redistributed.

The renamed app does not replace an older app named `PokeRogue Offline` in Applications. After confirming the new app opens your saves, delete the old app.

### macOS requirements

- Apple Silicon Mac (M1 or newer)
- The macOS version reported by the downloaded app's `LSMinimumSystemVersion`
- About 1.5 GB of free disk space during installation

## Saves and backups

Your saves are stored separately from the installed application, so installing a newer version or reinstalling the app normally keeps your progress.

The **Saves** menu has:

- **Saves › Back Up Saves…** makes a Backup. The app restarts briefly to do it. The Backup's folder name shows when it was requested (UTC) and why (manual, update, restore or cheat).
- **Saves › Restore Backup…** lists your Backups with the date, the reason and the result of an integrity check. **Choose Folder…** restores a Backup kept somewhere else.
- **Saves › Open Save Folder** opens the folder that holds your saves and Backups.

The app keeps the five most recent automatic Backups (those made before an Update, a Restore or a cheat change) and removes older ones at startup. Backups you make yourself are never removed automatically.

A Backup that is incomplete or has been altered fails its integrity check and cannot be restored. The Backup format is described in [DEVELOPMENT.md](DEVELOPMENT.md#backup-format).

PokéRogue's own save export and import still work. Back up important progress before changing computers or removing application data.

### Profiles

Use the **Profiles** menu to create a profile or switch to another one. Each profile has its own saves, cheat settings and Backups. Keybindings are shared. Switching restarts the app.

Your existing saves are the Default profile. Other profiles are stored in a `Profiles` folder inside the Default profile's save folder.

## Cheats

Choose **Cheats › Configure Cheats…** to open the control center, turn on **Enable cheats**, and choose from:

- Economy and progression: minimum money, XP multiplier, extra candy per friendship, no level cap, free shop purchases, free rerolls, free Gacha pulls and instant egg hatching.
- Poké Balls: a minimum number of Poké, Great, Ultra, Rogue and Master Balls.
- Battle and Pokémon: forced battle retries, guaranteed escape, perfect IVs for your Pokémon, guaranteed shinies for your Pokémon or the enemy's, and guaranteed critical hits.

Turning cheats on or off makes a Backup first and then restarts the app. Progress earned with cheats on stays in those saves, so use a separate [profile](#profiles) for cheat play.

## Updating

The app never checks silently. Select **Game › Check for Updates…** on Windows and Linux, or **PokéRogue Electron › Check for Updates…** on macOS.

When an update is available, the app:

1. downloads the installer from this repository's GitHub Releases;
2. verifies its expected size and SHA-256 checksum;
3. backs up your saves;
4. asks before opening the installer.

Download progress is shown on the taskbar or Dock icon. A download that stops receiving data is cancelled so you can retry. Installers for versions you have already installed are removed from the app's Updates folder.

Gameplay remains available if you are offline or GitHub cannot be reached.

## Troubleshooting

When you open an issue, choose **Game › Copy Diagnostic Report** on Windows and Linux, or **PokéRogue Electron › Copy Diagnostic Report** on macOS, then paste the result. It contains no file paths, names or save data.

### Windows says the app is from an unknown publisher

The installer is currently unsigned. Confirm that it came from the [official Releases page for this repository](https://github.com/gaboopa/pokerogue-electron/releases), then use **More info → Run anyway** if you want to continue.

### macOS says the app cannot be opened

The public DMG is intentionally unsigned and unnotarized. Some macOS versions classify it as damaged and do not offer **Open Anyway**. Do not remove quarantine attributes with Terminal commands. For a no-cost build that runs locally, follow [BUILDING-MACOS.md](BUILDING-MACOS.md) and run `npm run package:mac:local` on the Apple Silicon Mac that will use the app.

### My antivirus flags the installer

Unsigned Electron installers can trigger reputation-based warnings. Do not disable your antivirus globally. Confirm the download source and compare the file's SHA-256 checksum with `release-manifest.json` attached to the same release.

In PowerShell, calculate the checksum with:

```powershell
Get-FileHash .\PokeRogue-Offline-*-windows-x64.exe -Algorithm SHA256
```

### Will reinstalling erase my saves?

Normally, no. Saves are kept in your user application-data directory, outside the installation folder. They can still be lost if that data directory is manually deleted or removed by a cleanup program, so keep Backups of progress you care about.

### A Backup restore failed or was interrupted

If a selected Backup is missing or fails verification, the app records the failed request and opens normally with the current Save data. Choose **Choose another Backup** in the recovery message to select a valid Backup. If the app reports that recovery is required, it will not load the game until you inspect the Save folder, the selected Backup, and the safety Backup paths shown in the message. The safety Backup is created before a restore starts.

### Why is an older installer still in my Downloads folder?

After an Update, PokéRogue Electron may offer to move older installers from your Downloads folder to the Recycle Bin (Trash on macOS) the first time you launch the new version. Choose **Keep** to leave them there; the app will not ask again until the next version.

### Why is an event or Egg Gacha rotation different from the online game?

Events and rotations are part of each packaged release. Check for a newer app version. A new upstream change will not appear until it has been reviewed, rebuilt, tested, and published here.

### The update check failed

You can keep playing. Check your connection and try again later, or download the newest installer directly from the Releases page.

## Privacy and security

- Gameplay content loads only from the files installed with the app.
- The game window cannot access websites, WebSockets, official game APIs, popups, or external navigation.
- Only the update check goes online, and only to GitHub's release hosts.
- Updates start only when you ask and are verified before they are opened.
- The app looks only at file names in your Downloads folder that match its own installer names, and moves nothing without asking.

The source code for the wrapper and its update verification is available in this repository for review.

## Developers and contributors

See [DEVELOPMENT.md](DEVELOPMENT.md) for local setup, builds, upstream synchronization, packaging, release manifests, and security requirements.

Issues and contributions are welcome. When reporting a problem, paste the diagnostic report and the steps needed to reproduce it. Never attach private save files unless you have reviewed their contents and intend to share them.

## Credits and licensing

PokéRogue is developed by [Pagefault Games and its contributors](https://github.com/pagefaultgames/pokerogue). This project packages their game as a local desktop application. It is not an official distribution and does not replace the online game.

Packaged releases include the upstream license, credits, REUSE metadata, asset notices, localization notices, and exact source revisions used for the build. Some upstream assets may have no explicit licensing information. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before redistributing a build.
