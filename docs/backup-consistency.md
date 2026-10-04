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

Keep release clearance blocked until a bounded capture barrier is implemented and tested. The barrier should prevent new game save writes, wait for any active save operation to finish, flush DOMStorage, and only then copy the profile. If a supported game revision begins using IndexedDB for save data, the barrier must also account for active IndexedDB connections and transactions. The release follow-up should exercise a writer that attempts changes across the capture boundary and verify both the restored records and database reopen behavior.

The coordinator should track this correction as a separate issue and add it as a blocker to the Windows and macOS release-validation issues. R11 supplies evidence and a recommendation; it does not clear those release gates.

## Verification

- `node --test test/backup-snapshot.test.mjs test/backup.test.mjs` — exit 0, 13/13 passed, including eight native Electron capture/restore rounds.
- `npm test` — exit 0, 77/77 passed, no skipped tests.
