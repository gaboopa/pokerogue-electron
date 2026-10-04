const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { app, BrowserWindow, session } = require("electron");

const contextKey = Symbol.for("pokerogue.backup-worker-context");
const context = () => globalThis[contextKey];
const root = () => process.env.POKEROGUE_R17_TEST_ROOT;
const origin = () => process.env.POKEROGUE_R17_TEST_ORIGIN;
const source = () => process.env.POKEROGUE_R17_TEST_SOURCE;
const resultPath = () => path.join(root(), "result.json");
const page = `<!doctype html><meta charset="utf-8"><script>
(async () => {
  const params = new URL(location.href).searchParams;
  const mode = params.get("mode");
  const round = params.get("round");
  const dbName = "r17-worker-proof";
  const open = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("records", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const writeRecord = async (db, record) => new Promise((resolve, reject) => {
    const tx = db.transaction("records", "readwrite");
    tx.objectStore("records").put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB write aborted"));
  });
  if (mode === "seed") {
    localStorage.setItem("r17-save", JSON.stringify({ round, value: "source-local-" + round }));
    sessionStorage.setItem("r17-context", "context-" + round);
    const db = await open();
    await writeRecord(db, { id: "save", round, value: "source-indexed-" + round });
    db.close();
    window.probeResult = { local: JSON.parse(localStorage.getItem("r17-save")), contextValue: sessionStorage.getItem("r17-context") };
    window.probeReady = true;
  } else if (mode === "worker") {
    localStorage.setItem("r17-worker-only", "worker-local-" + round);
    const db = await open();
    await writeRecord(db, { id: "worker", round, value: "worker-indexed-" + round });
    db.close();
    window.probeReady = true;
  } else if (mode === "read") {
    const db = await open();
    const records = await new Promise((resolve, reject) => {
      const tx = db.transaction("records", "readonly");
      const save = tx.objectStore("records").get("save");
      const worker = tx.objectStore("records").get("worker");
      tx.oncomplete = () => resolve({ save: save.result, worker: worker.result ?? null });
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB read aborted"));
    });
    db.close();
    window.probeResult = {
      local: JSON.parse(localStorage.getItem("r17-save")),
      workerLocal: localStorage.getItem("r17-worker-only"),
      save: records.save,
      worker: records.worker,
      sessionStorageObserved: sessionStorage.getItem("r17-context"),
    };
    window.probeReady = true;
  }
})().catch(error => { window.probeError = error.stack ?? String(error); });
</script>`;

let failureReported = false;
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}
function reportFailure(error) {
  if (failureReported) return;
  failureReported = true;
  const record = { pid: process.pid, argv: process.argv, error: error?.stack ?? String(error) };
  process.stderr.write(`${JSON.stringify({ code: "r17-probe-failed", ...record })}\n`);
  try { writeJson(path.join(root(), `probe-failure-${process.pid}.json`), record); } catch {}
  app.exit(1);
}
process.on("uncaughtException", reportFailure);
process.on("unhandledRejection", reportFailure);

function isWithin(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
function isPidRunning(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
}
async function waitForFile(file, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { await fsp.access(file); return; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for test control file ${file}`);
}
async function waitForRenderer(window, label) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const state = await window.webContents.executeJavaScript("({ ready: window.probeReady === true, error: window.probeError ?? null })");
    if (state.error) throw new Error(`${label} page failed: ${state.error}`);
    if (state.ready) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
function hiddenWindow(profileSession = session.defaultSession) {
  const window = new BrowserWindow({
    show: false,
    autoHideMenuBar: true,
    webPreferences: { session: profileSession, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  });
  window.webContents.once("render-process-gone", (_event, details) => reportFailure(new Error(`Hidden probe renderer exited: ${JSON.stringify(details)}`)));
  return window;
}
async function openPage(profileSession, mode, round, label) {
  const window = hiddenWindow(profileSession);
  await window.loadURL(`${origin()}/?mode=${encodeURIComponent(mode)}&round=${encodeURIComponent(round)}`);
  await waitForRenderer(window, label);
  return window;
}

async function runProbe(mode) {
  try {
    if (!root() || !source() || !origin() || context()?.lockAcquired !== true) throw new Error("R17 test probe requires disposable paths, loopback origin and the source-profile lock");
    const round = process.env.POKEROGUE_R17_ROUND ?? "1";
    const intentModule = await import("../../src/backup-coordinator.mjs");
    await app.whenReady();
    if (mode === "parent") {
      const sourceWindow = await openPage(session.defaultSession, "seed", round, "source Local Storage and IndexedDB writes");
      await session.defaultSession.flushStorageData();
      const intent = await intentModule.createIntent({ userData: source(), operation: "manual", payload: {} });
      writeJson(path.join(root(), "parent-ready.json"), {
        pid: process.pid,
        argv: process.argv,
        lockAcquired: context().lockAcquired,
        userData: app.getPath("userData"),
        sessionData: app.getPath("sessionData"),
        defaultSessionPath: session.defaultSession.storagePath,
        token: intent.token,
        round,
      });
      await waitForFile(path.join(root(), "continue-parent"));
      await sourceWindow.close();
      await session.defaultSession.flushStorageData();
      app.relaunch({ args: [
        app.getAppPath(), "--", "--backup-worker", `--backup-token=${intent.token}`,
        `--backup-parent-pid=${process.pid}`, `--r17-probe=${process.env.POKEROGUE_R17_WORKER_MODE ?? "worker"}`,
      ] });
      app.quit();
      return;
    }

    if (mode === "verify") {
      const result = JSON.parse(await fsp.readFile(resultPath(), "utf8"));
      if (isPidRunning(result.workerPid)) throw new Error(`Normal app relaunched before worker ${result.workerPid} exited`);
      const intent = await intentModule.readIntent({ userData: source(), expectedToken: result.token });
      if (intent.state !== "captured" || intent.capturedBackupPath !== result.backupPath) throw new Error("Normal relaunch did not observe the captured intent");
      writeJson(path.join(root(), "verified.json"), {
        pid: process.pid,
        argv: process.argv,
        lockAcquired: context().lockAcquired,
        workerPid: result.workerPid,
        workerExitedBeforeNormalStartup: true,
        workerProfileExistsAfterExit: fs.existsSync(result.workerProfile),
        retainedMarker: fs.existsSync(path.join(result.workerProfile, "r17-worker-retain.marker"))
          ? fs.readFileSync(path.join(result.workerProfile, "r17-worker-retain.marker"), "utf8")
          : null,
        intentState: intent.state,
      });
      app.exit(0);
      return;
    }
    throw new Error(`Unsupported R17 probe phase: ${mode}`);
  } catch (error) { reportFailure(error); }
}

async function runWorkerProbe(workerContext, capture) {
  const workerPaths = {
    userData: app.getPath("userData"),
    sessionData: app.getPath("sessionData"),
    defaultSession: session.defaultSession.storagePath,
  };
  if (workerPaths.userData !== workerContext.workerProfile || workerPaths.sessionData !== workerContext.workerProfile) {
    throw new Error("Worker userData and sessionData did not both switch before readiness");
  }
  const sourceStorageRoots = ["Local Storage", "IndexedDB", "Session Storage"].map(name => path.join(source(), name));
  if (!isWithin(workerContext.workerProfile, workerPaths.defaultSession) || sourceStorageRoots.some(storageRoot => isWithin(storageRoot, workerPaths.defaultSession))) {
    throw new Error(`Worker defaultSession escaped the isolated helper profile: ${workerPaths.defaultSession}`);
  }

  const round = process.env.POKEROGUE_R17_ROUND ?? "1";
  const workerWindow = await openPage(session.defaultSession, "worker", round, "worker-profile Local Storage and IndexedDB writes");
  await session.defaultSession.flushStorageData();
  const localRoot = path.join(workerContext.workerProfile, "Local Storage");
  const indexedRoot = path.join(workerContext.workerProfile, "IndexedDB");
  if (!fs.statSync(localRoot).isDirectory() || !fs.statSync(indexedRoot).isDirectory()) throw new Error("Actual worker Local Storage and IndexedDB directories were not created");

  const restoreProfile = path.join(root(), "restore-profile");
  const { restoreBackup } = await import("../../src/backup.mjs");
  await restoreBackup(restoreProfile, capture.backupPath);
  const restoredSession = session.fromPath(restoreProfile);
  const restoredWindow = await openPage(restoredSession, "read", round, "restored profile database reopen");
  const restored = await restoredWindow.webContents.executeJavaScript("window.probeResult");
  await restoredSession.flushStorageData();

  const result = {
    outcome: "captured",
    round,
    token: workerContext.token,
    workerPid: process.pid,
    workerProfile: workerContext.workerProfile,
    parentPid: workerContext.parentPid,
    parentExited: !isPidRunning(workerContext.parentPid),
    sourceLockAcquired: workerContext.lockAcquired,
    argv: process.argv,
    execPath: process.execPath,
    appPath: app.getAppPath(),
    versions: { electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node },
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    sourceUserData: source(),
    workerPaths,
    backupPath: capture.backupPath,
    included: capture.manifest.included,
    restoredLocalStorage: restored.local,
    restoredIndexedDb: restored.save,
    workerOnlyLocalStorage: restored.workerLocal,
    workerOnlyIndexedDb: restored.worker,
    sessionStorageObserved: restored.sessionStorageObserved,
    sessionStorageClaim: "observation only; copying Session Storage does not promise hydration in a new browsing context",
  };
  writeJson(resultPath(), result);
  writeJson(path.join(root(), `worker-ready-${process.pid}.json`), result);
  await waitForFile(path.join(root(), "continue-worker"));
  await workerWindow.close();
  await restoredWindow.close();
  await restoredSession.closeAllConnections();
}

async function runColdWorkerProbe(workerContext, capture) {
  if (workerContext.lockAcquired !== true || workerContext.sourceUserData !== source()) throw new Error("Sessionless worker probe has invalid source ownership context");
  if (workerContext.testProbe === "worker-retain") await fsp.writeFile(path.join(workerContext.workerProfile, "r17-worker-retain.marker"), "test-owned nonempty worker profile");
  const runtimeEntries = await fsp.readdir(workerContext.workerProfile);
  const result = {
    outcome: "captured-without-session",
    token: workerContext.token,
    workerPid: process.pid,
    workerProfile: workerContext.workerProfile,
    parentPid: workerContext.parentPid,
    parentExited: !isPidRunning(workerContext.parentPid),
    sourceLockAcquired: workerContext.lockAcquired,
    runtimeEntries,
    userData: app.getPath("userData"),
    sessionData: app.getPath("sessionData"),
    backupPath: capture.backupPath,
    included: capture.manifest.included,
    versions: { electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node },
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    sessionStorageClaim: "observation only; copying Session Storage does not promise hydration in a new browsing context",
  };
  writeJson(resultPath(), result);
  writeJson(path.join(root(), `worker-ready-${process.pid}.json`), result);
  await waitForFile(path.join(root(), "continue-worker"));
}

exports.runProbe = runProbe;
exports.runWorkerProbe = runWorkerProbe;
exports.runColdWorkerProbe = runColdWorkerProbe;
