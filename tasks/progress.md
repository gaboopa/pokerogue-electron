# Update progress

Goal: complete all updates in tasks/plan.md. The user authorized Luna dispatch and selected validation-only GitHub Actions for macOS builds.

Primary integration branch: codex/offline-review-updates.
Latest combined verification: npm test, 104 passed, 0 failed, 0 skipped on Windows x64 with Node v24.18.0 and Electron 42.7.1.
This is not native release clearance.

| Task | Current evidence |
| --- | --- |
| R01 #8 | Reviewed, mutation detected, integrated fcc0611, issue closed |
| R02 #9 | Reviewed, mutation detected, integrated 8b58dfd, issue closed |
| R03 #10 | Reviewed, numeric-keyCode mutation detected, integrated ae2d50b and 35a0173; portable native harness; issue closed |
| R04 #11 | Reviewed, corruption mutation detected, integrated cc45657; v1 compatibility and v2 framed integrity tested; issue closed |
| R05 #12 | Reviewed, startup-ready mutation detected, integrated b620237, 8816019, ae1ee0a, 3f4a0d7; fail-closed recovery and two-launch no-replay tested; issue closed |
| R06 #13 | Reviewed, all-window gate mutation detected, integrated 98136ee; instance-bound callbacks and delayed keymap race verified; issue closed |
| R07 #14 | Reviewed, integrated d5849a2, Windows spaced-path fixture verified; issue closed |
| R08 #15 | Reviewed, old-location mutation detected, integrated e07fd6c; actual staging and failure branches tested; issue closed |
| R09 #16 | Reviewed, shape-guard mutation detected, integrated 25b763a, issue closed |
| R10 #17 | Claimed/dispatched to durable_reports_resume in dependency-retest-r10; own clean install and advisory-backed lock update in progress |
| R11 #18 | Research reviewed and integrated c8fd131/ae6e724; eight-round exact-source restoration passed, general live capture remains inconclusive; investigation issue closed, corrective #31-#37 keep release blocked |
| R12 #19 | Windows native release validation pending; V01 #30 preparation reviewed and integrated 1b09aef/6661b0e, support issue closed |
| R13 #20 | Validation-only workflow prepared and reviewed; CI execution and hands-on Mac QA pending |
| S01, S02a, S02b, S03, S04, S05, S06a, S06b, P01 | Approved by all-updates goal; wait for R10 |

Current Luna assignments: startup_recovery_resume handles R15 #32 in atomic-backup-r15; durable_reports_resume handles R10 #17 in dependency-retest-r10 with its own installed dependencies; backup_consistency_resume handles R14 #31 in cold-capture-proof-r14. Each assignment uses its named isolated worktree and branch. Read current agent/tool status and Git state before assuming a worker remains live.

Review evidence: restore/download/keyboard/cheat guard mutations failed their regression suites and original bytes were restored. Inventory corruption rejection was independently exercised through the worker's disposable mutated module. Combined tests run on integrated code.

No release was published. Native macOS Dock, Gatekeeper, and upgrade results remain unverified. The new CI workflow has contents-read permissions, no release publication job, and retains unsigned public-policy artifacts separately from local-only ad-hoc output.

Interruption check, 2026-10-04: no child agents are live. The primary checkout is clean and all six integrated correctness fixes remain committed. Partial worker edits are preserved in their isolated worktrees. Usage is available again. The macOS workflow has not been pushed or run. The prior full-build process handle no longer exists; Vite reported completion and staged revisions/index outputs exist, but the command's final exit result was not retained, so complete build validation needs fresh evidence.

Resumed 2026-10-04: three new Luna agents own the preserved R05/R08/R11 worktrees. A fresh full-game build is running with its complete output retained in .local-build/luna-plan/full-game-build.log.

Full upstream-game build, 2026-10-04: npm run build:game exited 0; output retained in .local-build/luna-plan/full-game-build.log. Staged exact game ae6a29a0755743a72f928ac8e3adfd00ec6e01f0, assets 909b43612324622608023b3beb2f24f4ef159c1d, locales c2f9c794ce17f1445d14357a4995353447e9df55. Integrated npm test after R08 passed 77/77 with no skips.

R11 diagnostic interruption: an incorrectly escaped generated temporary launcher showed a native main-process error dialog. The worker terminated its identified launcher processes and removed that wrapper; root's scoped process check found none remaining. Disposable test profiles were used. The probe has explicit failure handlers and is being corrected before further validation. This is not accepted Backup-consistency evidence.

Checkpoint, 2026-10-04: corrected native storage probe passed eight capture/restore rounds without the temporary-launcher error. Its report distinguishes staged source values from filesystem consistency and does not clear release gates. Independent Windows workflow preparation review parsed all seven PowerShell run blocks, the installer helper, and embedded manifest JavaScript; local invocation refused before accessing installations. No installer ran on this machine.

The fresh staged-game probe imported the actual main module, used an isolated profile below .local-build/luna-plan/staged-profiles, loaded app://game/index.html, and reached the visible welcome dialogue in a captured frame. It exited 0 with one game window and no main-frame load failures. This establishes staged startup only; installed offline gameplay remains pending.

Cold-capture correction, 2026-10-04: GitHub #31-#37 are published with native dependency edges. The root independently checked the chain and #37 blocking both #19/#20; existing #30 support edge is retained. First prove graceful process exit and source ownership while the worker runtime switches profile; do not implement the worker if that proof fails. Atomic publication can run independently. The remaining slices add a strict one-shot journal, same-executable worker, manual/Update and restore/cheat continuations, then actual packaged validation. All three storage directories remain in scope; copied Session Storage does not promise hydration into a different browsing context. Source data and captured-directory scope are not narrowed to make the gate pass.

Dependency and publication checkpoint, 2026-10-04: R15 integrated as cebdf0c, with concurrency fixture cleanup in 8127924. Unique temporary sibling capture, manifest/inventory validation, and same-root publication preserve prior Backups and report retained stages on cleanup failure. Independent removal of validation before publication failed its injected-validation regression; original bytes restored and focused Backup tests passed 24/24. [Issue #32 is closed](https://github.com/gaboopa/pokerogue-electron/issues/32#issuecomment-5982628745). This does not clear cold capture.

R10 integrated as be26b9c and 8c29e6f, with readiness wording corrected in 430eccc. Primary clean npm ci exited 0; its FIRST npm test resolved Electron serially and passed 113/113 with zero skips on Windows x64, Node 24.18.0, Electron 42.11.10. Electron-builder is 26.17.0 and the exact Electron allowScripts policy is retained. Audit exit 1 reflects one remaining high build-only dependency advisory, explicitly deferred in docs/security/dependency-review.md; the worker's actual smoke app.asar excludes it. Worker NSIS smoke packaging passed without executing an installer. [Issue #17 is closed](https://github.com/gaboopa/pokerogue-electron/issues/17#issuecomment-5982629109). Root logs are ignored under .local-build/luna-plan.

Luna agents now own S01 #21 and S05 #26 on clean branches from 430eccc in the reusable atomic-backup and dependency worktrees. Their native GitHub dependency summaries have zero open blockers. R14 #31 remains active in the cold-capture worktree. Its drafted native proof encounters a pre-JavaScript argv launch failure while known-good keyboard/storage checks pass from the same worktree; the agent is isolating the argument shape before proceeding. R16-R20 remain gated by the actual cold proof and its dependent implementations. Forwarding-export compatibility clarification is pending; independent cleanup proceeds. Prepared platform workflows have not been pushed/run, and hands-on native QA remains pending. No release is published.

Optional checkpoint, 2026-10-04: S01 integrated as 4ee21e7 after caller and native-preload evidence; three unused ES module preloads removed, active CJS entries and keybindings parser retained. S05 integrated as fec5d74, deriving twelve boolean keys from neutral defaults with accepted-value/type-fallback coverage. Root combined npm test passed 114/114 with zero skips on Electron 42.11.10. [#21](https://github.com/gaboopa/pokerogue-electron/issues/21#issuecomment-5982682700) and [#26](https://github.com/gaboopa/pokerogue-electron/issues/26#issuecomment-5982682992) are closed. The same Luna sessions now own S03 #24 and S06a #27 on clean branches from fec5d74. S03 retains forwarding exports while compatibility clarification is pending; no concurrent manifest-library edits are assigned.

R14 draft proof passed three actual-Electron rounds after separating application argv with -- and moving the loopback origin to a dedicated environment variable. Source process exit, separate userData/sessionData, competing launch refusal, restored Local Storage/IndexedDB and invalidated vetoed intent were observed. Review requires earliest-worker-PID registration and an explicit refused-worker case before integration; no ownership release gate is claimed yet.

Cold handoff checkpoint, 2026-10-04: R14 integrated as b084d9d after the required cleanup/worker-refusal follow-up. Three actual-Electron rounds prove source exit before copy, both runtime paths/default session storage isolated, real worker LevelDB files confined, normal/worker lock refusal before access, and restored source values without worker-only data. A vetoed request is invalidated before a later queued relaunch can copy. Early per-PID markers register workers before readiness/result waits; exited child handles leave cleanup ownership. [#31 is closed](https://github.com/gaboopa/pokerogue-electron/issues/31#issuecomment-5982774289). This is a Windows prototype proof, with Session Storage/context and synthetic IndexedDB limits retained. Production worker, packaged app and macOS gates remain open.

S03 integrated as 0c42c02 with its actual 24-case merge policy/identity matrix; [#24 is closed](https://github.com/gaboopa/pokerogue-electron/issues/24#issuecomment-5982734286). S06a integrated as d2b356f; actual editor HTML/renderer/active sandboxed preload passed preset, cancellation, error/busy cleanup, recovery and close checks with mocked IPC and verified disposable userData/sessionData/default-session containment; [#27 is closed](https://github.com/gaboopa/pokerogue-electron/issues/27#issuecomment-5982774660). Root combined npm test passed 116/116, zero skips, on Electron 42.11.10. Native cold evidence records Windows x64 OS 10.0.26200, Chromium 148.0.7778.280 and embedded Node 24.19.0; parent Node is 24.18.0.

Current Luna ownership: R16 #33 in codex/backup-intent-r16 at the reused cold-capture worktree; S06b #28 in codex/keymap-errors-s06b at the reused atomic-backup worktree; P01 #29 in codex/stream-artifact-p01 at the reused dependency worktree. Forwarding-export clarification is still pending and current imports remain compatible. CI workflows remain prepared but not pushed/run. No release is published.
