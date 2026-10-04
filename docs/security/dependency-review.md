# Dependency review for release validation

Reviewed 2026-10-04 in the isolated R10 worktree on Windows x64 with Node.js 24.18.0 and npm 11.16.0. Raw audit snapshots and command metadata are retained in the ignored `.local-build/luna-plan/` directory in this worktree.

## Result

The lockfile now uses Electron `42.11.10`, the current verified 42.x release, and electron-builder `26.17.0`, the current v26 release. The Electron allowlist matches the resolved package exactly: `"electron@42.11.10": true`. This resolves the four Electron advisory ranges reported against 42.7.1 while staying on the existing supported major. The aligned builder packages resolve on v26 (`app-builder-lib`, `dmg-builder`, `electron-builder-squirrel-windows` at 26.17.0); their patch-line update also resolves current supported transitive security fixes.

Before the update, `npm audit --json` reported 7 high-severity affected package entries, 0 critical, across 284 dependencies. Those entries represented 39 distinct advisory IDs, not 39 or 7 independent application exploits. Six affected package names were in the build/development graph; Electron was the shipped runtime despite being a devDependency. After the update and clean install, the audit reports one high package entry and one distinct advisory: GHSA-ch52-4w7c-c8xp in `http-cache-semantics@4.2.0`. The command exits 1 because that finding remains.

## Resolved versions

| Package | Previous lock | Resolved lock | Advisory evidence |
| --- | --- | --- | --- |
| `electron` | 42.7.1 | 42.11.10 | GHSA-gr2m-v5gq-v685, GHSA-j84w-jfhq-vhvj, GHSA-9qh4-3jw8-366w patch 42.x at 42.9.2; GHSA-qmv3-fv6v-rmhq patches at 42.10.0. The current 42.11.10 registry release exceeds all four floors. [Electron advisory list](https://github.com/electron/electron/security/advisories) · [42.x npm versions](https://www.npmjs.com/package/electron?activeTab=versions) |
| `electron-builder` family | 26.15.3 | 26.17.0 | Current same-major v26 release; no major upgrade. [v26.17.0 release](https://github.com/electron-userland/electron-builder/releases) |
| `@xmldom/xmldom` | 0.8.13 | 0.8.15 | Current 0.8.x advisories are fixed in 0.8.15. [GHSA-93r5-fhx6-vmg9](https://github.com/advisories/GHSA-93r5-fhx6-vmg9) |
| `brace-expansion` | 1.1.16, 2.1.2, 5.0.8 | 1.1.21, 2.1.7, 5.0.12 | Meets the newest recursion and expansion advisory floors, including [GHSA-q2hr-2g5m-vwhr](https://github.com/juliangruber/brace-expansion/security/advisories). |
| `fast-uri` | 3.1.4 | 3.1.8 | Includes the September 2026 host-normalization fix. [Fast URI releases](https://github.com/fastify/fast-uri/releases) |
| `js-yaml` | 4.3.0 | 4.3.2 | Fixes the newer merge-key CPU advisory. [GHSA-2883-xcg3-v3hh](https://github.com/nodeca/js-yaml/security/advisories/GHSA-2883-xcg3-v3hh) |
| `undici` | 6.28.0, 7.29.0 | 6.29.0, 7.30.0 | Both exceed current patch floors 6.28.1 and 7.29.1. [Undici advisories](https://github.com/nodejs/undici/security/advisories) · [releases](https://github.com/nodejs/undici/releases) |
| `http-cache-semantics` | 4.2.0 | 4.2.0 (deferred) | GHSA-ch52-4w7c-c8xp remains open in the audit. No verified upstream fix was available for this change. |

The direct manifest retains caret ranges `electron: ^42.11.10` and `electron-builder: ^26.17.0`; the lockfile records the exact reviewed resolutions. No forced major upgrade or blanket `npm audit fix` was used.

## Runtime readiness before parallel tests

Electron 42.11.10's installed `package.json` has no lifecycle scripts. With npm's `ignore-scripts=false`, `npm ci` installs the package but does not download its native runtime; Electron's `index.js` lazily downloads and extracts it when the first caller resolves `require("electron")`. The `allowScripts` entry remains exactly `electron@42.11.10`; it does not mean npm ran an install hook.

The `npm test` command now runs `electron --version` before `node --test test/*.test.mjs`. The CLI resolves the Electron executable and waits for its version process to exit before starting the parallel test workers. This serializes the first lazy installation, fails early if the executable cannot run, and prints its version for verification against the lockfile. Prefixing the explicit test command also keeps this gate in the test command itself rather than depending on npm running a `pretest` hook.

## Deferred advisory

`http-cache-semantics@4.2.0` remains at the path `electron-builder@26.17.0` → `app-builder-lib@26.17.0` → `@electron/get@3.1.0` → `got@11.8.6` → `cacheable-request@7.0.4` → `http-cache-semantics@4.2.0`. It is not included in the packaged application; it is used by build-time download tooling. A read-only listing of the built smoke `app.asar` found 31 entries, 0 `node_modules` entries, and 0 `http-cache-semantics` entries. GHSA-ch52-4w7c-c8xp describes cross-user cache disclosure when shared-cache entries are reused after a caller supplies `max-stale`. This path is limited to dependency installation/build behavior, but its exposure should not be called impossible without further inspection of the build cache and request inputs.

The npm registry began listing `http-cache-semantics@4.3.0` on 2026-10-04, but the matching upstream GitHub release tag was unavailable and the repository manifest still identified 4.2.0 when checked. Its source provenance and the advisory fix could not be verified. It was deliberately excluded from the lockfile and clean install rather than accepted just to make `npm audit` green. Recheck its source and patch before a later dependency update; otherwise retain the single build-only advisory as an explicit release review item.

## Verification

- `npm install --package-lock-only --ignore-scripts` — exit 0; resolved the direct versions and supported transitive patches in the isolated worktree.
- `npm update undici --package-lock-only --ignore-scripts` — exit 0; both Undici branches advanced to patched releases.
- `npm ci` — exit 0, 283 packages installed (the audit's dependency total is 283; npm's console count includes the root project). Electron 42.11.10 has no lifecycle script and its binary was not downloaded by `npm ci`; the readiness command below installs it lazily before tests. npm warned that `electron-winstaller@5.4.0` has an unapproved install script (`select-7z-arch.js`). Its source copies vendored 7-Zip binaries for the Squirrel target; the required NSIS smoke completed successfully without running it, so no extra allowlist entry was added.
- `npm audit --json` after clean install — exit 1, 1 high package entry, 0 critical, 1 distinct advisory (`GHSA-ch52-4w7c-c8xp`). Raw JSON: `.local-build/luna-plan/audit-after-r10.json`; pre-change JSON: `.local-build/luna-plan/audit-before-r10.json` (7 high package entries, 39 distinct advisories, 0 critical). Timestamp and exit codes are alongside each snapshot.
- `npm run package:win:smoke` — exit 0; electron-builder 26.17.0 packaged Electron 42.11.10 into an NSIS smoke installer without upstream-game resources. Before packaging, the resolved cleanup target was verified as the nonexistent worktree-local `release/smoke` directory. The generated installer remains under that directory and is marked `DO-NOT-DISTRIBUTE`; SHA-256 `116B8A26B910E91E4806921A26B20470FFB06844FF1C6E75187B35B249D14D6A`. No local installer execution occurred.
- Before the readiness prefix, a test run could race when parallel native tests triggered Electron's initial lazy extraction; that attempt passed 103 tests and failed 1. With the readiness prefix, a fresh `npm ci` followed immediately by the **first** `npm test` exited 0: `electron --version` downloaded and printed `v42.11.10` before worker startup, then all 104 tests passed, with 0 failures and 0 skips. This includes native keyboard preload and Chromium storage probes, plus Backup, Release contract, and packaging guard coverage. The install and first-suite logs and exit metadata are saved as `.local-build/luna-plan/npm-ci-readiness-r10.log`, `.local-build/luna-plan/npm-test-first-run-readiness-r10.log`, and `.local-build/luna-plan/npm-ci-first-test-readiness-r10.txt`.

The smoke check validates NSIS packaging only. Full upstream-game packaging and native install/upgrade validation remain with the platform release tasks.
