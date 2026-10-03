# PokeRogue Offline repository review

Reviewed 2026-10-03, branch `main`, commit `6626c70`. Verdict: request changes before the next release. This review covers tracked desktop code, build scripts, packaging, the macOS publication workflow, documentation, and tests. It does not audit the separate upstream game repository as a whole.

No repository source or real save data was modified. Reproductions used disposable directories, mocked dependencies, and an isolated Electron profile. Three independent reviewers checked desktop integration, Windows packaging, and macOS/update paths under the requested code-review-and-quality skill.

## Required findings

### 1. [P1] Concurrent downloads can return an installer with an invalid checksum

Location: [src/updater.mjs:54](C:/dev/PokeRogue-Electron/src/updater.mjs:54), lines 54-65.

Every invocation removes and recreates the same `.partial` file. Menu and IPC update entry points can overlap. Each invocation hashes its own response stream, but later checks and renames whichever file currently occupies the shared path. A second invocation can therefore replace the file the first invocation promotes.

A deterministic reproduction on Windows streamed `AAAABBBB` through the first invocation and `XXXXXXXX` through the second. The first invocation succeeded, but its returned file contained `XXXXXXXX`. Its expected SHA-256 was `7bf52afd1d2eb936aaa7e54e67ae18b8fb24efb51e7edea259e6571b85614c96`; the file's actual SHA-256 was `aa20840b0e05f36d4588e626f69fbc0dc1356ee7f3a155ea1aa6a8b60eb7088d`.

Give each download an exclusively created temporary file and serialize update operations that target the same final artifact. Ensure the file promoted is the file whose bytes were verified. Add a test with overlapping streams and same-size corrupted content.

### 2. [P1] Failed restore rollback deletes storage it never backed up

Location: [src/backup.mjs:67](C:/dev/PokeRogue-Electron/src/backup.mjs:67), lines 67-69.

The catch block deletes every directory in `manifest.included`, even when an earlier failure prevented that directory from being moved into rollback. Missing rollback copies are then ignored. A failure while copying Local Storage can therefore delete untouched IndexedDB and Session Storage.

With a valid three-directory backup and an injected ENOSPC at the first restore copy, the target retained only Local Storage. The other two storage directories disappeared. A second reproduction against unmodified production functions used a duplicate entry in the manifest, which validation accepts, and removed all three active storage directories after restore failed.

Track which directories were moved and which were replaced. Roll back only completed operations, and keep recovery copies until restoration fully succeeds. Test failures at every move/copy boundary and prove the original target remains intact.

### 3. [P1] Keyboard remapping produces events the game cannot use

Location: [src/preload-cheats.cjs:56](C:/dev/PokeRogue-Electron/src/preload-cheats.cjs:56), lines 56-58.

The active preload creates synthetic KeyboardEvents with `key` and `code`, but without numeric `keyCode`. The upstream game's InputsController consumes `event.keyCode`, while the preload suppresses the original native event.

A hidden Electron 42 probe using the actual preload, a disposable profile, and W-to-ArrowUp mapping received ArrowUp down/up with `keyCode: 0`. Original W events never reached the page. Non-identity mappings therefore suppress input without providing a usable replacement.

Emit the numeric key codes expected by the game or move remapping to an input mechanism the game supports. Test native input through the active preload and an upstream-compatible consumer, rather than only callback tuples in KeyRemapController.

### 4. [P2] A failed pending restore prevents every subsequent startup

Location: [src/main.mjs:98](C:/dev/PokeRogue-Electron/src/main.mjs:98), lines 98-100. Called before window creation at line 189.

If the selected backup becomes missing or invalid between selection and restart, `restoreBackup` rejects. The pending marker remains, and the uncaught startup promise never reaches window creation. Every later launch retries the same failed restore.

Evaluating the actual startup source with mocked Electron and a removed selected backup produced ENOENT and zero windows on two consecutive startup attempts.

Handle restore errors before continuing startup. Preserve recovery information, offer a clear recovery path, and ensure the marker cannot trap the app in an indefinite failed-startup loop.

### 5. [P2] Backup validation accepts an inconsistent restore inventory

Location: [src/backup.mjs:48](C:/dev/PokeRogue-Electron/src/backup.mjs:48), lines 48-51.

Validation checks that each included name belongs to the allowlist, but does not reject duplicates or ensure the listed directories match the actual backup contents. The checksum covers the data tree, so changing `included` does not invalidate it. An empty list can pass and make restore silently do nothing; a duplicate can trigger destructive rollback.

Changing only `included` to `[]` passed validation. Adding a duplicate Local Storage entry also passed validation and then caused restore to fail with EPERM.

Require a unique, consistent directory inventory before any mutation, reject missing or unlisted storage content, and bind the restore metadata to the integrity check. Test malformed but syntactically valid manifests.

### 6. [P2] macOS cannot reopen the game while a chart window remains

Location: [src/main.mjs:204](C:/dev/PokeRogue-Electron/src/main.mjs:204).

Open a chart, close the game window, then click the Dock icon. The activation handler sees the surviving chart in `getAllWindows()` and does not create a game window. The `mainWindow` variable also retains a destroyed object, so View -> Reload can throw.

A mocked evaluation of the actual source confirmed one chart remained alive, the game was not recreated, and Reload threw `Object has been destroyed`.

Clear `mainWindow` on close and make activation depend on the game window's existence. Guard callbacks against destroyed windows.

### 7. [P2] Upstream synchronization validation fails with standard Windows Node paths

Location: [scripts/sync-upstream.mjs:58](C:/dev/PokeRogue-Electron/scripts/sync-upstream.mjs:58).

The final wrapper test command passes `process.execPath` to execFile with `shell: true`. Node concatenates the executable and arguments without escaping. A standard installation at `C:\Program Files\nodejs\node.exe` is interpreted as `C:\Program`.

A direct reproduction returned `'C:\Program' is not recognized as an internal or external command`.

Remove `shell: true` and pass test paths directly. Node 24 can expand the test glob without a shell.

### 8. [P2] A successful upstream synchronization deletes its own review report

Location: [scripts/sync-upstream.mjs:33](C:/dev/PokeRogue-Electron/scripts/sync-upstream.mjs:33). Deletion occurs at [scripts/build-game.mjs:17](C:/dev/PokeRogue-Electron/scripts/build-game.mjs:17).

Synchronization writes its review report under `staging/upstream-reports`, then invokes build-game, which deletes the entire staging directory. The report is gone before the workflow asks the maintainer to review it.

A disposable fixture running the staging script confirmed `reportSurvives: false` and `gameStaged: true`.

Store synchronization reports outside the disposable staging directory, or preserve them explicitly during staging. Test the complete report-and-stage sequence.

### 9. [P2] Interrupted update downloads strand partial files

Location: [src/updater.mjs:59](C:/dev/PokeRogue-Electron/src/updater.mjs:59), lines 59-65.

Cleanup runs only after a completed download fails size/checksum validation. If fetch streaming, disk writing, or promotion fails, the temporary file remains. A failed release download can retain hundreds of megabytes until another attempt at the same artifact.

A mocked response stream error left `app.dmg.partial` in a disposable download directory.

Clean up the invocation's temporary file on every failure, including stream and rename errors. Keep this cleanup compatible with the unique-file fix for finding 1.

### 10. [P2] A null cheat document cannot be repaired through the editor

Location: [src/cheats.mjs:65](C:/dev/PokeRogue-Electron/src/cheats.mjs:65), lines 65-69.

Literal `null` is valid JSON, but reading `stored.config` throws TypeError. The fallback catches only missing files and JSON syntax errors. Editor loading and Reset to Vanilla both call this loader, so neither can repair the file.

A direct disposable-file reproduction confirmed the TypeError.

Validate the parsed document's shape before accessing its properties and use the neutral document for malformed shapes. Cover null and other non-document JSON values.

## Verification and coverage

The full existing suite passed: 55 tests, 0 failures. Focused reviewers also ran desktop, packaging, updater, and macOS release tests. These are not additional unique tests.

A temporary mutation bypassed backup checksum rejection while running the existing backup test against the mutated module. The test still passed. This confirms that the suite currently does not prove corruption rejection. Production source was never changed for this experiment.

Important missing behavioral coverage includes restore rollback failures, malformed backup inventories, interrupted/concurrent download streams, startup recovery, active-preload input integration, and macOS window reopening. Several desktop tests inspect source text or inactive preload modules, so they cannot detect the integration failures above.

## Security and dependencies

Trust boundaries reviewed include renderer IPC, selected backup contents and metadata, downloaded release manifests/artifacts, user configuration files, staged upstream resources, and build commands. Assets at risk are save data, executable update integrity, and local filesystem contents.

Sandboxing, context isolation, popup denial, and gameplay network blocking are present. No arbitrary process or filesystem bridge was found in the game preload. The confirmed update race violates the promised artifact-integrity boundary despite these protections.

`npm audit` reports 14 high-severity affected dependency entries, including transitive propagation. That count is not 14 independent exploitable vulnerabilities. Most entries are in the development/build graph; Electron itself is the shipped runtime despite its devDependency classification.

The installed Electron 42.7.1 is within the affected range of GHSA-gr2m-v5gq-v685. This repo applies the advisory's documented popup-denial mitigation, so that advisory is not reported as a demonstrated exploit here. The patched 42.x version is 42.9.2. Source: [Electron's security advisory](https://github.com/electron/electron/security/advisories/GHSA-gr2m-v5gq-v685).

Update and retest the locked dependency graph before release, or document remaining advisory reachability and deferrals. No automatic dependency changes were made.

## Architecture, readability, and performance

The repository is small, uses focused ES modules, and now shares release validation between publication and updating. These boundaries are understandable. No stylistic nits are included as blockers.

Optional cleanup: the active CommonJS preload duplicates keybinding behavior also present in ES modules, while some tests target inactive preload files. Consolidate the maintained implementation and exercise the shipped preload to reduce drift.

Optional performance improvement: release-manifest generation reads the entire installer into a Buffer before hashing. The local Windows artifact is approximately 618 MB. Use streaming hashing as already done by the updater and benchmark tools.

Backup creation copies live Chromium storage after calling flushStorageData. Electron documents that call as flushing DOMStorage; it is not a general transactional IndexedDB snapshot API. Live-database snapshot consistency was not proven in this review and should be verified before treating checksum validity as proof of a usable database snapshot. Source: [Electron session API](https://www.electronjs.org/docs/latest/api/session#sesflushstoragedata).

## Limits

No full upstream game build, installer build, install/upgrade/uninstall trial, or native macOS DMG execution was performed. macOS lifecycle checks used mocks. The hidden Electron keyboard probe exercised the active preload on Windows. Passing unit tests should not be presented as end-to-end release validation.

## Simplification review

Added 2026-10-03 using the code-simplification skill. These six recommendations are optional improvements to clarity and maintenance. They do not add to the ten required correctness findings above. The source, tests, Git status, and relevant history were inspected; no production refactoring was performed.

### S1. Remove the three inactive preloads and test the shipped implementation

Priority: highest simplification value. Locations: [src/main.mjs:168](C:/dev/PokeRogue-Electron/src/main.mjs:168), [src/preload.mjs](C:/dev/PokeRogue-Electron/src/preload.mjs), [src/preload-keybindings.mjs](C:/dev/PokeRogue-Electron/src/preload-keybindings.mjs), [src/preload-cheats.mjs](C:/dev/PokeRogue-Electron/src/preload-cheats.mjs), and [test/desktop-controls.test.mjs:7](C:/dev/PokeRogue-Electron/test/desktop-controls.test.mjs:7).

The only game preload configured at runtime is preload-cheats.cjs. The other three files total 57 lines and have no runtime callers. One desktop test reads the inactive preload-keybindings.mjs. Keeping these alternate implementations makes it harder to identify what actually ships and lets tests verify the wrong code.

Remove the inactive files and direct relevant tests to the shipped preload. Keep keybindings.mjs: its defaults and parser are used by keymap-store.mjs. The active preload also duplicates the remapping implementation tested in keybindings.mjs. Exercise that actual shipped implementation before deciding whether generating the CommonJS preload from one canonical source is worth extra tooling. Keep the sandbox-compatible CommonJS entry point; replacing it with arbitrary local imports is not a safe simplification.

This cleanup can accompany verification of the keyboard fix, but deletion alone does not repair keyCode handling. Migrate source-inspection tests without weakening their assertions, and retain native-input integration coverage.

### S2. Remove release helpers that only forward to their owner

Priority: medium. Locations: [scripts/release-artifact.mjs:1](C:/dev/PokeRogue-Electron/scripts/release-artifact.mjs:1), [scripts/release-manifest-lib.mjs:7](C:/dev/PokeRogue-Electron/scripts/release-manifest-lib.mjs:7), and [scripts/package-win.mjs:5](C:/dev/PokeRogue-Electron/scripts/package-win.mjs:5).

The central release-contract refactor left release-artifact.mjs as a one-line re-export. package-win.mjs imports through it and then re-exports the guard again for a test. assertManifestCompatibility is another forwarding function that passes unchanged options to assertValidRelease. package-win also imports/re-exports cache constants it does not use; its consumers already obtain those constants from package-win-cache.mjs. release-manifest-lib exports guards that have no consumers through that module.

Import shared guards and constants directly from their owning modules, update the internal test imports, and remove the unused forwarding exports. Keep the single release contract. It owns real shared validation and is not an unnecessary abstraction.

The history shows these forwarding layers preserve old import paths after centralization. Confirm that no external maintainer tooling depends on those paths before deleting them. For all current callers, the direct validator expresses the same options; an omitted options argument has different error behavior between the wrapper and direct function, so do not claim universal API equivalence.

### S3. Replace artifact-list clearing and rebuilding with one returned list

Priority: medium. Location: [scripts/release-manifest-lib.mjs:30](C:/dev/PokeRogue-Electron/scripts/release-manifest-lib.mjs:30), lines 30-42.

mergeArtifact currently clones the list, allocates a matches list, allocates a remaining list, appends the new artifact, clears the original array, and pushes the remaining array back into it. That original array is local, so preserving its identity serves no caller.

Keep artifact validation and cloning. Use one matching predicate, some() for the replacement guard, filter() to retain other coordinates, then append, sort, and return that list. This removes the clear-and-repopulate branch without changing the rejection policy or mutation boundary.

A standalone candidate matched current return values and error messages across 24 cases: empty lists, Windows/macOS entries in different orders, repeated coordinates, both new artifacts, and replacement enabled/disabled. Preserve the existing behavior that retained artifacts are cloned and the new artifact itself is retained by reference. The prototype was not installed into production.

### S4. State shared development packaging settings once

Priority: small. Location: [scripts/package-win.mjs:22](C:/dev/PokeRogue-Electron/scripts/package-win.mjs:22), lines 22-33.

Both smoke and staged branches set differentialPackage=false and useZip=true. Move those two assignments next to npmRebuild=false after the release early return. Then each branch only expresses its real differences: resources, output directory, and artifact name.

Keep the mode allowlist, separate output paths, non-distributable artifact names, and release early return. A lookup-table framework for three modes would add concepts without much benefit.

structuredClone already separates nested configuration, but the subsequent object spreads also initialize missing sections. Do not delete those spreads merely because they look redundant without first deciding whether incomplete base configurations are supported. Existing release/smoke/staged tests define the output policy that a future refactor must retain.

### S5. Derive cheat boolean keys from the existing defaults

Priority: small. Location: [src/cheats.mjs:44](C:/dev/PokeRogue-Electron/src/cheats.mjs:44).

booleanKeys repeats twelve property names already declared as booleans in NEUTRAL_CHEATS. The renderer has a third copy for its controls. Adding a boolean currently requires keeping these declarations aligned.

For backend validation, derive the boolean keys once from the typed default values. A direct check confirmed the derived set exactly matches all twelve current entries. Retain the explicit bounded numeric rules and nested Poké Ball validation; they encode real policy.

Keep the renderer's explicit control groups unless duplication demonstrably causes further maintenance problems. Do not introduce a general schema library, dynamic form system, or new IPC contract to remove one short list. Verify neutral/maximum presets, unknown-key rejection, and invalid-type fallback after any implementation.

### S6. Expand the few handlers that hide multiple operations in one expression

Priority: small. Locations: [src/cheat-window/renderer.mjs:23](C:/dev/PokeRogue-Electron/src/cheat-window/renderer.mjs:23), [src/cheat-window/renderer.mjs:30](C:/dev/PokeRogue-Electron/src/cheat-window/renderer.mjs:30), and [src/keymap-store.mjs:4](C:/dev/PokeRogue-Electron/src/keymap-store.mjs:4).

The Maximum Fun handler combines async, then(), rendering, and the comma operator in one expression. run() combines action completion, rendering, cancellation messages, and cleanup into compressed statements. ensureKeymap similarly hides missing-file handling and exclusive creation inside one line.

Use ordinary await and separate statements for these steps. Keep the busy-state finally block, displayed errors, return values, cancellation behavior, and exclusive creation flag unchanged. This may increase line count while making side-effect order and failure paths easier to inspect.

Limit this to handlers that obscure behavior. A repository-wide formatting pass would create review noise without comparable value.

## Simplification boundaries and order

The cache fingerprint, inventory comparison, transactional cache swap, Robocopy retry handling, release artifact guard, sandbox settings, editor IPC sender checks, backup integrity checks, and distinct local/public macOS signing checks serve concrete purposes. Retain them. Combining every script's process helper would also need to preserve different logging, quiet-mode, environment, working-directory, and error policies; no shared abstraction is justified by the present call sites.

fix-shop-fee-overrides.mjs has no normal build caller, but it is an independently invocable maintenance CLI with a test. That is not enough evidence to call it dead. Do not delete it until its maintenance purpose and supported game revisions are resolved. APP_ID is an unused source export; removing it would save one line and is not a worthwhile standalone refactor. The configured permanent appId must remain unchanged.

Address the data-loss and update-verification defects first. Then remove inactive preloads and forwarding layers, simplify artifact merging, and apply the small local readability cleanups only when working in those modules. Keep each cleanup independently reviewable. Preserve security checks and behavior; handle bug fixes as explicit behavior changes rather than describing them as simplification.

Only the report changed during this follow-up. The previous 55-test baseline remains applicable because repository source and tests are unchanged. The 24-case merge comparison and twelve-field comparison are exploratory evidence, not proof that an unimplemented refactor passes the full suite. No additional build validation was needed or performed for this documentation-only update.
