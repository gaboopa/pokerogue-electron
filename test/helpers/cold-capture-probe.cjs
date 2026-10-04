const earlyArgs = process.argv.slice(2);
if (earlyArgs[0] === "--") earlyArgs.shift();
const earlyMode = earlyArgs[0] ?? "";
const earlyRoot = earlyArgs[1] ?? "";
if (earlyRoot) {
  try {
    require("node:fs").mkdirSync(earlyRoot, { recursive: true });
    require("node:fs").writeFileSync(require("node:path").join(earlyRoot, `probe-early-${process.pid}.json`), JSON.stringify({ pid: process.pid, mode: earlyMode, root: earlyRoot, argv: process.argv, execPath: process.execPath, versions: process.versions }));
  } catch {}
}
function reportPreloadFailure(error) {
  process.stderr.write(`${JSON.stringify({ probePreloadFailure: error?.stack ?? String(error), pid: process.pid, argv: process.argv })}\n`);
  process.exit(1);
}
process.on("uncaughtException", reportPreloadFailure);

const electronApi = require("electron");
process.removeListener("uncaughtException", reportPreloadFailure);
const { app, BrowserWindow, session } = electronApi;
process.on("uncaughtException", reportFailure);
process.on("unhandledRejection", reportFailure);

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const { relative, resolve, join, isAbsolute } = require("node:path");
const { release: osRelease } = require("node:os");
const { pathToFileURL } = require("node:url");

process.stderr.write(`${JSON.stringify({ probeBootstrap: true, pid: process.pid, argv: process.argv, execPath: process.execPath })}\n`);

let mode = "bootstrap";
let root = "";
let failureReported = false;
let timeout;
let lockAcquired = false;
let shouldStart = true;
let intent;

function writeJson(path, value) {
  fs.mkdirSync(require("node:path").dirname(path), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(value));
}

function reportFailure(error) {
  if (failureReported) return;
  failureReported = true;
  const details = { mode, pid: process.pid, argv: process.argv, error: error?.stack ?? String(error) };
  console.error(JSON.stringify(details));
  try {
    if (root) writeJson(join(root, `failure-${mode}-${process.pid}.json`), details);
  } catch (writeError) {
    console.error(`Could not persist probe failure details: ${writeError?.stack ?? writeError}`);
  }
  clearTimeout(timeout);
  app.exit(1);
}

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
mode = args[0] ?? "";
root = resolve(args[1] ?? "");
const origin = process.env.POKEROGUE_R14_ORIGIN ?? "";
const round = args[2] ?? "";
const token = args[3] ?? "";
const expectedSource = join(root, "source");
const workerProfile = join(root, "worker-profile");
const backupRoot = join(root, "backups");
const restoreProfile = join(root, "restore-profile");
const intentPath = join(root, "intent.json");
const workerReadyPath = join(root, "worker-ready.json");
const workerStartedPath = pid => join(root, `worker-started-${pid}.json`);
const refusedWorkerPath = pid => join(root, `refused-worker-${pid}.json`);
const competitorResultPath = join(root, "competitor.json");
const continuePath = join(root, "continue-worker");
const resultPath = join(root, "result.json");
const vetoObservedPath = join(root, "veto-observed.json");
const releaseVetoPath = join(root, "release-veto");
try {
  if (!root || !origin || !round || !token) throw new Error("Probe requires explicit root, loopback origin, round, and token arguments");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(`${resultPath}.started`, JSON.stringify(process.argv));
  app.setName("PokeRogueR14ColdCaptureProbe");
  if (["parent", "veto-parent", "competitor", "worker"].includes(mode)) {
    setProfilePaths(expectedSource);
    lockAcquired = app.requestSingleInstanceLock({ probe: mode, token });
  }
  if (mode === "competitor") {
    writeJson(competitorResultPath, { lockAcquired, sourceSessionAccessed: false, pid: process.pid, argv: process.argv });
    shouldStart = false;
    app.exit(lockAcquired ? 2 : 0);
  } else if (mode === "worker") {
    const parentPid = Number(args[4]);
    if (!lockAcquired) {
      writeJson(refusedWorkerPath(process.pid), { mode: "worker", pid: process.pid, argv: process.argv, lockAcquired, defaultSessionOpened: false, backupStarted: false });
      shouldStart = false;
      app.exit(0);
    } else {
      writeJson(workerStartedPath(process.pid), { mode: "worker", pid: process.pid, argv: process.argv, lockAcquired });
    intent = JSON.parse(fs.readFileSync(intentPath, "utf8"));
    if (intent.version !== 1 || intent.token !== token || intent.sourceProfile !== expectedSource) {
      throw new Error("Worker rejected malformed or mismatched capture intent");
    }
    if (intent.state === "cancelled") {
      writeJson(resultPath, { outcome: "cancelled-worker-rejected", copyStarted: false, workerPid: process.pid, parentPid, intentState: intent.state });
      shouldStart = false;
      app.exit(0);
    } else {
      if (intent.state !== "requested") throw new Error(`Worker rejected unexpected intent state: ${intent.state}`);
      setProfilePaths(workerProfile);
    }
    }
  } else if (mode === "parent" || mode === "veto-parent") {
    if (!lockAcquired) throw new Error("Initial source profile did not acquire the probe's single-instance lock");
  } else {
    throw new Error(`Unsupported probe mode: ${mode}`);
  }
} catch (error) {
  reportFailure(error);
}

function setProfilePaths(profilePath) {
  const absoluteProfile = resolve(profilePath);
  fs.mkdirSync(absoluteProfile, { recursive: true });
  app.setPath("userData", absoluteProfile);
  app.setPath("sessionData", absoluteProfile);
}

function isWithin(parent, child) {
  const path = relative(resolve(parent), resolve(child));
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function hasLevelDbCurrentFile(directory) {
  try {
    return fs.readdirSync(directory, { recursive: true, withFileTypes: true }).some(entry => entry.isFile() && entry.name === "CURRENT");
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function isPidRunning(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
}

async function waitForFile(path, deadlineMs = 20_000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try { await fsp.access(path); return; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
  }
  throw new Error(`Timed out waiting for probe control file: ${path}`);
}

async function waitForWindow(window, predicate, label, deadlineMs = 8_000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const state = await window.webContents.executeJavaScript("({ ready: window.probeReady === true, error: window.probeError ?? null })");
    if (state.error) throw new Error(`${label} renderer failed: ${state.error}`);
    if (state.ready) return;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function hiddenWindow(storageSession = session.defaultSession) {
  const window = new BrowserWindow({
    show: false,
    autoHideMenuBar: true,
    webPreferences: { session: storageSession, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  });
  window.webContents.once("render-process-gone", (_event, details) => reportFailure(new Error(`Probe renderer exited: ${JSON.stringify(details)}`)));
  return window;
}

async function seedSource() {
  const sourceWindow = hiddenWindow();
  await sourceWindow.loadURL(`${origin}/probe?mode=seed&round=${encodeURIComponent(round)}`);
  await waitForWindow(sourceWindow, "window.probeReady === true", "source seed");
  await session.defaultSession.flushStorageData();
  return sourceWindow;
}

function relaunchWorker(parentPid) {
  app.relaunch({
    args: [__filename, "--", "worker", root, round, token, String(parentPid)],
  });
  app.quit();
}

async function runParent(veto) {
  const sourceWindow = await seedSource();
  const sourceStoragePath = session.defaultSession.storagePath;
  if (!isWithin(expectedSource, sourceStoragePath)) throw new Error(`Source default session escaped its disposable profile: ${sourceStoragePath}`);
  const sourceSnapshot = await sourceWindow.webContents.executeJavaScript("window.probeResult");
  const captureIntent = { version: 1, token, state: "requested", sourceProfile: expectedSource, backupRoot, round: String(round), sourceSnapshot };
  writeJson(intentPath, captureIntent);

  if (!veto) {
    await session.defaultSession.flushStorageData();
    relaunchWorker(process.pid);
    return;
  }

  let vetoFirstQuit = true;
  app.on("before-quit", event => {
    if (!vetoFirstQuit) return;
    vetoFirstQuit = false;
    event.preventDefault();
    writeJson(vetoObservedPath, { vetoPrevented: true, pid: process.pid, relaunchRequested: true });
  });
  await session.defaultSession.flushStorageData();
  relaunchWorker(process.pid);
  await waitForFile(releaseVetoPath, 25_000);
  const cancelled = JSON.parse(await fsp.readFile(intentPath, "utf8"));
  cancelled.state = "cancelled";
  cancelled.cancelledAt = new Date().toISOString();
  writeJson(intentPath, cancelled);
  app.quit();
  void sourceWindow;
}

async function runWorker(parentPid) {
  const parentAliveBeforeReady = isPidRunning(Number(parentPid));
  if (parentAliveBeforeReady) throw new Error(`Source process ${parentPid} still exists when worker starts`);

  await app.whenReady();
  const defaultSession = session.defaultSession;
  const defaultStoragePath = defaultSession.storagePath;
  const workerPaths = {
    userDataPath: app.getPath("userData"),
    sessionDataPath: app.getPath("sessionData"),
    defaultSessionStoragePath: defaultStoragePath,
  };
  if (workerPaths.userDataPath !== workerProfile) throw new Error(`Worker userData is not isolated: ${workerPaths.userDataPath}`);
  if (workerPaths.sessionDataPath !== workerProfile) throw new Error(`Worker sessionData remained outside its isolated profile: ${workerPaths.sessionDataPath}`);
  if (!isWithin(workerProfile, defaultStoragePath)) throw new Error(`Worker default session storage is not isolated: ${defaultStoragePath}`);
  if (isWithin(expectedSource, defaultStoragePath)) throw new Error(`Worker default session still points into source profile: ${defaultStoragePath}`);

  const workerWindow = hiddenWindow(defaultSession);
  await workerWindow.loadURL(`${origin}/probe?mode=worker&round=${encodeURIComponent(round)}`);
  await waitForWindow(workerWindow, "window.probeReady === true", "worker-profile storage write");
  await defaultSession.flushStorageData();
  const workerLocalRoot = join(workerProfile, "Local Storage");
  const workerIndexedRoot = join(workerProfile, "IndexedDB");
  const workerLocalStorageExists = fs.statSync(workerLocalRoot).isDirectory();
  const workerIndexedDbExists = fs.statSync(workerIndexedRoot).isDirectory();
  const workerLocalStorageCurrentExists = hasLevelDbCurrentFile(workerLocalRoot);
  const workerIndexedDbCurrentExists = hasLevelDbCurrentFile(workerIndexedRoot);
  const workerRootsIsolated = isWithin(workerProfile, workerLocalRoot) && isWithin(workerProfile, workerIndexedRoot) && !isWithin(expectedSource, workerLocalRoot) && !isWithin(expectedSource, workerIndexedRoot) && workerLocalStorageExists && workerIndexedDbExists;
  if (!workerRootsIsolated) throw new Error("Worker storage directory roots overlap the source profile");

  writeJson(workerReadyPath, {
    mode: "worker",
    pid: process.pid,
    parentPid: Number(parentPid),
    parentAlive: parentAliveBeforeReady,
    lockAcquired,
    userDataPath: workerPaths.userDataPath,
    sessionDataPath: workerPaths.sessionDataPath,
    defaultSessionStoragePath: workerPaths.defaultSessionStoragePath,
    storagePathUnderWorkerProfile: isWithin(workerProfile, defaultStoragePath),
    sourceProfileNotOpenedByWorkerSession: !isWithin(expectedSource, defaultStoragePath),
    workerRootsIsolated,
    workerLocalStorageExists,
    workerIndexedDbExists,
    workerLocalStorageCurrentExists,
    workerIndexedDbCurrentExists,
    argv: process.argv,
  });
  await waitForFile(continuePath, 25_000);
  if (isPidRunning(Number(parentPid))) throw new Error(`Source process ${parentPid} became live again before copy`);

  const { createBackup, restoreBackup, validateBackup } = await import(pathToFileURL(join(__dirname, "../../src/backup.mjs")).href);
  const backupPath = await createBackup(expectedSource, backupRoot);
  const manifest = await validateBackup(backupPath);
  await restoreBackup(restoreProfile, backupPath);

  const restoredSession = session.fromPath(restoreProfile);
  const restoredWindow = hiddenWindow(restoredSession);
  await restoredWindow.loadURL(`${origin}/probe?mode=read&round=${encodeURIComponent(round)}`);
  await waitForWindow(restoredWindow, "window.probeReady === true", "restored profile database reopen");
  const restored = await restoredWindow.webContents.executeJavaScript("window.probeResult");
  await restoredSession.flushStorageData();

  const result = {
    outcome: "captured",
    round: String(round),
    parentExitObserved: !isPidRunning(Number(parentPid)),
    parentPid: Number(parentPid),
    workerPid: process.pid,
    workerLockAcquired: lockAcquired,
    userDataPath: workerPaths.userDataPath,
    sessionDataPath: workerPaths.sessionDataPath,
    defaultSessionStoragePath: workerPaths.defaultSessionStoragePath,
    defaultSessionStorageUnderWorkerProfile: isWithin(workerProfile, defaultStoragePath),
    workerRootsIsolated,
    workerLocalStorageExists,
    workerIndexedDbExists,
    workerLocalStorageCurrentExists,
    workerIndexedDbCurrentExists,
    sourceSnapshot: intent.sourceSnapshot,
    sourceLocalStorage: intent.sourceSnapshot.local.value,
    included: manifest.included,
    backupSchemaVersion: manifest.schemaVersion,
    restoredLocalStorage: restored.local,
    restoredIndexedDb: restored.idb,
    restoredWorkerLocalStorage: restored.workerLocalStorage,
    restoredWorkerIndexedDb: restored.workerRecord,
    restoredMatchesSource: JSON.stringify(restored.local) === JSON.stringify(intent.sourceSnapshot.local) && JSON.stringify(restored.idb) === JSON.stringify(intent.sourceSnapshot.idb),
    restoredDatabaseReopened: Boolean(restored.idb),
    restoredSessionStorageObserved: restored.contextValue,
    sessionStorageClaim: "observation only; directory copying does not guarantee hydration into a new browsing context",
    versions: { electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node },
    platform: process.platform,
    arch: process.arch,
    osRelease: osRelease(),
    argv: process.argv,
  };
  writeJson(resultPath, result);
  void workerWindow;
  void restoredWindow;
  app.exit(0);
}

async function start() {
  timeout = setTimeout(() => reportFailure(new Error(`Cold-capture ${mode} probe timed out`)), 60_000);
  if (mode === "parent" || mode === "veto-parent") {
    await runParent(mode === "veto-parent");
    return;
  }
  if (mode === "worker") {
    await runWorker(args[4]);
    return;
  }
  throw new Error(`Unsupported probe mode: ${mode}`);
}

if (shouldStart) app.whenReady().then(start).catch(reportFailure);
