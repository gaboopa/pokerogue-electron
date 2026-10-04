import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { release as osRelease, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import electron from "electron";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const probe = join(repositoryRoot, "test/helpers/cold-capture-probe.cjs");
const execFileAsync = promisify(execFile);
const rounds = 3;
const childTimeoutMs = 45_000;
const probeTimeoutMs = 40_000;

const page = `<!doctype html><meta charset="utf-8"><script>
(async () => {
  const params = new URL(location.href).searchParams;
  const mode = params.get("mode");
  const round = params.get("round");
  const dbName = "r14-cold-capture";
  const open = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("records", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (mode === "seed") {
    localStorage.setItem("r14-save", JSON.stringify({ round, value: "local-" + round }));
    sessionStorage.setItem("r14-context", "context-" + round);
    const db = await open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("records", "readwrite");
      tx.objectStore("records").put({ id: "save", round, value: "indexed-" + round });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Seed transaction aborted"));
    });
    window.probeResult = {
      local: JSON.parse(localStorage.getItem("r14-save")),
      idb: { id: "save", round, value: "indexed-" + round },
      contextValue: sessionStorage.getItem("r14-context"),
    };
    db.close();
    window.probeReady = true;
    return;
  }
  if (mode === "worker") {
    localStorage.setItem("r14-worker-profile", "helper-" + round);
    const db = await open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("records", "readwrite");
      tx.objectStore("records").put({ id: "worker", round, value: "helper-" + round });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Worker transaction aborted"));
    });
    db.close();
    window.probeReady = true;
    return;
  }
  if (mode === "read") {
    const local = JSON.parse(localStorage.getItem("r14-save"));
    const contextValue = sessionStorage.getItem("r14-context");
    const workerLocalStorage = localStorage.getItem("r14-worker-profile");
    const db = await open();
    const records = await new Promise((resolve, reject) => {
      const tx = db.transaction("records", "readonly");
      const saveRequest = tx.objectStore("records").get("save");
      const workerRequest = tx.objectStore("records").get("worker");
      let save;
      let worker;
      let remaining = 2;
      const complete = () => { if (--remaining === 0) resolve({ save, worker: worker ?? null }); };
      saveRequest.onsuccess = () => { save = saveRequest.result; complete(); };
      workerRequest.onsuccess = () => { worker = workerRequest.result; complete(); };
      saveRequest.onerror = () => reject(saveRequest.error);
      workerRequest.onerror = () => reject(workerRequest.error);
    });
    db.close();
    window.probeResult = { local, idb: records.save, workerLocalStorage, workerRecord: records.worker, contextValue };
    window.probeReady = true;
  }
})().catch(error => { window.probeError = error.stack ?? String(error); });
</script>`;

function startServer() {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(page);
  });
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolvePromise({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

function launchElectron(ownedPids, args, origin) {
  const launch = { executable: electron, args: [probe, ...args], cwd: repositoryRoot };
  const child = spawn(electron, [probe, ...args], {
    cwd: repositoryRoot,
    windowsHide: true,
    env: { ...process.env, POKEROGUE_R14_ORIGIN: origin },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (child.pid) {
    ownedPids.add(child.pid);
    child.once("exit", () => ownedPids.delete(child.pid));
    child.once("error", () => ownedPids.delete(child.pid));
  }
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const done = new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Electron probe exceeded ${childTimeoutMs} ms: ${stderr}${stdout}`));
    }, childTimeoutMs);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`Electron probe exited ${code ?? signal}; launch=${JSON.stringify({ ...launch, pid: child.pid, spawnfile: child.spawnfile, spawnargs: child.spawnargs })}; stderr=${stderr}; stdout=${stdout}`));
      else resolvePromise({ code, signal, stdout, stderr, pid: child.pid });
    });
  });
  return { child, done, pid: child.pid, stderr: () => stderr, stdout: () => stdout };
}

async function waitForFile(path, timeoutMs = probeTimeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { return JSON.parse(await readFile(path, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
  }
  const started = await readFile(`${path}.started`, "utf8").catch(() => "no helper startup record");
  throw new Error(`Timed out waiting for ${path}; bootstrap=${started}`);
}

async function waitForWorkerBootstrap(root, expectedParentPid, timeoutMs = probeTimeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const name of await readdir(root).catch(() => [])) {
      if (!/^probe-early-\d+\.json$/.test(name)) continue;
      const marker = await readFile(join(root, name), "utf8").then(JSON.parse).catch(() => null);
      if (marker?.mode !== "worker" || marker.root !== root) continue;
      const args = marker.argv.slice(2);
      if (args[0] === "--") args.shift();
      if (args[0] !== "worker" || args[1] !== root || Number(args[4]) !== expectedParentPid) continue;
      assert.equal(marker.pid, Number(name.match(/\d+/)?.[0]));
      assert.equal(marker.argv[1], probe, "relaunch must invoke the assigned CJS probe directly");
      return marker;
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
  }
  throw new Error(`Timed out waiting for relaunched worker bootstrap under ${root}`);
}

async function waitForPidExit(pid, timeoutMs = probeTimeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); }
    catch (error) { if (error.code === "ESRCH") return; }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
  }
  throw new Error(`Electron worker PID ${pid} did not exit within ${timeoutMs} ms`);
}

async function stopOwnedPid(pid) {
  if (!pid) return;
  try { process.kill(pid, 0); }
  catch (error) { if (error.code === "ESRCH") return; throw error; }
  try {
    if (process.platform === "win32") {
      await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 5_000 });
    } else {
      process.kill(-pid, "SIGTERM");
    }
  } catch (error) {
    if (error.code !== "ESRCH" && error.code !== 128) throw error;
  }
}

async function runCaptureRound(root, origin, round) {
  const token = `capture-${round}-${Date.now()}`;
  const sourceProfile = join(root, "source");
  const workerProfile = join(root, "worker-profile");
  const backupRoot = join(root, "backups");
  const restoreProfile = join(root, "restore-profile");
  const workerReady = join(root, "worker-ready.json");
  const competitorResult = join(root, "competitor.json");
  const continuePath = join(root, "continue-worker");
  const resultPath = join(root, "result.json");
  const ownedPids = new Set();
  let workerPid;
  try {
    const parent = launchElectron(ownedPids, ["--", "parent", root, String(round), token], origin);
    const parentExit = await parent.done;
    const workerBootstrap = await waitForWorkerBootstrap(root, parentExit.pid);
    ownedPids.add(workerBootstrap.pid);
    const ready = await waitForFile(workerReady);
    workerPid = ready.pid;
    ownedPids.add(workerPid);
    const workerStarted = await waitForFile(join(root, `worker-started-${workerPid}.json`));
    assert.equal(workerStarted.lockAcquired, true);
    assert.equal(workerStarted.pid, workerPid);
    assert.equal(ready.mode, "worker");
    assert.equal(ready.lockAcquired, true);
    assert.equal(ready.userDataPath, workerProfile);
    assert.equal(ready.sessionDataPath, workerProfile);
    assert.equal(ready.storagePathUnderWorkerProfile, true);
    assert.equal(ready.sourceProfileNotOpenedByWorkerSession, true);
    assert.equal(ready.parentAlive, false, "the source Electron process must exit before worker readiness");

    const contender = launchElectron(ownedPids, ["--", "competitor", root, String(round), token], origin);
    await contender.done;
    const competitor = await waitForFile(competitorResult);
    assert.equal(competitor.lockAcquired, false, "a concurrent normal-profile launch must be refused");
    assert.equal(competitor.sourceSessionAccessed, false, "refused competitor must not open a source session");

    const refusedWorker = launchElectron(ownedPids, ["--", "worker", root, String(round), token, "0"], origin);
    await refusedWorker.done;
    const refusedWorkerMarker = await waitForFile(join(root, `refused-worker-${refusedWorker.pid}.json`));
    assert.equal(refusedWorkerMarker.lockAcquired, false, "a concurrent worker launch must not steal source-profile ownership");
    assert.equal(refusedWorkerMarker.defaultSessionOpened, false, "refused worker must fail before opening a Chromium session");
    assert.equal(refusedWorkerMarker.backupStarted, false, "refused worker must fail before copying storage");
    await writeFile(continuePath, "copy may begin after ownership proof");

    const result = await waitForFile(resultPath);
    await waitForPidExit(workerPid);
    ownedPids.delete(workerPid);
    assert.equal(result.outcome, "captured");
    assert.equal(result.round, String(round));
    assert.equal(result.parentExitObserved, true);
    assert.equal(result.workerLockAcquired, true);
    assert.equal(result.userDataPath, workerProfile);
    assert.equal(result.sessionDataPath, workerProfile);
    assert.equal(result.defaultSessionStorageUnderWorkerProfile, true);
    assert.equal(result.workerLocalStorageExists, true, "the actual worker Local Storage directory must exist after a Chromium write");
    assert.equal(result.workerIndexedDbExists, true, "the actual worker IndexedDB directory must exist after a Chromium write");
    assert.equal(result.workerLocalStorageCurrentExists, true, "the worker Local Storage LevelDB must have a CURRENT file");
    assert.equal(result.workerIndexedDbCurrentExists, true, "the worker IndexedDB LevelDB must have a CURRENT file");
    assert.equal(result.sourceLocalStorage, `local-${round}`);
    assert.deepEqual(result.restoredLocalStorage, { round: String(round), value: `local-${round}` });
    assert.deepEqual(result.restoredIndexedDb, { id: "save", round: String(round), value: `indexed-${round}` });
    assert.equal(result.restoredWorkerLocalStorage, null, "worker-only Local Storage must not appear in the copied source profile");
    assert.equal(result.restoredWorkerIndexedDb, null, "worker-only IndexedDB data must not appear in the copied source profile");
    assert.deepEqual(result.included, ["IndexedDB", "Local Storage", "Session Storage"]);
    assert.equal(result.restoredDatabaseReopened, true);
    assert.ok(result.restoredSessionStorageObserved === null || typeof result.restoredSessionStorageObserved === "string");
    assert.equal(result.sessionStorageClaim, "observation only; directory copying does not guarantee hydration into a new browsing context");
    assert.match(result.versions.electron, /^\d+\.\d+\.\d+$/);
    assert.match(result.versions.chromium, /^\d+\.\d+\.\d+(?:\.\d+)?$/);
    assert.match(result.versions.node, /^\d+\.\d+\.\d+$/);
    assert.equal(result.platform, process.platform);
    assert.equal(result.osRelease, osRelease());
    return { parentExit, ready, contender, result };
  } catch (error) {
    const names = await readdir(root).catch(() => []);
    const diagnostics = await Promise.all(names.filter(name => /^(failure-|result\.json\.started|worker-started)/.test(name)).map(async name => `${name}: ${await readFile(join(root, name), "utf8")}`));
    throw new Error(`${error.message}${diagnostics.length ? `\n${diagnostics.join("\n")}` : ""}`, { cause: error });
  } finally {
    for (const pid of ownedPids) await stopOwnedPid(pid);
  }
}

async function runVetoedCapture(root, origin) {
  const token = `cancel-${Date.now()}`;
  const vetoObserved = join(root, "veto-observed.json");
  const releaseVeto = join(root, "release-veto");
  const resultPath = join(root, "result.json");
  const backupRoot = join(root, "backups");
  const ownedPids = new Set();
  let workerPid;
  try {
    const parent = launchElectron(ownedPids, ["--", "veto-parent", root, "veto", token], origin);
    const veto = await waitForFile(vetoObserved);
    assert.equal(veto.vetoPrevented, true);
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
    const earlyFilesWhileVetoed = (await readdir(root)).filter(name => /^probe-early-\d+\.json$/.test(name));
    const earlyMarkersWhileVetoed = await Promise.all(earlyFilesWhileVetoed.map(name => readFile(join(root, name), "utf8").then(JSON.parse)));
    assert.equal(earlyMarkersWhileVetoed.some(marker => marker.mode === "worker"), false, "app.relaunch must not start its worker while the first quit is vetoed");
    assert.equal(parent.child.exitCode, null, "the vetoed parent must remain alive until the test releases it");
    await writeFile(releaseVeto, "invalidate the queued request before a later quit");
    const parentExit = await parent.done;
    const workerBootstrap = await waitForWorkerBootstrap(root, parentExit.pid);
    ownedPids.add(workerBootstrap.pid);
    const result = await waitForFile(resultPath);
    workerPid = result.workerPid;
    if (workerPid) ownedPids.add(workerPid);
    const workerStarted = await waitForFile(join(root, `worker-started-${workerPid}.json`));
    assert.equal(workerStarted.lockAcquired, true);
    assert.equal(workerStarted.pid, workerPid);
    assert.equal(result.outcome, "cancelled-worker-rejected");
    assert.equal(result.copyStarted, false, "the queued worker must reject the invalidated intent before copying");
    assert.equal(existsSync(backupRoot), false, "veto/cancel must not create a backup");
    await waitForPidExit(workerPid);
    ownedPids.delete(workerPid);
    return { veto, parentExit, result };
  } catch (error) {
    const names = await readdir(root).catch(() => []);
    const diagnostics = await Promise.all(names.filter(name => /^(failure-|result\.json\.started|worker-started)/.test(name)).map(async name => `${name}: ${await readFile(join(root, name), "utf8")}`));
    throw new Error(`${error.message}${diagnostics.length ? `\n${diagnostics.join("\n")}` : ""}`, { cause: error });
  } finally {
    for (const pid of ownedPids) await stopOwnedPid(pid);
  }
}

test("cold capture waits for Electron exit, isolates the worker profile, and invalidates vetoed requests", { timeout: 240_000 }, async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "pokerogue-cold-capture-r14-"));
  const { server, origin } = await startServer();
  try {
    const outcomes = [];
    for (let round = 1; round <= rounds; round += 1) {
      outcomes.push(await runCaptureRound(join(tempRoot, `round-${round}`), origin, round));
    }
    const cancellation = await runVetoedCapture(join(tempRoot, "veto"), origin);
    assert.equal(outcomes.length, rounds);
    assert.equal(cancellation.result.outcome, "cancelled-worker-rejected");
    process.stdout.write(JSON.stringify({ rounds, electron: outcomes[0].result.versions.electron, chromium: outcomes[0].result.versions.chromium, node: outcomes[0].result.versions.node, platform: process.platform, arch: process.arch, osRelease: osRelease(), cancellation: cancellation.result.outcome }) + "\n");
  } catch (error) {
    const entries = await readdir(tempRoot, { recursive: true, withFileTypes: true }).catch(() => []);
    const diagnostics = await Promise.all(entries.filter(entry => entry.isFile() && /^(?:failure-|result\.json(?:\.started)?$|worker-ready\.json$|worker-started-\d+\.json$|refused-worker-\d+\.json$|competitor\.json$|veto-observed\.json$|probe-early-\d+\.json$)/.test(entry.name)).map(async entry => {
      const file = join(entry.parentPath ?? tempRoot, entry.name);
      const contents = await readFile(file, "utf8").catch(readError => readError.message);
      return `${file}: ${contents.slice(0, 4000)}`;
    }));
    throw new Error(`${error.message}\nTemp evidence ${tempRoot}:\n${diagnostics.join("\n")}`, { cause: error });
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
    await rm(tempRoot, { recursive: true, force: true });
  }
});
