import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomInt } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  attachPackaged,
  cleanupOwned,
  connectGame,
  connectCheat,
  evalRenderer,
  sleep,
  waitForEvent,
  waitForInspector,
  waitForPidExit,
} from "./helpers/packaged-backup-probe.cjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function removeProfile(path) {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { await rm(path, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); return; }
    catch (error) {
      lastError = error;
      if (!new Set(["EBUSY", "EPERM", "ENOTEMPTY"]).has(error.code)) throw error;
      await sleep(100);
    }
  }
  throw new Error(`Could not remove disposable profile ${path}: ${lastError?.message}`);
}

async function seedGame(remotePort, suffix) {
  return evalRenderer(remotePort, `(() => { const suffix = ${JSON.stringify(suffix)}; return new Promise((resolve, reject) => {
    localStorage.setItem("r20-save", JSON.stringify({ suffix, value: "local-" + suffix }));
    sessionStorage.setItem("r20-session", "context-" + suffix);
    const request = indexedDB.open("r20-packaged-save", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("records", { keyPath: "id" });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("records", "readwrite");
      tx.objectStore("records").put({ id: "save", suffix, value: "indexed-" + suffix });
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Seed transaction aborted"));
    };
  }); })()`, true);
}

async function readGame(remotePort) {
  return evalRenderer(remotePort, `(() => new Promise((resolve, reject) => {
    const local = JSON.parse(localStorage.getItem("r20-save"));
    const context = sessionStorage.getItem("r20-session");
    const request = indexedDB.open("r20-packaged-save", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction("records", "readonly").objectStore("records").get("save");
      get.onsuccess = () => { db.close(); resolve({ local, indexed: get.result, context }); };
      get.onerror = () => reject(get.error);
    };
  }))()`, true);
}

async function launchPackage({ exe, root, userData, remotePort, firstInspectorPort, restorePath, scenario, dialogResponse = 0 }) {
  const ownedPids = new Set();
  const ownedPorts = new Map();
  const environment = {
    ...process.env,
    POKEROGUE_R20_RESULTS: root,
    POKEROGUE_R20_NEXT_PORT: String(firstInspectorPort + 1),
  };
  const args = [`--inspect-brk=127.0.0.1:${firstInspectorPort}`];
  const processHandle = spawn(exe, args, { cwd: dirname(exe), env: environment, windowsHide: true, stdio: "ignore" });
  if (processHandle.pid) { ownedPids.add(processHandle.pid); ownedPorts.set(processHandle.pid, firstInspectorPort); }
  const config = {
    userData,
    sessionData: userData,
    resultsRoot: root,
    bootstrapPath: join(dirname(exe), "resources", "app.asar", "src", "bootstrap.mjs"),
    remotePort,
    dialogResponse,
    restorePath: restorePath ?? null,
    update: scenario === "update" || scenario === "update-missing" || scenario === "update-tampered",
    updateTamper: scenario === "update-missing" ? "missing" : scenario === "update-tampered" ? "tampered" : null,
    failWorker: scenario === "worker-failure",
    vetoQuit: scenario === "quit-veto",
    holdWorker: scenario === "interrupted-worker",
    blockInstallerOpen: true,
    identity: true,
  };
  try {
    const app = await attachPackaged(exe, firstInspectorPort, config, ownedPids, ownedPorts);
    return { app, ownedPids, ownedPorts, config, remotePort, nextPort: firstInspectorPort + 1, exe, root, userData };
  } catch (error) {
    await cleanupOwned(ownedPids, ownedPorts, exe, root);
    throw error;
  }
}

const clickMenu = (current, label) => current.app.debuggerClient.evaluate(`globalThis.__r20ClickMenu("PokeRogue Offline", ${JSON.stringify(label)})`);

async function runRequestedFlow(state, operation, trigger, completionTitle) {
  const sourcePid = state.app.pid;
  const previousBackups = await backupDirectories(state.userData);
  await trigger(state);
  state.app.debuggerClient.close();
  await waitForPidExit(sourcePid);
  const sourceExitObservedAt = new Date().toISOString();
  appendFileSync(join(state.root, "events.jsonl"), `${JSON.stringify({ at: sourceExitObservedAt, event: "source-exit-observed", pid: sourcePid })}\n`);
  const worker = await nextRelaunchedApp({ ...state, app: { ...state.app, pid: sourcePid } });
  const args = worker.app.marker.argv;
  assert.ok(args.includes("--backup-worker"), `${operation} must relaunch the real production backup worker`);
  const parentArg = args.find(value => value.startsWith("--backup-parent-pid="));
  assert.equal(Number(parentArg?.split("=")[1]), sourcePid, "worker must name the exited source process");
  assert.equal(worker.app.marker.heldAtBootstrap, false);
  const workerPid = worker.app.pid;
  worker.app.debuggerClient.close();
  await waitForPidExit(workerPid);
  const events = getEvents(state.root);
  const workerLock = events.find(value => value.event === "source-lock" && value.pid === workerPid);
  const workerPaths = events.filter(value => value.event === "profile-path" && value.pid === workerPid);
  assert.equal(workerLock?.acquired, true, `${operation} worker must acquire the actual profile lock`);
  assert.ok(workerPaths.some(value => value.name === "userData" && value.value.includes(".backup-worker-")));
  assert.ok(workerPaths.some(value => value.name === "sessionData" && value.value.includes(".backup-worker-")));
  const sourceExit = events.find(value => value.event === "source-exit-observed" && value.pid === sourcePid);
  const workerStart = events.find(value => value.event === "pre-bootstrap" && value.pid === workerPid);
  assert.ok(sourceExit && workerStart && Date.parse(sourceExit.at) <= Date.parse(workerStart.at), "source exit must precede actual worker bootstrap");
  const publishedBackups = await backupDirectories(state.userData);
  const created = publishedBackups.filter(value => !previousBackups.includes(value));
  assert.equal(created.length, 1, `${operation} worker must publish exactly one new Backup`);
  const manifest = JSON.parse(await readFile(join(created[0], "manifest.json"), "utf8"));
  assert.deepEqual(manifest.included, ["IndexedDB", "Local Storage", "Session Storage"]);
  for (const name of manifest.included) assert.ok((await stat(join(created[0], "data", name))).isDirectory(), `${operation} capture must include ${name}`);
  const resumed = await nextRelaunchedApp({ ...worker, app: { ...worker.app, pid: workerPid } });
  assert.equal(resumed.app.marker.argv.includes("--backup-worker"), false);
  if (operation === "cheat") {
    const resumedPid = resumed.app.pid;
    resumed.app.debuggerClient.close();
    await waitForPidExit(resumedPid);
    const relaunched = await nextRelaunchedApp({ ...resumed, app: { ...resumed.app, pid: resumedPid } });
    await waitForGame(relaunched.remotePort);
    return { ...relaunched, sourcePid, workerPid, resumedPid, capturePath: created[0], manifest };
  }
  const game = await connectGame(resumed.remotePort);
  game.debuggerClient.close();
  if (completionTitle) await waitForEvent(state.root, event => event.pid === resumed.app.pid && event.event === "dialog-message" && event.title === completionTitle);
  return { ...resumed, sourcePid, workerPid, sourceExitObservedAt, capturePath: created[0], manifest };
}

async function waitForGame(remotePort) {
  const game = await connectGame(remotePort);
  game.debuggerClient.close();
}

function getEvents(root) {
  const file = join(root, "events.jsonl");
  return existsSync(file) ? readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse) : [];
}

async function backupDirectories(userData) {
  const root = join(userData, "Save Backups");
  return (await readdir(root, { withFileTypes: true }).catch(() => [])).filter(entry => entry.isDirectory() && !entry.name.startsWith(".")).map(entry => join(root, entry.name));
}

async function stopApp(state) {
  if (!state) return;
  if (state.app?.debuggerClient) {
    await state.app.debuggerClient.evaluate("globalThis.__r20Quit?.()", false).catch(() => {});
    state.app.debuggerClient.close();
    await waitForPidExit(state.app.pid, 10_000).catch(() => {});
  }
  await cleanupOwned(state.ownedPids, state.ownedPorts, state.exe, state.root);
}

async function nextRelaunchedApp(state) {
  await waitForPidExit(state.app.pid);
  const port = state.nextPort++;
  await waitForInspector(port);
  const app = await attachPackaged(state.exe, port, state.config, state.ownedPids, state.ownedPorts);
  return { ...state, app, port };
}

async function runManualCapture(state, suffix) {
  await waitForGame(state.remotePort);
  await seedGame(state.remotePort, suffix);
  const resumed = await runRequestedFlow(state, "manual", current => clickMenu(current, "Back Up Saves…"), "Save backup complete");
  const profile = state.userData;
  const backupRoot = join(profile, "Save Backups");
  const candidates = (await readdir(backupRoot, { withFileTypes: true })).filter(entry => entry.isDirectory() && !entry.name.startsWith("."));
  assert.equal(candidates.length, 1, "manual continuation must publish one Backup");
  const backupPath = join(backupRoot, candidates[0].name);
  const manifest = JSON.parse(await readFile(join(backupPath, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.included, ["IndexedDB", "Local Storage", "Session Storage"]);
  for (const name of manifest.included) assert.ok((await stat(join(backupPath, "data", name))).isDirectory(), `${name} must be in the captured Backup`);
  const events = (await readFile(join(state.root, "events.jsonl"), "utf8")).trim().split(/\r?\n/).map(JSON.parse);
  const workerLock = events.find(value => value.event === "source-lock" && value.pid === resumed.workerPid);
  const workerPaths = events.filter(value => value.event === "profile-path" && value.pid === resumed.workerPid);
  assert.equal(workerLock?.acquired, true, "the worker must acquire the production profile lock");
  assert.ok(workerPaths.some(value => value.name === "userData" && value.value.includes(".backup-worker-")));
  assert.ok(workerPaths.some(value => value.name === "sessionData" && value.value.includes(".backup-worker-")));
  assert.ok(events.find(value => value.event === "pre-bootstrap" && value.pid === resumed.sourcePid));
  const sourceExitEvent = events.find(value => value.event === "source-exit-observed" && value.pid === resumed.sourcePid);
  const workerStart = events.find(value => value.event === "pre-bootstrap" && value.pid === resumed.workerPid);
  assert.ok(sourceExitEvent && Date.parse(sourceExitEvent.at) <= Date.parse(workerStart.at), "source process exit must precede worker bootstrap");
  assert.ok(Date.parse(manifest.createdAt) >= Date.parse(sourceExitEvent.at), "the actual Backup manifest must be created after source exit");
  appendFileSync(join(state.root, "events.jsonl"), `${JSON.stringify({ at: manifest.createdAt, event: "capture-observed", pid: resumed.workerPid, backupPath, parentExitedBeforeWorker: true, workerLockAcquired: true })}\n`);
  assert.deepEqual(await readGame(resumed.remotePort), {
    local: { suffix, value: `local-${suffix}` },
    indexed: { id: "save", suffix, value: `indexed-${suffix}` },
    context: null,
  });
  return { ...resumed, backupPath, manifest };
}

test("the unchanged packaged Electron app completes Backup flows and recovers failures", { timeout: 900_000 }, async () => {
  assert.equal(process.platform, "win32", "this package probe requires the supplied Windows x64 executable");
  const exe = process.env.POKEROGUE_R20_EXE;
  const expectedExeHash = process.env.POKEROGUE_R20_SHA256?.toLowerCase();
  const expectedAsarHash = process.env.POKEROGUE_R20_ASAR_SHA256?.toLowerCase();
  const sourceCommit = process.env.POKEROGUE_R20_SOURCE_COMMIT;
  const outputRoot = process.env.POKEROGUE_R20_RESULTS;
  assert.ok(exe && expectedExeHash && expectedAsarHash && sourceCommit && outputRoot, "set POKEROGUE_R20_EXE, POKEROGUE_R20_SHA256, POKEROGUE_R20_ASAR_SHA256, POKEROGUE_R20_SOURCE_COMMIT, and POKEROGUE_R20_RESULTS");
  assert.equal(await readFile(join(exe, "..", "resources", "app.asar")).then(sha256), expectedAsarHash, "supplied app.asar hash must match");
  assert.equal(await readFile(exe).then(sha256), expectedExeHash, "supplied executable hash must match");
  assert.match(sourceCommit, /^[a-f0-9]{40}$/);
  await mkdir(outputRoot, { recursive: true });
  const root = await mkdtemp(join(outputRoot, "r20-run-"));
  const profiles = [];
  const states = [];
  let portBase = randomInt(16_000, 48_000);
  const newProfile = async () => {
    const profile = await mkdtemp(join(tmpdir(), "pokerogue-r20-packaged-profile-"));
    profiles.push(profile);
    return profile;
  };
  const launch = async (scenario, dialogResponse = 0, userData) => {
    const profile = userData ?? await newProfile();
    const state = await launchPackage({
      exe,
      root,
      userData: profile,
      remotePort: portBase + 100,
      firstInspectorPort: portBase + 1,
      scenario,
      dialogResponse,
    });
    portBase += 20;
    states.push(state);
    return state;
  };
  const keep = state => { states.push(state); return state; };
  const flowResults = [];
  try {
    let state = await launch("manual");
    const manual = keep(await runManualCapture(state, "manual"));
    flowResults.push({ flow: "manual", outcome: "passed", sourcePid: manual.sourcePid, workerPid: manual.workerPid, backupPath: manual.backupPath });

    await stopApp(manual);
    state = await launch("replay", 0, manual.userData);
    const beforeReplay = await backupDirectories(manual.userData);
    await waitForGame(state.remotePort);
    await sleep(400);
    assert.equal((await backupDirectories(manual.userData)).length, beforeReplay.length, "a fresh launch must not replay a completed Manual Backup");
    assert.equal(getEvents(root).some(event => event.pid === state.app.pid && event.event === "dialog-message" && event.title === "Save backup complete"), false);
    state.config.restorePath = manual.backupPath;
    await state.app.debuggerClient.evaluate(`globalThis.__r20SetRestorePath(${JSON.stringify(manual.backupPath)})`);
    await seedGame(state.remotePort, "changed");
    const restored = keep(await runRequestedFlow(state, "restore", current => clickMenu(current, "Restore Backup…"), null));
    const restoredState = await readGame(restored.remotePort);
    assert.deepEqual(restoredState, {
      local: { suffix: "manual", value: "local-manual" },
      indexed: { id: "save", suffix: "manual", value: "indexed-manual" },
      context: null,
    }, "the actual packaged Restore must restore captured Local Storage and IndexedDB values after they changed");
    const restoreIntent = JSON.parse(await readFile(join(manual.userData, "backup-intent.json").replaceAll("\\", "/")).catch(() => "null"));
    assert.equal(restoreIntent, null, "successful Restore must acknowledge its one-shot continuation");
    flowResults.push({ flow: "restore", outcome: "passed", safetyCapture: restored.capturePath, selectedBackup: manual.backupPath, restoredLocalStorage: restoredState.local, restoredIndexedDb: restoredState.indexed });

    const updateState = await launch("update");
    await waitForGame(updateState.remotePort);
    await seedGame(updateState.remotePort, "update");
    const update = keep(await runRequestedFlow(updateState, "update", current => clickMenu(current, "Check for Updates…"), "Update downloaded"));
    const updateFiles = await readdir(join(update.userData, "Updates"));
    assert.equal(updateFiles.length, 1);
    assert.match(await readFile(join(update.userData, "Updates", updateFiles[0]), "utf8"), /^R20 inert, verified Update fixture/);
    assert.equal(getEvents(root).some(event => event.event === "shell-open-path" && event.value === join(update.userData, "Updates", updateFiles[0])), false, "Later must never open or execute the inert installer fixture");
    assert.deepEqual((await readGame(update.remotePort)).local, { suffix: "update", value: "local-update" });
    flowResults.push({ flow: "update", outcome: "passed", capturePath: update.capturePath, included: update.manifest.included, installer: updateFiles[0], installerOpened: false });

    for (const scenario of ["update-missing", "update-tampered"]) {
      const failedUpdateState = await launch(scenario);
      await waitForGame(failedUpdateState.remotePort);
      await seedGame(failedUpdateState.remotePort, scenario);
      const failedUpdate = keep(await runRequestedFlow(failedUpdateState, "update", current => clickMenu(current, "Check for Updates…"), "Update backup did not complete"));
      assert.deepEqual(await readGame(failedUpdate.remotePort), {
        local: { suffix: scenario, value: `local-${scenario}` },
        indexed: { id: "save", suffix: scenario, value: `indexed-${scenario}` },
        context: null,
      }, `${scenario} must preserve current source Local Storage and IndexedDB data`);
      assert.equal(getEvents(root).some(event => event.pid === failedUpdate.app.pid && event.event === "dialog-message" && event.title === "Update downloaded"), false);
      assert.equal(getEvents(root).some(event => event.event === "shell-open-path" && event.value?.startsWith(join(failedUpdate.userData, "Updates"))), false);
      flowResults.push({ flow: scenario, outcome: "failed-visibly-preserved-source", safetyCapture: failedUpdate.capturePath });
    }

    const cheatState = await launch("cheat");
    await waitForGame(cheatState.remotePort);
    await seedGame(cheatState.remotePort, "cheat");
    const cheat = keep(await runRequestedFlow(cheatState, "cheat", async current => {
      await current.app.debuggerClient.evaluate("globalThis.__r20ClickMenu('Cheats', 'Configure Cheats...')");
      const { debuggerClient } = await connectCheat(current.remotePort);
      await debuggerClient.evaluate("(() => { document.getElementById('enabled').click(); document.getElementById('xpMultiplier').value = '2'; document.getElementById('apply').click(); return true; })()");
      debuggerClient.close();
      await waitForEvent(root, event => event.pid === current.app.pid && event.event === "dialog-message" && event.title === "Shared save warning");
    }, null));
    const cheatDocument = JSON.parse(await readFile(join(cheat.userData, "cheats.json"), "utf8"));
    assert.equal(cheatDocument.config.enabled, true);
    assert.equal(cheatDocument.config.xpMultiplier, 2);
    assert.equal(cheatDocument.usage.applyCount, 1);
    assert.equal(cheatDocument.usage.everEnabled, true);
    assert.deepEqual((await readGame(cheat.remotePort)).local, { suffix: "cheat", value: "local-cheat" });
    flowResults.push({ flow: "cheat", outcome: "passed", capturePath: cheat.capturePath, included: cheat.manifest.included, applyCount: cheatDocument.usage.applyCount, config: cheatDocument.config });

    const cancelledState = await launch("cancel", 1);
    await waitForGame(cancelledState.remotePort);
    await seedGame(cancelledState.remotePort, "cancel");
    await clickMenu(cancelledState, "Back Up Saves…");
    await waitForEvent(root, event => event.pid === cancelledState.app.pid && event.event === "dialog-message" && event.title === "Restart to back up saves" && event.response === 1);
    assert.ok(getEvents(root).some(event => event.pid === cancelledState.app.pid && event.event === "dialog-message" && event.title === "Restart to back up saves" && event.response === 1), "cancellation must come from the actual Restart/Cancel dialog");
    assert.equal((await backupDirectories(cancelledState.userData)).length, 0);
    assert.deepEqual(await readGame(cancelledState.remotePort), {
      local: { suffix: "cancel", value: "local-cancel" },
      indexed: { id: "save", suffix: "cancel", value: "indexed-cancel" },
      context: "context-cancel",
    });
    flowResults.push({ flow: "cancellation", outcome: "passed", backupCount: 0 });

    const vetoState = await launch("quit-veto");
    await waitForGame(vetoState.remotePort);
    await seedGame(vetoState.remotePort, "veto");
    const vetoPid = vetoState.app.pid;
    await clickMenu(vetoState, "Back Up Saves…");
    await waitForEvent(root, event => event.pid === vetoPid && event.event === "dialog-message" && event.title === "Backup not completed");
    const vetoIntent = JSON.parse(await readFile(join(vetoState.userData, "backup-intent.json"), "utf8"));
    assert.equal(vetoIntent.state, "failed");
    assert.equal((await backupDirectories(vetoState.userData)).length, 0);
    assert.equal(getEvents(root).some(event => event.pid === vetoPid && event.event === "relaunch"), false, "quit veto must never start a worker or try a live copy");
    await cleanupOwned(vetoState.ownedPids, vetoState.ownedPorts, exe, root);
    await waitForPidExit(vetoPid);
    const vetoRecovery = await launch("quit-veto-recovery", 0, vetoState.userData);
    await waitForGame(vetoRecovery.remotePort);
    assert.deepEqual(await readGame(vetoRecovery.remotePort), {
      local: { suffix: "veto", value: "local-veto" },
      indexed: { id: "save", suffix: "veto", value: "indexed-veto" },
      context: null,
    }, "fresh launch must reopen unchanged source after the veto closed its window");
    assert.equal((await backupDirectories(vetoRecovery.userData)).length, 0);
    flowResults.push({ flow: "quit-veto", outcome: "visible-failure-preserved-source", workerStarted: false, recoveredLocalStorage: { suffix: "veto", value: "local-veto" } });

    const workerFailureState = await launch("worker-failure");
    await waitForGame(workerFailureState.remotePort);
    await seedGame(workerFailureState.remotePort, "worker-failure");
    const failedSourcePid = workerFailureState.app.pid;
    await clickMenu(workerFailureState, "Back Up Saves…");
    workerFailureState.app.debuggerClient.close();
    await waitForPidExit(failedSourcePid);
    appendFileSync(join(root, "events.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), event: "source-exit-observed", pid: failedSourcePid })}\n`);
    const failedWorker = await nextRelaunchedApp({ ...workerFailureState, app: { ...workerFailureState.app, pid: failedSourcePid } });
    failedWorker.app.debuggerClient.close();
    await waitForPidExit(failedWorker.app.pid);
    const movedBackupRoot = `${join(failedWorker.userData, "Save Backups")}.probe-original`;
    await rm(join(failedWorker.userData, "Save Backups"), { force: true });
    await import("node:fs/promises").then(({ rename }) => rename(movedBackupRoot, join(failedWorker.userData, "Save Backups")));
    const workerRecovery = await launch("worker-failure-recovery", 0, failedWorker.userData);
    await waitForGame(workerRecovery.remotePort);
    await waitForEvent(root, event => event.pid === workerRecovery.app.pid && event.event === "dialog-message" && event.title === "Backup not completed");
    assert.deepEqual(await readGame(workerRecovery.remotePort), {
      local: { suffix: "worker-failure", value: "local-worker-failure" },
      indexed: { id: "save", suffix: "worker-failure", value: "indexed-worker-failure" },
      context: null,
    });
    assert.equal((await backupDirectories(workerRecovery.userData)).length, 0);
    flowResults.push({ flow: "worker-failure", outcome: "visible-recovery-preserved-source", backupCount: 0 });

    const interruptedState = await launch("interrupted-worker");
    await waitForGame(interruptedState.remotePort);
    await seedGame(interruptedState.remotePort, "interrupted");
    const interruptedSourcePid = interruptedState.app.pid;
    await clickMenu(interruptedState, "Back Up Saves…");
    interruptedState.app.debuggerClient.close();
    await waitForPidExit(interruptedSourcePid);
    appendFileSync(join(root, "events.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), event: "source-exit-observed", pid: interruptedSourcePid })}\n`);
    const heldWorker = await nextRelaunchedApp({ ...interruptedState, app: { ...interruptedState.app, pid: interruptedSourcePid } });
    assert.ok(heldWorker.app.marker.heldAtBootstrap, "interruption fixture must stop before worker bootstrap code can copy data");
    await cleanupOwned(heldWorker.ownedPids, heldWorker.ownedPorts, exe, root);
    await waitForPidExit(heldWorker.app.pid);
    const interruptedRecovery = await launch("interrupted-recovery", 0, heldWorker.userData);
    await waitForGame(interruptedRecovery.remotePort);
    await waitForEvent(root, event => event.pid === interruptedRecovery.app.pid && event.event === "dialog-message" && event.title === "Backup not completed");
    assert.deepEqual(await readGame(interruptedRecovery.remotePort), {
      local: { suffix: "interrupted", value: "local-interrupted" },
      indexed: { id: "save", suffix: "interrupted", value: "indexed-interrupted" },
      context: null,
    });
    assert.equal((await backupDirectories(interruptedRecovery.userData)).length, 0, "an interrupted worker must not replay or fall back to a live copy");
    flowResults.push({ flow: "interrupted-worker", outcome: "visible-recovery-preserved-source", backupCount: 0 });

    const revisions = JSON.parse(await readFile(join(dirname(exe), "resources", "revisions.json"), "utf8"));
    const runtime = getEvents(root).find(event => event.event === "pre-bootstrap");
    const afterExeHash = sha256(await readFile(exe));
    const afterAsarHash = sha256(await readFile(join(exe, "..", "resources", "app.asar")));
    assert.equal(afterExeHash, expectedExeHash, "packaged executable must remain byte-identical after proof");
    assert.equal(afterAsarHash, expectedAsarHash, "app.asar must remain byte-identical after proof");
    const evidence = {
      package: { exe, executableSha256: expectedExeHash, appAsarSha256: expectedAsarHash, appCommit: sourceCommit, revisions },
      runtime: { electron: runtime.electron, chromium: runtime.chromium, node: runtime.node, platform: process.platform, arch: process.arch, osRelease: (await import("node:os")).release() },
      flows: flowResults,
      outcomes: "all packaged flows and failure recoveries passed",
      sessionStorage: "copied directory is inventoried; sessionStorage did not hydrate into the fresh browsing context",
      command: "node --test test/packaged-backup.integration.mjs with POKEROGUE_R20_EXE, POKEROGUE_R20_SHA256, POKEROGUE_R20_ASAR_SHA256, POKEROGUE_R20_SOURCE_COMMIT, and POKEROGUE_R20_RESULTS",
      resultsDirectory: root,
    };
    await writeFile(join(root, "result.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
  } catch (error) {
    await writeFile(join(root, "result.json"), `${JSON.stringify({ status: "failed", message: error.stack ?? error.message, package: { exe, executableSha256: expectedExeHash, appAsarSha256: expectedAsarHash, appCommit: sourceCommit }, flows: flowResults, eventsFile: join(root, "events.jsonl") }, null, 2)}\n`);
    throw error;
  } finally {
    const cleanupErrors = [];
    for (const state of states) {
      try { await stopApp(state); }
      catch (error) { cleanupErrors.push(error.stack ?? error.message); }
    }
    if (!cleanupErrors.length) {
      for (const profile of profiles) {
        try { await removeProfile(profile); }
        catch (error) { cleanupErrors.push(error.stack ?? error.message); }
      }
    }
    if (cleanupErrors.length) {
      let previous = {};
      try { previous = JSON.parse(await readFile(join(root, "result.json"), "utf8")); }
      catch {}
      const evidence = {
        ...previous,
        status: "failed",
        outcomes: "teardown failed; this run is not a clean pass",
        ...(previous.message ? { testFailure: previous.message } : {}),
        cleanupErrors,
        package: previous.package ?? { exe, executableSha256: expectedExeHash, appAsarSha256: expectedAsarHash, appCommit: sourceCommit },
        flows: flowResults,
        eventsFile: join(root, "events.jsonl"),
      };
      await writeFile(join(root, "result.json"), `${JSON.stringify(evidence, null, 2)}\n`);
      throw new AggregateError(cleanupErrors.map(message => new Error(message)), "Packaged probe teardown failed");
    }
  }
});
