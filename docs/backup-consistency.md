# Backup capture consistency evidence

## Conclusion

**Inconclusive for a general live-profile snapshot guarantee.** Eight native captures restored the exact state that existed in the source profile before each copy, and IndexedDB reopened after each restore. This supports restoration of the tested state. It does not prove that copying Chromium's storage directories is safe while those files are being modified, or that an arbitrary in-flight IndexedDB transaction can be snapshotted consistently.

Do not use a valid checksum as evidence that a live database snapshot is usable. The checksum proves that the copied tree has not changed since its manifest was written; it does not prove that the tree represented one application-level save point.

## Native probe

`node --test test/backup-snapshot.test.mjs` passed on Windows x64 with Electron 42.7.1, Chromium as bundled by that Electron release, and Node 24.18.0. The test performed eight independent captures in disposable source and restore profiles. Electron's `session.fromPath()` created the source and fresh restore sessions. A hidden Electron window kept the process alive while each source window was closed and its restored profile reopened.

Each round wrote PokeRogue-shaped system and session records to Local Storage and a synthetic two-store IndexedDB database. One starter and Pokédex entry follows the per-species consistency rule in upstream `GameData.validateSystemData()`; this is not a full upstream system-record validation. The session record contains the fields checked by upstream session validation. The fixture then paused between writing the system and session Local Storage keys, flushed DOMStorage, called the production `createBackup()`, validated the resulting manifest, and restored it with the production `restoreBackup()` into a fresh profile.

All eight manifests validated. All eight restored Local Storage and IndexedDB databases reopened, and the restored records matched the state read directly from the source profile before copying. That source state was deliberately staged: system generation 2, session generation 1, and synthetic IndexedDB generation 1. The IndexedDB transaction was complete before capture; the database was not being mutated during the directory copy. The fixture therefore checks exact restoration of this controlled state, not concurrent-write crash consistency.

The staged generation difference also must not be read as a demonstrated game corruption. Upstream `saveAll()` writes system and session records to separate Local Storage keys, and the fixture deliberately pauses between those statements. This establishes that Backup can preserve a state already present in the profile. It does not show that the filesystem copy introduced that state, nor that the upstream game promises an atomic transaction across the keys.

## Upstream storage contract

The read-only upstream checkout was at revision `ae6a29a0755743a72f928ac8e3adfd00ec6e01f0`. `GameData.saveAll()` (`src/system/game-data.ts:1286, 1327-1338`) writes the system record to `data_<username>` and then writes the active session to the key returned by `getSessionDataLocalStorageKey()` (`src/account.ts:59`). `validateSystemData()` (`src/system/game-data.ts:214`) checks consistency between starter and Pokédex entries within the system record. The session validation path (`src/system/game-data.ts:1508-1513`) checks for `party`, `enemyParty`, and `timestamp`. A source scan of the upstream `src/` found no IndexedDB use for these game saves.

Electron documents [`ses.flushStorageData()`](https://www.electronjs.org/docs/latest/api/session#sesflushstoragedata) as writing unwritten DOMStorage data to disk. It does not document that this call flushes IndexedDB or that copying the profile directory creates an atomic snapshot. IndexedDB in this probe is synthetic: it verifies database reopen behavior for the tested stored state, not an upstream game save invariant.

## Release follow-up

Keep release clearance blocked until a cold-profile capture path is proven. `ses.flushStorageData()` writes unwritten DOMStorage, but it does not promise an atomic copy of Chromium's storage directories. Pausing page JavaScript (including through a DevTools protocol command) does not stop Chromium's storage backend from checkpointing or compacting databases, close other profile writers, or turn a recursive filesystem copy into a snapshot. Do not use a renderer freeze plus flush as the release barrier.

The bounded candidate is a same-executable, one-shot Electron worker. The normal app records a strict continuation intent, flushes DOMStorage, requests `app.relaunch()` into worker mode, then quits. Electron documents that `app.relaunch()` starts the new instance only after the current instance exits, while `app.quit()` runs close and unload handlers and can be cancelled. The worker must acquire the app's single-instance lock, switch to a token-scoped isolated runtime `userData` before readiness, avoid opening any session against the source profile, and copy only after the old process has exited. Preserve the current `Local Storage`, `IndexedDB`, and `Session Storage` scope. R11 includes Session Storage in the copied directory inventory but does not claim it hydrates into a different browsing context; document that limit explicitly. R14 must prove graceful exit/relaunch, lock ownership across the worker profile switch, and isolation before R17 implements it; stop this design if that prototype fails.

Manual Backup, Update, restore safety backup, and cheat safety backup must all use the same cold path. Resume only validated one-shot intents. Show the user when a restart is needed; allow cancellation before shutdown; report veto, copy failure, or interrupted-worker recovery visibly. Revalidate Update bytes/path on resume, preserve restore recovery ordering and cheat approval/backup-before-write ordering, and never trust persisted paths for arbitrary cleanup or opening. R20 must verify the packaged native flow before release validation can proceed.

Official references: [Electron `app.relaunch()`](https://www.electronjs.org/docs/latest/api/app#apprelaunchoptions), [`app.quit()` and `app.exit()`](https://www.electronjs.org/docs/latest/api/app#appquit), [`requestSingleInstanceLock()`](https://www.electronjs.org/docs/latest/api/app#apprequestsingleinstancelockadditionaldata), [Electron DOMStorage flush](https://www.electronjs.org/docs/latest/api/session#sesflushstoragedata).

## Verification

- `node --test test/backup-snapshot.test.mjs test/backup.test.mjs` — exit 0, 13/13 passed, including eight native Electron capture/restore rounds.
- `npm test` — exit 0, 77/77 passed, no skipped tests.
