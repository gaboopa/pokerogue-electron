# Build on Apple Silicon macOS

The public GitHub macOS DMG is unsigned and unnotarized. Some Macs reject that download as damaged before offering an **Open Anyway** button. A free alternative is to build the app locally on the Mac where it will be used.

This local build does not require an Apple Developer account. It is ad-hoc signed for local use only and must not be redistributed to another Mac.

## One-time prerequisites

- An Apple Silicon Mac (M1 or newer).
- Node.js 24 or newer. For the version used by this repository, download the macOS installer from the [Node.js 24 archive](https://nodejs.org/en/download/archive/v24). Use the ARM64/Apple Silicon installer when one is offered.
- Apple's Command Line Tools. Open the built-in **Terminal** app and run:

  ```sh
  xcode-select --install
  ```

  Accept the installation prompt. This also provides Git; the full Xcode application and Homebrew are not required. See [Apple's Command Line Tools instructions](https://developer.apple.com/documentation/xcode/installing-the-command-line-tools).

## Build version 0.1.4

Run these commands in Terminal. Cloning with Git keeps the source local and lets the builder select the exact game revision used by the release.

```sh
mkdir pokerogue-local
cd pokerogue-local
git clone --branch v0.1.4 https://github.com/gaboopa/pokerogue-electron.git PokeRogue-Electron
cd PokeRogue-Electron
npm run package:mac:local
```

The command automatically downloads the pinned game source and its `assets` and `locales` submodules, installs locked dependencies, runs the wrapper tests, builds the game, creates an Apple Silicon DMG, verifies the mounted contents, and opens the DMG when it finishes.

The output is:

```text
release/local/PokeRogue-Offline-0.1.4-macos-arm64-LOCAL-ONLY-DO-NOT-DISTRIBUTE.dmg
```

Drag **PokeRogue Offline** into **Applications** and launch it from there. Because the app was built on that Mac, it should not require the public-download Gatekeeper exception flow.

To build without opening Finder automatically, use:

```sh
npm run package:mac:local -- --no-open
```

## Important limitations

- The generated DMG is for the Mac that built it. Do not upload it to GitHub Releases or send it to other users.
- The command keeps its managed game checkout in `.local-build/pokerogue` and refuses to overwrite local changes there.
- The build requires several gigabytes of free space and can take time on the first run. Later runs reuse the managed checkout but still verify the pinned revisions.
- This process does not change save data from any existing installation. Back up saves before testing any new build.

## Troubleshooting

Check the prerequisites with:

```sh
node --version
node -p process.arch
git --version
xcode-select -p
```

The expected architecture output is `arm64`. If Node reports `x64`, install the Apple Silicon Node.js package rather than running the Intel package through Rosetta.

If the managed checkout reports local changes, either commit those changes or move `.local-build/pokerogue` aside and run the command again. The builder will recreate that directory.