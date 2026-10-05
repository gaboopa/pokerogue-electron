# macOS release validation

Status: native build validation passed; hands-on QA pending.

The user selected validation-only GitHub Actions on 2026-10-03. The workflow is [.github/workflows/validate-macos.yml](../../.github/workflows/validate-macos.yml). It validates the checked-out update branch with exact upstream pins, locked dependencies, native Electron tests, full upstream-game build, an unsigned arm64 DMG, and a separate local ad-hoc DMG. The existing publication workflow is unchanged.

The macos-15 label uses Apple Silicon for this public repository according to [GitHub's hosted-runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). The package verifier also checks the actual host architecture.

The workflow grants contents-read only and publishes no release assets. Its retained artifact contains the unsigned public-policy DMG, release metadata, and runtime/revision/checksum evidence for seven days. The local ad-hoc DMG remains on its build host and is excluded from retained artifacts.

Final native [run 37337442155](https://github.com/gaboopa/pokerogue-electron/actions/runs/37337442155) passed on 2026-10-05 at `dccf62f2d39dcc78d7bcb6a3d2b32ff64324644c`. All 155 tests passed without skips on macOS 15.7.9 (24G830), arm64, Node 24.20.0, Electron 42.11.10, Chromium 148.0.7778.280, and embedded Node 24.19.0. The exact pinned game built, the unsigned DMG mounted and passed verification, and the separate local ad-hoc DMG passed its own verification. Both DMGs retain minimum macOS 12.0. The retained artifact contains the actual release manifest, checksums, and host/revision evidence; no release was published.

The unsigned `PokeRogue-Offline-0.1.4-macos-arm64.dmg` is 1,096,829,455 bytes, SHA-256 `6bca389471ba69a811e2d35676943b4bf2c4a3eb0459c42e3e3ca13255c78a37`. Exact upstream revisions: game `ae6a29a0755743a72f928ac8e3adfd00ec6e01f0`, assets `909b43612324622608023b3beb2f24f4ef159c1d`, locales `c2f9c794ce17f1445d14357a4995353447e9df55`. The compact `macos-evidence-dccf62f2d39dcc78d7bcb6a3d2b32ff64324644c` artifact was downloaded and its recorded commit, pins, manifest, and checksum inspected independently.

The native run caught two earlier validation failures: a test temporary path needed macOS realpath normalization, and the local signer exhausted descriptors scanning the game resources. Raising the shell limit alone did not fix the latter. The build now preloads already installed `graceful-fs` for the signing process, with a runnable forced-exhaustion check that fails without the hook. No application runtime dependency or signing policy was changed.

Pending evidence:

- [x] Successful native CI test/build and both DMG policy checks.
- [ ] Installed app launch and offline play on a supported Apple Silicon Mac.
- [ ] Dock activation reopens the game with chart/cheat windows retained.
- [ ] Native remapping, Backup recovery, and Update behavior in the packaged upstream game.
- [ ] Replacement upgrade preserves disposable Save data and Local configuration.
- [ ] Actual Gatekeeper/local-versus-public policy and all failures/gaps documented.

GitHub issue #20 stays open until the required native evidence exists. A successful Windows test or an older macOS CI run does not close this gate.
