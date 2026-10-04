# Update progress

Goal: complete all updates in tasks/plan.md. The user authorized Luna dispatch and selected validation-only GitHub Actions for macOS builds.

Primary integration branch: codex/offline-review-updates.
Latest combined verification: npm test, 97 passed, 0 failed, 0 skipped on Windows x64 with Node v24.18.0 and Electron 42.7.1.
This is not native release clearance.

| Task | Current evidence |
| --- | --- |
| R01 #8 | Reviewed, mutation detected, integrated fcc0611, issue closed |
| R02 #9 | Reviewed, mutation detected, integrated 8b58dfd, issue closed |
| R03 #10 | Reviewed, numeric-keyCode mutation detected, integrated ae2d50b and 35a0173; portable native harness; issue closed |
| R04 #11 | Reviewed, corruption mutation detected, integrated cc45657; v1 compatibility and v2 framed integrity tested; issue closed |
| R05 #12 | Reviewed, startup-ready mutation detected, integrated b620237, 8816019, ae1ee0a, 3f4a0d7; fail-closed recovery and two-launch no-replay tested; issue closed |
| R06 #13 | Claimed and dispatched to startup_recovery_resume in window-lifecycle-r06 after R05 integration |
| R07 #14 | Reviewed, integrated d5849a2, Windows spaced-path fixture verified; issue closed |
| R08 #15 | Reviewed, old-location mutation detected, integrated e07fd6c; actual staging and failure branches tested; issue closed |
| R09 #16 | Reviewed, shape-guard mutation detected, integrated 25b763a, issue closed |
| R10 #17 | Dependency review waits for remaining correctness fixes |
| R11 #18 | Native eight-round probe reviewed and integrated c8fd131; exact staged-source restoration passed, general live capture remains inconclusive; capture follow-up design in progress, issue remains open |
| R12 #19 | Windows native release validation pending; V01 #30 preparation reviewed and integrated 1b09aef/6661b0e, support issue closed |
| R13 #20 | Validation-only workflow prepared and reviewed; CI execution and hands-on Mac QA pending |
| S01, S02a, S02b, S03, S04, S05, S06a, S06b, P01 | Approved by all-updates goal; wait for R10 |

Current Luna assignments: startup_recovery_resume handles R06 in window-lifecycle-r06; durable_reports_resume completed V01 #30; backup_consistency_resume is investigating the bounded capture follow-up to R11. Each assignment uses its named isolated worktree and branch. Read current agent/tool status and Git state before assuming a worker remains live.

Review evidence: restore/download/keyboard/cheat guard mutations failed their regression suites and original bytes were restored. Inventory corruption rejection was independently exercised through the worker's disposable mutated module. Combined tests run on integrated code.

No release was published. Native macOS Dock, Gatekeeper, and upgrade results remain unverified. The new CI workflow has contents-read permissions, no release publication job, and retains unsigned public-policy artifacts separately from local-only ad-hoc output.

Interruption check, 2026-10-04: no child agents are live. The primary checkout is clean and all six integrated correctness fixes remain committed. Partial worker edits are preserved in their isolated worktrees. Usage is available again. The macOS workflow has not been pushed or run. The prior full-build process handle no longer exists; Vite reported completion and staged revisions/index outputs exist, but the command's final exit result was not retained, so complete build validation needs fresh evidence.

Resumed 2026-10-04: three new Luna agents own the preserved R05/R08/R11 worktrees. A fresh full-game build is running with its complete output retained in .local-build/luna-plan/full-game-build.log.

Full upstream-game build, 2026-10-04: npm run build:game exited 0; output retained in .local-build/luna-plan/full-game-build.log. Staged exact game ae6a29a0755743a72f928ac8e3adfd00ec6e01f0, assets 909b43612324622608023b3beb2f24f4ef159c1d, locales c2f9c794ce17f1445d14357a4995353447e9df55. Integrated npm test after R08 passed 77/77 with no skips.

R11 diagnostic interruption: an incorrectly escaped generated temporary launcher showed a native main-process error dialog. The worker terminated its identified launcher processes and removed that wrapper; root's scoped process check found none remaining. Disposable test profiles were used. The probe has explicit failure handlers and is being corrected before further validation. This is not accepted Backup-consistency evidence.

Checkpoint, 2026-10-04: corrected native storage probe passed eight capture/restore rounds without the temporary-launcher error. Its report distinguishes staged source values from filesystem consistency and does not clear release gates. Independent Windows workflow preparation review parsed all seven PowerShell run blocks, the installer helper, and embedded manifest JavaScript; local invocation refused before accessing installations. No installer ran on this machine.

The fresh staged-game probe imported the actual main module, used an isolated profile below .local-build/luna-plan/staged-profiles, loaded app://game/index.html, and reached the visible welcome dialogue in a captured frame. It exited 0 with one game window and no main-frame load failures. This establishes staged startup only; installed offline gameplay remains pending.
