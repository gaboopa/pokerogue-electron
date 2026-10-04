# Implementation plan for Luna agents

Prepared 2026-10-03 from the supplied PokeRogue Offline repository review.
Verified repository baseline: main at 6626c70. The working tree was clean before planning.
Status: user approved agent dispatch and all updates on 2026-10-03. All nine original correctness tasks, dependency retesting, and atomic Backup publication are integrated. Cold capture, optional cleanup, and native release gates remain open; current assignments and verification appear in progress.md.

Current implementation evidence is recorded in [progress.md](progress.md). The all-updates goal approves the optional queue as well as correctness work.

## Outcome and source

Repair all ten confirmed correctness findings before the next release. They map to nine implementation tickets because findings 1 and 9 require the same download ownership change. Four further tickets cover dependency retesting, Backup consistency research, and native Windows/macOS release validation. Nine optional tickets cover the six simplification recommendations and streaming artifact hashing. S2 and S6 each split into independent module tasks. R11 established restoration evidence but left live-profile filesystem-copy consistency inconclusive; the cold-capture correction is split into R14-R20 and remains a release blocker.

The report is preserved verbatim in [review-report.md](review-report.md). It is historical evidence, not a fresh audit. Its baseline is 55 passing tests despite the reported failures. This planning session inspected code and test entry points but did not rerun tests, build the upstream game, or validate native packages.

Tasks are tracked in GitHub Issues for [gaboopa/pokerogue-electron](https://github.com/gaboopa/pokerogue-electron/issues), as required by AGENTS.md and docs/agents/issue-tracker.md. The issue bodies own acceptance criteria and per-task verification. This document owns sequencing, shared decisions, and checkpoints. There is no tasks/todo.md.

## Working decisions

- Preserve Save data through journaled restore operations. Only an operation that actually changed a directory may roll it back. Retain recovery copies and communicate their paths when restoration cannot complete.
- Validate Backup inventory before touching target data. New integrity checks must cover canonical restore metadata. Keep a strict compatibility reader for valid schemaVersion 1 backups rather than silently changing old checksum semantics.
- Handle failed pending restores through explicit recovery state. If mutation never began or rollback completed, normal startup can continue. If recovery is incomplete, show a recovery path before loading the game.
- Own temporary Update files per invocation and serialize by resolved final destination. Define collision/reuse behavior so the returned file still represents verified bytes. Preserve Release contract, host/redirect validation, and offline play controls.
- Keep src/preload-cheats.cjs as the sandbox-compatible game preload. Test native input through that entry point and a keyCode consumer before removing inactive alternatives.
- Preserve the existing permanent appId, signing distinctions, packaging cache checks, IPC sender validation, and popup/navigation/network policies.
- Save upstream synchronization reports outside staging. .local-build/upstream-reports is already covered by the current ignore policy.
- Verify current official advisories before selecting dependency versions. The report's installed/patched Electron versions are evidence from its review date.
- Resolve optional forwarding-export compatibility through caller evidence. When support for external maintainer tooling is unknown, retain the path and request that information in the ticket.
- Keep correctness fixes and optional behavior-preserving refactors in separate changes. The optional queue does not block release clearance.

## Luna execution contract

Use one Luna agent session per implementation ticket. The user approved dispatch on 2026-10-03. Luna subagents implement the first P1 batch in isolated managed worktrees. Further tasks follow their dependencies and checkpoints.

1. Read the assigned issue, AGENTS.md, CONTEXT.md, and this plan. Read the report section named in the ticket. Confirm the relevant source still matches its evidence.
2. Read dependencies through gh issue view with comments. Claim only an unassigned ticket whose blockers are closed. Native GitHub dependencies are authoritative when available; the issue's Blocked by line is the fallback.
3. Make the reviewed tasks/plan.md and tasks/review-report.md available in each worker checkout before assignment. Planning leaves these files local and uncommitted for review. Create a codex/ branch or an isolated checkout using the repository's Git workflow. Each agent owns one ticket and its named files. Never run two editing agents in the same checkout.
4. Add a behavioral regression that fails on the reported defect, then implement the narrow fix. For reversible local refactors, retain existing behavioral verification rather than write implementation-mirroring tests.
5. Run the ticket's focused checks, then npm test. Record actual commands, exit codes, runtime/platform, and results. A skipped Electron/native check leaves that acceptance criterion pending.
6. Review the change against every acceptance criterion. Deliver one reviewable change with its verification evidence and remaining limitations. Close the issue only after the change is integrated and its criteria are met.

If a ticket exceeds five files, two hours of focused work, or introduces a new independent subsystem, split it and record the new dependency before continuing. A failure to run a required check is a limitation, not a pass.

A reusable assignment prompt:

> Implement GitHub issue #NUMBER for PokeRogue Offline using a Luna agent. Read its dependencies and tasks/plan.md first. Work only within that issue's scope in an isolated checkout. Use disposable Save data and Electron profiles for failure reproductions. Meet each acceptance criterion, run the listed focused verification and npm test, and return a reviewable change with evidence. Record unmet criteria explicitly.

## Ordered task index

### Phase 1, P1 correctness

- [R01 #8, [P1] Preserve save data when restore rollback fails](https://github.com/gaboopa/pokerogue-electron/issues/8). ready-for-agent; blockers none.
- [R02 #9, [P1] Serialize verified Update downloads and clean failed attempts](https://github.com/gaboopa/pokerogue-electron/issues/9). ready-for-agent; blockers none.
- [R03 #10, [P1] Make the shipped keyboard preload deliver usable game input](https://github.com/gaboopa/pokerogue-electron/issues/10). ready-for-agent; blockers none.

### Phase 2, Backup recovery and lifecycle

- [R04 #11, [P2] Validate Backup inventory before restoring save data](https://github.com/gaboopa/pokerogue-electron/issues/11). ready-for-agent; blockers #8.
- [R05 #12, [P2] Recover startup after a pending Backup restore fails](https://github.com/gaboopa/pokerogue-electron/issues/12). ready-for-agent; blockers #8, #11.
- [R06 #13, [P2] Reopen the game on macOS with auxiliary windows alive](https://github.com/gaboopa/pokerogue-electron/issues/13). ready-for-agent; blockers #12.

### Phase 3, synchronization and local configuration

- [R07 #14, [P2] Run upstream synchronization tests without a shell](https://github.com/gaboopa/pokerogue-electron/issues/14). ready-for-agent; blockers none.
- [R08 #15, [P2] Keep upstream synchronization reports after staging](https://github.com/gaboopa/pokerogue-electron/issues/15). ready-for-agent; blockers #14.
- [R09 #16, [P2] Recover malformed cheat documents through the editor](https://github.com/gaboopa/pokerogue-electron/issues/16). ready-for-agent; blockers none.

### Phase 4, dependency and Backup evidence

- [R10 #17, Retest the locked dependency graph before release](https://github.com/gaboopa/pokerogue-electron/issues/17). ready-for-agent; blockers #8, #9, #10, #11, #12, #13, #14, #15, #16.
- [R11 #18, Prove the Backup capture strategy restores Chromium save data](https://github.com/gaboopa/pokerogue-electron/issues/18). ready-for-agent; blockers #8, #11.

### Phase 4b, cold profile capture correction

- [R14 #31, Prove Electron cold-capture exit and profile ownership](https://github.com/gaboopa/pokerogue-electron/issues/31). ready-for-agent; blockers #18.
- [R15 #32, Publish validated backups atomically](https://github.com/gaboopa/pokerogue-electron/issues/32). ready-for-agent; blockers #18.
- [R16 #33, Add a strict one-shot backup intent journal](https://github.com/gaboopa/pokerogue-electron/issues/33). ready-for-agent; blockers #31.
- [R17 #34, Run cold backup capture in an isolated Electron worker mode](https://github.com/gaboopa/pokerogue-electron/issues/34). ready-for-agent; blockers #31, #32, #33.
- [R18 #35, Resume manual and Update backups after cold capture](https://github.com/gaboopa/pokerogue-electron/issues/35). ready-for-agent; blockers #34, #13.
- [R19 #36, Resume restore and cheat operations after cold safety backup](https://github.com/gaboopa/pokerogue-electron/issues/36). ready-for-agent; blockers #35.
- [R20 #37, Clear cold Backup through the packaged Electron application](https://github.com/gaboopa/pokerogue-electron/issues/37). ready-for-agent; blockers #36, #17; blocks #19 and #20.

### Checkpoint: Cold capture proof and integration

- [ ] R14 proves graceful exit/relaunch, source ownership lock, and isolated worker profile; stop the design if any proof fails.
- [ ] The packaged worker never opens a session against the source profile before copying and all three storage directories remain in scope; document Session Storage browsing-context limits precisely.
- [ ] All four Backup call flows resume once after success, fail visibly on cancellation/veto/error/interruption, and do not trust persisted paths or replay operations.
- [ ] R20 passes against the actual packaged app; until then #19/#20 stay blocked by #37.

### Phase 5, native release validation

- [R12 #19, Validate the corrected Windows distributable before release](https://github.com/gaboopa/pokerogue-electron/issues/19). ready-for-human; blockers #17, #18, #30, #37.
- [R13 #20, Validate native macOS behavior before release](https://github.com/gaboopa/pokerogue-electron/issues/20). ready-for-human; blockers #17, #18, #37.

- [V01 #30, Prepare isolated Windows release validation without publishing](https://github.com/gaboopa/pokerogue-electron/issues/30). completed; preparation blockers none. This support task was split from R12 on 2026-10-04; executing the workflow waits for R10/R11.

### Optional queue

- [S01 #21, Remove inactive preloads after verifying the shipped preload](https://github.com/gaboopa/pokerogue-electron/issues/21). ready-for-agent; blockers #17.
- [S02a #22, Import manifest validation directly from the Release contract](https://github.com/gaboopa/pokerogue-electron/issues/22). ready-for-agent; blockers #17.
- [S02b #23, Remove forwarding exports from Windows packaging](https://github.com/gaboopa/pokerogue-electron/issues/23). ready-for-agent; blockers #17.
- [S03 #24, Return a filtered artifact list from manifest merging](https://github.com/gaboopa/pokerogue-electron/issues/24). ready-for-agent; blockers #17.
- [S04 #25, State shared development packaging settings once](https://github.com/gaboopa/pokerogue-electron/issues/25). ready-for-agent; blockers #17.
- [S05 #26, Derive cheat boolean keys from typed defaults](https://github.com/gaboopa/pokerogue-electron/issues/26). ready-for-agent; blockers #17.
- [S06a #27, Expand cheat editor handlers into ordered statements](https://github.com/gaboopa/pokerogue-electron/issues/27). ready-for-agent; blockers #17.
- [S06b #28, Expand keymap creation error handling](https://github.com/gaboopa/pokerogue-electron/issues/28). ready-for-agent; blockers #17.
- [P01 #29, Stream release artifact hashing instead of buffering it](https://github.com/gaboopa/pokerogue-electron/issues/29). ready-for-agent; blockers #17.

## Dependencies and ownership

The primary chains are R01 -> R04 -> R05 -> R06 and R07 -> R08. R10 waits for R01 through R09. R11 waits for R01 and R04. The cold-capture chain is R14/R15 after R11, R16 after R14, R17 after R14-R16, R18 after R17 and R06, R19 after R18, and R20 after R19 and R10. R20 blocks both R12 and R13 in addition to their existing R10/R11 blockers. Optional tickets wait for R10 and may then be selected independently.

- R01, R02, and R03 can run concurrently in isolated checkouts. They are the three P1 slices.
- R04 follows R01. R05 follows R04. R06 follows R05. This also serializes src/main.mjs ownership.
- R07/R08 can progress independently of runtime fixes but must be sequential with each other because they share the synchronization script/test.
- R09 is independent of the initial runtime and build-script chains.
- R11 can start after R04 and run alongside R05/R06 and remaining independent fixes. Keep its storage probe helper separate from R03's keyboard helper.
- R10 changes the locked runtime after regression coverage exists. All agents rebase onto its integrated changes before reporting final runtime validation.
- R12 and R13 can run on separate native hosts once their blockers are satisfied.
- Optional S02a/S03/P01 share release-manifest-lib.mjs. Optional S02b/S04 share package-win.mjs. Run each shared-file group serially if selected. Other optional tasks can run concurrently in isolated checkouts.
- Do not weaken or bypass a dependency to mark a ticket complete. If R11 identifies an unsafe capture strategy, create the bounded follow-up and add it as a blocker to both native release tickets.

Recommended dispatch batches: R01/R02/R03, then R04 plus R07/R09, then R05/R08/R11, then R06, then R10, then R12/R13. The concurrency limit is three worker agents when a coordinating agent occupies the fourth slot. This is scheduling guidance, not authorization to dispatch.

## Checkpoints

### After R01 through R03

- [x] The overlapping download reproduction hashes the returned file and rejects same-size corruption.
- [x] Fault-injected restore tests compare original bytes and retain recovery data when rollback fails.
- [x] Native input through the active preload drives a numeric-keyCode consumer.
- [x] Integrated npm test passes; record actual count, not the historical 55.

### After R04 through R06

- [x] Valid historical backups still restore under the documented compatibility policy; malformed inventories and corruption fail before mutation.
- [x] Two failed-startup attempts recover without an endless pending marker or loading partially restored Save data.
- [x] Behavioral lifecycle tests reopen the game with auxiliary windows alive and guard destroyed-window callbacks.
- [x] Integrated npm test passes. Confirm existing staged resources remain usable with npm run run:packaged and an isolated profile when they are present.

### After R07 through R09

- [x] Synchronization validation runs with executable/repository paths containing spaces and without a shell.
- [x] The actual report-and-stage sequence preserves its review report.
- [x] Editor load and Reset to Vanilla can repair null local configuration.
- [x] Integrated npm test passes. Do not run synchronization against the real upstream checkout merely to verify fixture coverage.

### After R10 and R11

- [ ] The locked graph installs cleanly; current audit evidence includes explicit remaining advisory deferrals.
- [ ] Native keyboard coverage runs under the resolved Electron version; Windows smoke packaging passes.
- [ ] Backup capture has supported evidence, or a corrective follow-up remains an explicit release blocker.
- [ ] Integrated npm test passes. Build the upstream game during native platform validation rather than count smoke packaging as a distributable build.

### After R12 and R13

- [ ] Full upstream-game build and release packaging have actual native evidence for both supported platforms.
- [ ] Windows install/upgrade/uninstall and macOS DMG/Dock scenarios pass with disposable data.
- [ ] Artifact hashes, source revisions, Release contract validation, and local/public macOS policy are recorded.
- [ ] Every required ticket and any R11 corrective follow-up is complete.
- [ ] A human reviews the evidence before publishing a release.

### Optional queue checkpoints

If selected, review S01/S02a/S02b after their changes integrate, then S03/S04/S05, then S06a/S06b/P01. After each group, run the affected focused checks and npm test. Revalidate the keyboard probe after preload removal and packaging/manifest policies after release-script edits. Optional evidence does not replace the required native release checkpoint.

## Coverage of the report

| Report item | Ticket |
| --- | --- |
| 1, concurrent download integrity | R02 |
| 2, destructive restore rollback | R01 |
| 3, remapping keyCode mismatch | R03 |
| 4, failed pending restore startup loop | R05 |
| 5, inconsistent restore inventory | R04 |
| 6, macOS game reopening/destroyed callbacks | R06 |
| 7, Windows Node executable path | R07 |
| 8, synchronization report deletion | R08 |
| 9, interrupted partial-file cleanup | R02 |
| 10, null cheat document | R09 |
| Audit/dependency retesting | R10 |
| Live-database capture uncertainty | R11; corrective cold-capture path R14-R20 |
| Missing native Windows/macOS validation | R12, R13 |
| S1, inactive preloads | S01 |
| S2, forwarding release helpers | S02a, S02b |
| S3, artifact merge list | S03 |
| S4, development package settings | S04 |
| S5, boolean cheat keys | S05 |
| S6, compressed handlers | S06a, S06b |
| Optional streaming artifact hashing | P01 |

## Risks and decisions still requiring evidence

| Risk | Mitigation or completion condition |
| --- | --- |
| Rollback itself fails after disk or permission errors | R01 retains originals; R05 opens recovery instead of loading partially restored data. |
| Format changes reject historical backups | R04 uses explicit versioning and tested v1 compatibility. |
| A later download overwrites a previously returned path | R02 must test both corrupted overlap and valid conflicting same-basename artifacts; serialization alone is insufficient without a collision policy. |
| A checksum-valid live copy is not a usable database snapshot | R11 restoration evidence remains inconclusive for live profile copying. R14 proves cold process ownership; R17 fails closed if lock/profile isolation fails; R20 blocks native release validation until the packaged flow passes. |
| Unit tests inspect source instead of shipped behavior | Use actual functions/callbacks and native preload input. Preserve useful security assertions while replacing weak behavioral coverage. |
| Official advisories change after the report | R10 verifies current primary sources and records resolved versions and reachability. |
| Native macOS validation cannot run on this Windows workspace | R13 stays ready-for-human until a native host records outcomes; mocks do not close it. |
| Optional export deletion affects outside tooling | Resolve supported callers first; use needs-info when evidence is missing. |
| Shared-file agents overwrite each other | Isolated checkouts, one ticket per session, and serial ownership of named shared-file groups. |

Open decisions are bounded by their tickets: R04 chooses the canonical new checksum format and genuine-empty-snapshot policy; R14 must prove cold process/lock ownership or stop the worker design; R16-R19 define strict intent and continuation behavior; R20 clears the packaged flow; R10 chooses advisory-backed versions; R13 needs a native macOS owner. None of these are answered by the review's historical passing suite.

## Plan validation

Every ticket has a description, at most three acceptance criteria, focused verification, dependencies, likely files, and S/M scope. Checkpoints follow each two-to-three-task phase. The original 22 issue bodies, labels, and 29 native dependency edges were checked after their publication. R14-R20 were subsequently published as #31-#37, each labelled ready-for-agent; their native dependency edges were verified, including R20 blocking both #19 and #20. GitHub holds task status and dependency state. No pre-existing incomplete plan was overwritten. Production source, dependencies, upstream checkout, and real Save data were not modified by planning.
