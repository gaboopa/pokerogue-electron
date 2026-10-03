# macOS release validation

Status: build validation prepared; execution and hands-on QA pending.

The user selected validation-only GitHub Actions on 2026-10-03. The workflow is [.github/workflows/validate-macos.yml](../../.github/workflows/validate-macos.yml). It validates the checked-out update branch with exact upstream pins, locked dependencies, native Electron tests, full upstream-game build, an unsigned arm64 DMG, and a separate local ad-hoc DMG. The existing publication workflow is unchanged.

The macos-15 label uses Apple Silicon for this public repository according to [GitHub's hosted-runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). The package verifier also checks the actual host architecture.

The workflow grants contents-read only and publishes no release assets. Its retained artifact contains the unsigned public-policy DMG, release metadata, and runtime/revision/checksum evidence for seven days. The local ad-hoc DMG remains on its build host and is excluded from retained artifacts.

The YAML was parsed, every shell step passed bash syntax validation, and an independent Luna review found no required issues. These checks do not prove the job executes successfully. Record the run URL, checked commit, actual runtime, and outcomes after it runs.

Pending evidence:

- [ ] Successful native CI test/build and both DMG policy checks.
- [ ] Installed app launch and offline play on a supported Apple Silicon Mac.
- [ ] Dock activation reopens the game with chart/cheat windows retained.
- [ ] Native remapping, Backup recovery, and Update behavior in the packaged upstream game.
- [ ] Replacement upgrade preserves disposable Save data and Local configuration.
- [ ] Actual Gatekeeper/local-versus-public policy and all failures/gaps documented.

GitHub issue #20 stays open until the required native evidence exists. A successful Windows test or an older macOS CI run does not close this gate.
