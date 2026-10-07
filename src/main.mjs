import { app, BrowserWindow, dialog, Menu, protocol, session, shell } from "electron";
// Namespace import: the test shims for "electron" do not export clipboard.
import * as electron from "electron";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_ORIGIN, AUTOMATIC_BACKUPS_KEPT, BACKUP_TOKEN_PATTERN, PRODUCT_NAME, UPDATE_REPOSITORY } from "./constants.mjs";
import { offerOldInstallers, pruneAutomaticBackups, pruneUpdateDownloads } from "./retention.mjs";
import { BackupRestoreError, restoreBackup, validateBackup } from "./backup.mjs";
import { applyCheatConfiguration } from "./cheats.mjs";
import { createCheatController } from "./cheat-main.mjs";
import { createBackupController } from "./backup-main.mjs";
import { assertValidProfileName, createProfile, listProfiles, setActiveProfile } from "./profiles.mjs";
import { createProfileController } from "./profile-main.mjs";
import { keymapModifiedAt, loadKeymap, resetKeymap } from "./keymap-store.mjs";
import { checkForUpdate, downloadVerified } from "./updater.mjs";
import { registerGameProtocol } from "./protocol.mjs";
import { createUtilitiesSubmenu } from "./utilities.mjs";
import { createMenuTemplate } from "./menu.mjs";
import { clearTerminalIntent, createIntent, prepareResumeIntent, readCurrentIntent, recoverStaleIntentLock, revalidateResumingUpdate, transitionIntent } from "./backup-coordinator.mjs";
import { formatDiagnosticReport, summarizeBackups } from "./diagnostics.mjs";

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: true } }]);
app.setName(PRODUCT_NAME);

const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const windowIcon = process.platform === "win32" ? join(moduleRoot, "build", "icon.ico") : undefined;
const gameRoot = app.isPackaged ? join(process.resourcesPath, "game") : join(moduleRoot, "staging", "game");
let mainWindow;
let keymapMtime = 0;
const chartWindows = new Map();
let cheatController;
let backupController;
let profileController;
let startupRecoveryBlocked = false;
let startupReady = false;
let startupRestarting = false;
let backupRequestPromise;
let backupRequestActive = false;

function getLiveMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  mainWindow = undefined;
  return undefined;
}

function showMessageBox(options, parent = getLiveMainWindow()) {
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
}

function showOpenDialog(options, parent = getLiveMainWindow()) {
  return parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options);
}

function showBackupAlreadyInProgress() {
  return showMessageBox({ type: "info", title: "Backup already in progress", message: "Another Backup or Update continuation already owns the cold capture request." });
}

function showColdBackupComplete(intent, detail) {
  return showMessageBox({ type: "info", title: intent.operation === "update" ? "Update backup complete" : "Save backup complete", message: intent.operation === "update" ? "The required cold Backup completed." : "Your saves were backed up.", detail });
}

function showColdBackupFailed(intent, detail) {
  return showMessageBox({ type: "warning", title: intent.operation === "update" ? "Update backup did not complete" : "Backup not completed", message: intent.operation === "update" ? "The Update was downloaded, but its required cold Backup did not complete." : "The requested Backup did not complete.", detail });
}

function paths() {
  const userData = app.getPath("userData");
  const root = globalThis[Symbol.for("pokerogue.profile-context")]?.root ?? userData;
  return { root, userData, backupRoot: join(userData, "Save Backups"), downloadRoot: join(userData, "Updates"), keymap: join(root, "keymap.json"), cheats: join(userData, "cheats.json") };
}

async function diagnosticFacts() {
  const profileContext = globalThis[Symbol.for("pokerogue.profile-context")];
  const unavailable = "unavailable";
  const facts = {
    version: unavailable, packaged: unavailable, platform: unavailable, arch: unavailable, osVersion: unavailable,
    electron: unavailable, chrome: unavailable, node: unavailable,
    revisions: { game: unavailable, assets: unavailable, locales: unavailable },
    profileName: unavailable, profileCount: unavailable,
    backups: { count: unavailable }, pending: unavailable,
  };
  try { facts.version = app.getVersion(); } catch {}
  try { facts.packaged = app.isPackaged; } catch {}
  try { facts.platform = process.platform; } catch {}
  try { facts.arch = process.arch; } catch {}
  try {
    const systemName = { win32: "Windows", darwin: "macOS", linux: "Linux" }[process.platform] ?? process.platform;
    facts.osVersion = `${systemName} ${process.getSystemVersion()}`;
  } catch {}
  try { facts.electron = process.versions.electron; } catch {}
  try { facts.chrome = process.versions.chrome; } catch {}
  try { facts.node = process.versions.node; } catch {}
  try {
    const revisionPath = app.isPackaged ? join(process.resourcesPath, "revisions.json") : join(moduleRoot, "staging", "revisions.json");
    const revisions = JSON.parse(await readFile(revisionPath, "utf8"));
    if (!revisions || typeof revisions !== "object" || Array.isArray(revisions) ||
        !["game", "assets", "locales"].every(key => typeof revisions[key] === "string" && /^[a-f\d]{40,64}$/i.test(revisions[key]))) throw new Error("Malformed revisions file");
    facts.revisions = { game: revisions.game, assets: revisions.assets, locales: revisions.locales };
  } catch {}
  try {
    facts.profileName = profileContext?.name ?? null;
    facts.profileCount = listProfiles(profileContext?.root ?? app.getPath("userData")).length + 1;
  } catch {}
  try {
    const entries = await readdir(paths().backupRoot, { withFileTypes: true });
    facts.backups = summarizeBackups(entries.filter(entry => entry.isDirectory()).map(entry => entry.name));
  } catch (error) { if (error.code === "ENOENT") facts.backups = { count: 0 }; }
  try {
    const intent = await readCurrentIntent({ userData: paths().userData });
    facts.pending = intent ? { operation: intent.operation, state: intent.state } : null;
  } catch {}
  return facts;
}

async function copyDiagnosticReport() {
  const report = formatDiagnosticReport(await diagnosticFacts());
  electron.clipboard.writeText(report);
  await showMessageBox({ type: "info", title: "Diagnostic report copied", message: "The report is on your clipboard. It contains version and revision details only — no Save data or file paths." });
}

async function profileSwitchBusy() {
  if (backupRequestActive || await readCurrentIntent({ userData: paths().userData })) return true;
  try { await readFile(restoreMarkerPath(), "utf8"); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

function showProfileBusy() {
  return showMessageBox({ type: "info", title: "Profile switch unavailable", message: "Finish the pending Backup, Restore or Update before switching profiles." });
}

async function flushAndRestartForProfile() {
  const window = getLiveMainWindow();
  if (window) await window.webContents.session.flushStorageData();
  app.relaunch();
  app.quit();
}

async function switchProfile(name) {
  const current = globalThis[Symbol.for("pokerogue.profile-context")]?.name ?? null;
  if (name === current) return;
  if (await profileSwitchBusy()) { await showProfileBusy(); createMenu(); return; }
  const result = await showMessageBox({
    type: "question", title: "Switch profile", message: `Switch to "${name ?? "Default"}"?`,
    detail: "PokeRogue Electron will restart. Each profile has its own Save data, cheat settings and Backups.",
    buttons: ["Switch and Restart", "Cancel"], defaultId: 1, cancelId: 1, noLink: true,
  });
  if (result.response !== 0) { createMenu(); return; }
  setActiveProfile(paths().root, name);
  await flushAndRestartForProfile();
}

async function createAndRestartProfile(name) {
  assertValidProfileName(name);
  if (await profileSwitchBusy()) { await showProfileBusy(); return { busy: true }; }
  const { root } = paths();
  createProfile(root, name);
  setActiveProfile(root, name);
  await flushAndRestartForProfile();
}

async function reloadKeybindings(expectedWindow = getLiveMainWindow()) {
  const mappings = await loadKeymap(paths().keymap);
  const modifiedAt = await keymapModifiedAt(paths().keymap);
  if (!expectedWindow) {
    keymapMtime = modifiedAt;
  } else if (mainWindow === expectedWindow && !expectedWindow.isDestroyed()) {
    keymapMtime = modifiedAt;
    expectedWindow.webContents.send("keybindings:update", mappings);
  }
  return mappings;
}

async function openKeybindingsFile() {
  await reloadKeybindings();
  const error = await shell.openPath(paths().keymap);
  if (error) dialog.showErrorBox("Could not open keybindings", error);
}

async function resetKeybindings() {
  await resetKeymap(paths().keymap);
  await reloadKeybindings();
}

function openExternalUtility(url) {
  void shell.openExternal(url).catch(error => dialog.showErrorBox("Could not open utility", error.message));
}

function toggleChartWindow(chart) {
  const existing = chartWindows.get(chart.id);
  if (existing && !existing.isDestroyed()) {
    if (existing.isVisible()) { existing.hide(); getLiveMainWindow()?.focus(); }
    else { existing.show(); existing.focus(); }
    return;
  }
  const chartWindow = new BrowserWindow({
    width: chart.width, height: chart.height, show: false, autoHideMenuBar: true,
    ...(windowIcon ? { icon: windowIcon } : {}),
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  });
  chartWindows.set(chart.id, chartWindow);
  chartWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  chartWindow.webContents.on("will-navigate", event => event.preventDefault());
  chartWindow.once("ready-to-show", () => {
    if (chartWindows.get(chart.id) === chartWindow && !chartWindow.isDestroyed()) chartWindow.show();
  });
  chartWindow.on("closed", () => {
    if (chartWindows.get(chart.id) === chartWindow) chartWindows.delete(chart.id);
  });
  void chartWindow.loadFile(join(moduleRoot, "src", "assets", chart.asset));
}

function workerArgs(token) {
  const args = app.isPackaged ? [] : [app.getAppPath(), "--"];
  args.push("--backup-worker", `--backup-token=${token}`, `--backup-parent-pid=${process.pid}`);
  return args;
}

async function failColdIntent(intent, message, code = "continuation-failed", { startupConfirmed = false } = {}) {
  let latest = await readCurrentIntent({ userData: paths().userData });
  if (!latest || latest.token !== intent.token) throw new Error("The Backup request changed before its failure could be recorded");
  if (latest.state === "completed") {
    if (startupConfirmed) await clearTerminalIntent({ userData: paths().userData, expectedToken: latest.token, startupConfirmed: true });
    await showColdBackupComplete(latest, latest.capturedBackupPath ?? "");
    if (startupConfirmed) backupRequestActive = false;
    return;
  }
  if (["capturing", "resuming"].includes(latest.state)) {
    latest = await transitionIntent({ userData: paths().userData, expectedToken: latest.token, expectedRevision: latest.revision, nextState: "interrupted", ownerExited: true });
  }
  if (latest.state === "interrupted" || latest.state === "requested" || latest.state === "captured") {
    latest = await transitionIntent({ userData: paths().userData, expectedToken: latest.token, expectedRevision: latest.revision, nextState: "failed", failure: { code, message: String(message).slice(0, 1024) } });
  }
  if (latest.state !== "failed") throw new Error(`Could not record Backup failure from state ${latest.state}`);
  if (startupConfirmed) await clearTerminalIntent({ userData: paths().userData, expectedToken: latest.token, startupConfirmed: true });
  await showColdBackupFailed(latest, `${String(message)}${startupConfirmed ? "" : " Restart the application before requesting another Backup."}`);
  if (startupConfirmed) backupRequestActive = false;
}

function reportColdIntentFailure(error) {
  backupRequestActive = true;
  startupRestarting = false;
  try { dialog.showErrorBox("Backup request needs attention", `The request status could not be safely recorded. No new Backup will start until the application is restarted.\n\n${error.message}`); }
  catch (reportError) { process.stderr.write(`Could not report Backup request failure: ${reportError.message}\n`); }
}

async function requestColdBackup(operation, payload, reserved = false) {
  if (backupRequestActive && !reserved) {
    await showBackupAlreadyInProgress();
    return { requested: false, busy: true };
  }
  backupRequestActive = true;
  const request = (async () => {
    let intent;
    try {
      const window = getLiveMainWindow();
      if (window) await window.webContents.session.flushStorageData();
      intent = await createIntent({ userData: paths().userData, operation, payload });
      startupRestarting = true;
      let quitReached = false;
      let willQuitHandler;
      const quitTimer = setTimeout(() => {
        if (quitReached) return;
        app.removeListener("will-quit", willQuitHandler);
        startupRestarting = false;
        void failColdIntent(intent, "Application shutdown was cancelled; no live Backup was attempted.", "quit-vetoed").catch(reportColdIntentFailure);
      }, 1800);
      willQuitHandler = event => {
        queueMicrotask(() => {
          if (event.defaultPrevented) {
            clearTimeout(quitTimer);
            startupRestarting = false;
            void failColdIntent(intent, "Application shutdown was cancelled; no live Backup was attempted.", "quit-vetoed").catch(reportColdIntentFailure);
            return;
          }
          quitReached = true;
          clearTimeout(quitTimer);
          try { app.relaunch({ args: workerArgs(intent.token) }); }
          catch (error) {
            event.preventDefault();
            startupRestarting = false;
            void failColdIntent(intent, error.message, "restart-failed").catch(reportColdIntentFailure);
          }
        });
      };
      app.once("will-quit", willQuitHandler);
      app.quit();
      return { requested: true };
    } catch (error) {
      startupRestarting = false;
      if (intent) {
        await failColdIntent(intent, error.message, "restart-failed").catch(failure => showMessageBox({ type: "warning", title: "Backup request needs attention", message: "The request status could not be confirmed.", detail: failure.message }));
        return { requested: false, journalPending: true, error: error.message };
      }
      else {
        backupRequestActive = false;
        await showMessageBox({ type: "warning", title: operation === "update" ? "Update backup could not start" : "Backup could not start", message: "A cold Backup request could not be created.", detail: error.message });
      }
      return { requested: false, error: error.message };
    }
  })();
  backupRequestPromise = request;
  try { return await request; }
  finally { if (backupRequestPromise === request) backupRequestPromise = undefined; }
}

async function requestManualBackup() {
  if (backupRequestActive) {
    await showBackupAlreadyInProgress();
    return { requested: false, busy: true };
  }
  if (backupRequestPromise) return backupRequestPromise;
  backupRequestActive = true;
  const choice = showMessageBox({ type: "warning", title: "Restart to back up saves", message: "PokeRogue Electron must close briefly to make a consistent Backup.", detail: "Choose Restart to create the Backup, or Cancel to keep playing.", buttons: ["Restart and Back Up", "Cancel"], defaultId: 0, cancelId: 1 });
  backupRequestPromise = (async () => {
    const answer = await choice;
    if (answer.response !== 0) { backupRequestActive = false; return { backedUp: false, cancelled: true }; }
    return requestColdBackup("manual", {}, true);
  })().catch(async error => {
    backupRequestActive = false;
    await showMessageBox({ type: "warning", title: "Backup could not start", message: "The Backup request failed before restart.", detail: error.message });
    return { requested: false, error: error.message };
  }).finally(() => { backupRequestPromise = undefined; });
  return backupRequestPromise;
}

async function resumeColdBackupIntent() {
  const userData = paths().userData;
  await recoverStaleIntentLock({ userData, startupConfirmed: true });
  const current = await readCurrentIntent({ userData });
  if (!current) return;
  if (!["manual", "update", "restore", "cheat"].includes(current.operation)) return;
  if (current.operation === "restore" && current.state === "resuming") {
    try {
      const marker = JSON.parse(await readFile(restoreMarkerPath(), "utf8"));
      if (marker?.status === "failed" && marker.recoveryRequired === false && marker.coldToken === current.token) return;
    } catch (error) { if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
  }
  if (current.state === "completed") {
    await clearTerminalIntent({ userData, expectedToken: current.token, startupConfirmed: true });
    await showColdBackupComplete(current, current.capturedBackupPath ?? "");
    return;
  }
  if (current.state === "failed") {
    await clearTerminalIntent({ userData, expectedToken: current.token, startupConfirmed: true });
    await showColdBackupFailed(current, current.failure?.message ?? "The operation was cancelled.");
    return;
  }
  try {
    if (current.state !== "captured") throw new Error(`The previous cold Backup stopped in state ${current.state}; it will not be replayed.`);
    const resumed = await prepareResumeIntent({ userData, expectedToken: current.token, expectedRevision: current.revision });
    if (current.operation === "manual") {
      await transitionIntent({ userData, expectedToken: current.token, expectedRevision: resumed.intent.revision, nextState: "completed" });
      await clearTerminalIntent({ userData, expectedToken: current.token, startupConfirmed: true });
      await showColdBackupComplete(current, resumed.continuation.backupPath);
      return;
    }
    if (current.operation === "restore") {
      await writeRestoreMarker({ version: 1, status: "pending", selected: resumed.continuation.selectedBackup, safetyBackup: current.capturedBackupPath, coldToken: current.token });
      await applyPendingRestore();
      const marker = JSON.parse(await readFile(restoreMarkerPath(), "utf8").catch(error => error.code === "ENOENT" ? "null" : Promise.reject(error)));
      if (!marker) await acknowledgeColdRestore(current.token);
      else if (marker.status === "failed" && marker.recoveryRequired !== true) {
        const latest = await readCurrentIntent({ userData });
        if (latest?.token === current.token && latest.state === "resuming") {
          const failed = await transitionIntent({ userData, expectedToken: latest.token, expectedRevision: latest.revision, nextState: "failed", failure: { code: "restore-failed", message: marker.error?.message ?? "Restore failed and rollback completed." } });
          await clearTerminalIntent({ userData, expectedToken: failed.token, startupConfirmed: true });
        }
      }
      return;
    }
    if (current.operation === "cheat") {
      await applyCheatConfiguration({ path: paths().cheats, requested: resumed.continuation.config, backupCompleted: true, relaunch: async () => {} });
      await transitionIntent({ userData, expectedToken: current.token, expectedRevision: resumed.intent.revision, nextState: "completed" });
      await clearTerminalIntent({ userData, expectedToken: current.token, startupConfirmed: true });
      startupRestarting = true;
      app.relaunch();
      app.quit();
      return;
    }
    const install = await showMessageBox({ type: "info", title: "Update downloaded", message: process.platform === "darwin" ? "Open the DMG, drag PokeRogue Electron into Applications, and replace the existing copy. macOS may ask you to approve this unsigned build in System Settings." : "Close the game and run the installer to update.", detail: resumed.continuation.installerPath, buttons: ["Open Update", "Later"], defaultId: 0, cancelId: 1 });
    if (install.response === 0) {
      const verified = await revalidateResumingUpdate({ userData, expectedToken: current.token, expectedRevision: resumed.intent.revision });
      const openError = await shell.openPath(verified.installerPath);
      if (openError) throw new Error(openError);
    }
    await transitionIntent({ userData, expectedToken: current.token, expectedRevision: resumed.intent.revision, nextState: "completed" });
    await clearTerminalIntent({ userData, expectedToken: current.token, startupConfirmed: true });
  } catch (error) {
    try { await failColdIntent(current, error.message, "continuation-failed", { startupConfirmed: true }); }
    catch (recordError) {
      startupRecoveryBlocked = true;
      throw new Error(`${error.message}; could not safely record the request failure: ${recordError.message}`, { cause: error });
    }
  }
}

async function acknowledgeColdRestore(token) {
  const userData = paths().userData;
  const current = await readCurrentIntent({ userData });
  if (!current || current.token !== token || current.operation !== "restore" || current.state !== "resuming") return;
  const completed = await transitionIntent({ userData, expectedToken: token, expectedRevision: current.revision, nextState: "completed" });
  await clearTerminalIntent({ userData, expectedToken: token, startupConfirmed: true });
  return completed;
}

// parent: the window the request came from, so its dialogs open in front of it.
async function chooseAndRestore(parent) {
  const result = await showOpenDialog({ title: "Choose a save backup", defaultPath: paths().backupRoot, properties: ["openDirectory"] }, parent);
  if (result.canceled || !result.filePaths[0]) return { restored: false };
  return restoreSelectedBackup(result.filePaths[0], parent);
}

async function restoreSelectedBackup(selected, parent) {
  await validateBackup(selected);
  const restart = await showMessageBox({ type: "warning", title: "Restart to restore Backup", message: "PokeRogue Electron must close briefly to create a consistent safety Backup before restoring.", detail: "Choose Restart to continue, or Cancel to keep your current Save data.", buttons: ["Restart and Restore", "Cancel"], defaultId: 0, cancelId: 1 }, parent);
  if (restart.response !== 0) return { restored: false, cancelled: true };
  // Later dialogs belong to the game window; an open child window would cover them.
  if (parent && parent !== getLiveMainWindow() && !parent.isDestroyed()) parent.close();
  await retireSafeColdRestoreForReplacement();
  const requested = await requestColdBackup("restore", { selectedBackup: selected });
  return { restored: false, requested: requested.requested === true };
}

async function retireSafeColdRestoreForReplacement() {
  let marker;
  try { marker = JSON.parse(await readFile(restoreMarkerPath(), "utf8")); }
  catch (error) { if (error.code === "ENOENT" || error instanceof SyntaxError) return; throw error; }
  if (marker?.status !== "failed" || marker.recoveryRequired !== false || typeof marker.coldToken !== "string") return;
  const userData = paths().userData;
  const intent = await readCurrentIntent({ userData });
  if (!intent || intent.token !== marker.coldToken || intent.operation !== "restore" || intent.state !== "resuming") return;
  const failed = await transitionIntent({ userData, expectedToken: intent.token, expectedRevision: intent.revision, nextState: "failed", failure: { code: "restore-replaced", message: "The user approved a fresh Restore after the previous Restore safely rolled back." } });
  await clearTerminalIntent({ userData, expectedToken: failed.token, startupConfirmed: true });
}

function restoreMarkerPath() {
  return join(paths().userData, "pending-restore.json");
}

async function writeRestoreMarker(marker) {
  const pending = restoreMarkerPath();
  const temporary = `${pending}.tmp`;
  await writeFile(temporary, JSON.stringify(marker));
  await rename(temporary, pending);
}

async function findRecoveryPaths(marker) {
  const recoveryPaths = new Set([
    ...(Array.isArray(marker?.recoveryPaths) ? marker.recoveryPaths.filter(path => typeof path === "string") : []),
  ]);
  let scanError;
  try {
    for (const entry of await readdir(paths().userData, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith(".restore-rollback-")) recoveryPaths.add(join(paths().userData, entry.name));
    }
  } catch (error) {
    if (error.code !== "ENOENT") scanError = error.message;
  }
  if (scanError && typeof marker?.recoveryPath === "string") recoveryPaths.add(marker.recoveryPath);
  return { recoveryPaths: [...recoveryPaths], scanError };
}

async function showRestoreRecovery(marker, message, { blocked = false, allowFresh = false, completed = false, completionUnrecorded = false } = {}) {
  const userData = paths().userData;
  const safetyBackup = typeof marker?.safetyBackup === "string" ? marker.safetyBackup : "Unavailable";
  const selected = typeof marker?.selected === "string" ? marker.selected : "Unavailable";
  const { recoveryPaths, scanError } = await findRecoveryPaths(marker);
  const recoveryCopies = recoveryPaths.length ? recoveryPaths.join("\n") : "None found";
  const scanNote = scanError ? `\nCould not scan for retained recovery copies: ${scanError}` : "";
  const result = await dialog.showMessageBox({
    type: blocked ? "error" : completed ? "info" : "warning",
    title: blocked ? completionUnrecorded ? "Restore status needs review" : "Save recovery required" : completed ? "Backup restore completed with a warning" : "Backup restore failed",
    message: blocked
      ? completionUnrecorded
        ? "The Backup was applied, but its completion could not be recorded. The app will not load Save data until recovery is checked."
        : "The app cannot safely load Save data because a restore may be incomplete."
      : completed ? "The Backup was restored. Review the detail for the recovery state." : "The requested Backup was not restored. Your current Save data is available.",
    detail: `${message}${scanNote}\n\nSelected Backup: ${selected}\nSafety Backup: ${safetyBackup}\nRecovery copies: ${recoveryCopies}\nSave folder: ${userData}`,
    buttons: blocked
      ? ["Open Save Folder", "Open Safety Backup", ...(allowFresh ? ["Choose another Backup"] : []), "Quit"]
      : completed ? ["Open Recovery Folder", "Continue"] : ["Open Safety Backup", "Choose another Backup", "Continue"],
    defaultId: blocked ? 0 : completed ? 1 : 2,
    cancelId: blocked ? (allowFresh ? 3 : 2) : completed ? 1 : 2,
  });
  if (blocked) {
    if (result.response === 0) await shell.openPath(userData);
    else if (result.response === 1 && safetyBackup !== "Unavailable") await shell.openPath(safetyBackup);
    else if (allowFresh && result.response === 2) await chooseAndRestore();
    else app.quit();
    return;
  }
  if (completed) {
    if (result.response === 0 && recoveryPaths[0]) await shell.openPath(recoveryPaths[0]);
    return;
  }
  if (result.response === 0 && safetyBackup !== "Unavailable") await shell.openPath(safetyBackup);
  else if (result.response === 1) await chooseAndRestore();
}

function validRestoreMarker(marker) {
  return marker && typeof marker === "object" && !Array.isArray(marker) && marker.version === 1 &&
    ["pending", "applying", "failed", "completed"].includes(marker.status) &&
    (marker.status !== "failed" || typeof marker.recoveryRequired === "boolean") &&
    (marker.selected === undefined || typeof marker.selected === "string") &&
    (marker.safetyBackup === undefined || typeof marker.safetyBackup === "string") &&
    (marker.coldToken === undefined || (typeof marker.coldToken === "string" && BACKUP_TOKEN_PATTERN.test(marker.coldToken)));
}

async function recordInvalidRestoreMarker(marker, recovery) {
  const blocked = recovery.recoveryPaths.length > 0 || Boolean(recovery.scanError);
  try { await writeRestoreMarker(marker); }
  catch (error) {
    startupRecoveryBlocked = true;
    const allowFresh = recovery.recoveryPaths.length === 0 && !recovery.scanError;
    await showRestoreRecovery(marker, `${marker.error.message}\nCould not record the failed request: ${error.message}`, { blocked: true, allowFresh });
    return;
  }
  startupRecoveryBlocked = blocked;
  await showRestoreRecovery(marker, marker.error.message, { blocked });
}

async function applyPendingRestore() {
  const pending = restoreMarkerPath();
  let raw;
  try {
    raw = await readFile(pending, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    startupRecoveryBlocked = true;
    await showRestoreRecovery(null, `Could not read the restore request: ${error.message}`, { blocked: true });
    return;
  }

  let marker;
  try { marker = JSON.parse(raw); }
  catch (error) {
    const recovery = await findRecoveryPaths(null);
    const blocked = recovery.recoveryPaths.length > 0 || Boolean(recovery.scanError);
    marker = { version: 1, status: "failed", selected: "Unavailable", safetyBackup: "Unavailable", recoveryPaths: recovery.recoveryPaths, recoveryRequired: blocked, error: { message: `The restore request is malformed and was not applied: ${error.message}${recovery.scanError ? ` Recovery-copy scan failed: ${recovery.scanError}` : ""}` } };
    await recordInvalidRestoreMarker(marker, recovery);
    return;
  }
  const legacyPending = marker && typeof marker === "object" && !Array.isArray(marker) && marker.status === undefined && typeof marker.selected === "string";
  if (legacyPending) {
    marker = { version: 1, status: "pending", selected: marker.selected, ...(typeof marker.safetyBackup === "string" ? { safetyBackup: marker.safetyBackup } : {}) };
  }
  if (!validRestoreMarker(marker)) {
    const recovery = await findRecoveryPaths(marker);
    const blocked = recovery.recoveryPaths.length > 0 || Boolean(recovery.scanError);
    const failed = { version: 1, status: "failed", selected: typeof marker?.selected === "string" ? marker.selected : "Unavailable", safetyBackup: typeof marker?.safetyBackup === "string" ? marker.safetyBackup : "Unavailable", recoveryPaths: recovery.recoveryPaths, recoveryRequired: blocked, error: { message: `The restore request has an unsupported or incomplete format and was not applied.${recovery.scanError ? ` Recovery-copy scan failed: ${recovery.scanError}` : ""}` } };
    await recordInvalidRestoreMarker(failed, recovery);
    return;
  }

  if (legacyPending) {
    const recovery = await findRecoveryPaths(marker);
    if (recovery.recoveryPaths.length || recovery.scanError) {
      marker = { ...marker, status: "failed", recoveryRequired: true, recoveryPaths: recovery.recoveryPaths, error: { message: `A previous restore may have stopped before its recovery state could be confirmed. The Backup was not applied again.${recovery.scanError ? ` Recovery-copy scan failed: ${recovery.scanError}` : ""}` } };
      try { await writeRestoreMarker(marker); }
      catch (error) { marker.error.message += ` Could not update the request: ${error.message}`; }
      startupRecoveryBlocked = true;
      await showRestoreRecovery(marker, marker.error.message, { blocked: true });
      return;
    }
  }

  if (marker.status === "completed") {
    try { await rm(pending, { force: true }); }
    catch (error) { await showRestoreRecovery(marker, `The restore completed, but its request could not be removed: ${error.message}`, { completed: true }); }
    if (marker.coldToken) await acknowledgeColdRestore(marker.coldToken);
    return;
  }
  if (marker.status === "failed") {
    if (marker.recoveryRequired === false) {
      const intent = await readCurrentIntent({ userData: paths().userData });
      if (intent?.operation === "restore" && intent.state === "captured") {
        // The validated fresh continuation replaces this marker atomically below.
        return;
      }
    }
    startupRecoveryBlocked = marker.recoveryRequired === true;
    await showRestoreRecovery(marker, marker.error?.message ?? "The previous restore failed.", { blocked: startupRecoveryBlocked });
    return;
  }
  if (marker.status === "applying") {
    startupRecoveryBlocked = true;
    await showRestoreRecovery(marker, "The previous app session ended while a restore was running. Its result is unknown.", { blocked: true });
    return;
  }

  try {
    const recoveryPath = join(paths().userData, `.restore-rollback-${Date.now()}`);
    marker = { ...marker, recoveryPath };
    await writeRestoreMarker({ ...marker, status: "applying" });
  } catch (error) {
    startupRecoveryBlocked = true;
    await showRestoreRecovery(marker, `Could not record the restore before applying it: ${error.message}`, { blocked: true, allowFresh: true });
    return;
  }

  try {
    await restoreBackup(paths().userData, marker.selected, { rollbackPath: marker.recoveryPath });
  } catch (error) {
    const restored = error instanceof BackupRestoreError && error.restored;
    const recoveryRequired = !(error instanceof BackupRestoreError) || error.recoveryRequired;
    const failed = { ...marker, status: restored ? "completed" : "failed", recoveryRequired, error: { message: error.message }, ...(error.recoveryPath ? { recoveryPath: error.recoveryPath } : {}) };
    if (!error.recoveryPath && !error.restored) delete failed.recoveryPath;
    if (restored) {
      try { await writeRestoreMarker(failed); }
      catch (markerError) {
        startupRecoveryBlocked = true;
        await showRestoreRecovery(failed, `Backup applied, completion unrecorded: ${error.message}\nCould not record the completed restore: ${markerError.message}`, { blocked: true, completionUnrecorded: true });
        return;
      }
      try { await rm(pending, { force: true }); }
      catch (markerError) { await showRestoreRecovery(failed, `${error.message}\nCould not remove the completed request: ${markerError.message}`, { completed: true }); return; }
      await showRestoreRecovery(failed, error.message, { completed: true });
      return;
    }
    try {
      await writeRestoreMarker(failed);
    } catch (markerError) {
      startupRecoveryBlocked = true;
      const allowFresh = error instanceof BackupRestoreError && !error.recoveryRequired && !error.restored;
      await showRestoreRecovery({ ...failed, recoveryRequired: true }, `${error.message}\nCould not safely record restore state: ${markerError.message}`, { blocked: true, allowFresh });
      return;
    }
    startupRecoveryBlocked = recoveryRequired;
    await showRestoreRecovery(failed, error.message, { blocked: recoveryRequired });
    return;
  }

  try {
    await writeRestoreMarker({ ...marker, status: "completed" });
  } catch (error) {
    startupRecoveryBlocked = true;
    await showRestoreRecovery(marker, `The Backup was applied, but completion could not be recorded: ${error.message}`, { blocked: true, completionUnrecorded: true });
    return;
  }
  try {
    await rm(pending, { force: true });
  } catch (error) {
    await showRestoreRecovery({ ...marker, status: "completed" }, `The restore completed, but its request could not be removed: ${error.message}`, { completed: true });
  }
  if (marker.coldToken) await acknowledgeColdRestore(marker.coldToken);
}

async function performUpdateCheck() {
  if (backupRequestActive) {
    await showBackupAlreadyInProgress();
    return { available: false, busy: true };
  }
  backupRequestActive = true;
  let keepReservation = false;
  try {
    const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : process.platform;
    const result = await checkForUpdate(UPDATE_REPOSITORY, app.getVersion(), platform, process.arch);
    if (!result.available) {
      await showMessageBox({ type: "info", title: "No update available", message: `${PRODUCT_NAME} is up to date.` });
      return { available: false };
    }
    const answer = await showMessageBox({ type: "info", title: "Update available", message: `Version ${result.manifest.version} is available.`, detail: "Downloading requires a restart to make the cold Backup before the installer can be opened. Continue?", buttons: ["Download and Restart", "Cancel"], defaultId: 0, cancelId: 1 });
    if (answer.response !== 0) return { available: true, downloaded: false };
    let lastPercent = -1;
    const onProgress = (received, total) => {
      const percent = Math.floor(received / total * 100);
      if (percent === lastPercent) return;
      lastPercent = percent;
      getLiveMainWindow()?.setProgressBar(received / total);
    };
    try {
      await downloadVerified(result.artifact, paths().downloadRoot, { onProgress });
    } finally {
      getLiveMainWindow()?.setProgressBar(-1);
    }
    const requested = await requestColdBackup("update", { manifest: result.manifest, platform, arch: process.arch }, true);
    keepReservation = requested.requested || requested.journalPending;
    return { available: true, downloaded: true };
  } catch (error) {
    await showMessageBox({ type: "warning", title: "Update check unavailable", message: "Could not check for updates. Offline gameplay is unaffected.", detail: error.message });
    return { available: false, error: error.message };
  } finally {
    if (!keepReservation) backupRequestActive = false;
  }
}

function installNetworkPolicy() {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const scheme = new URL(details.url).protocol;
    callback({ cancel: scheme === "http:" || scheme === "https:" || scheme === "ws:" || scheme === "wss:" });
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
}

function createMenu() {
  const isMac = process.platform === "darwin";
  const keybindings = [
    { label: "Open Keybindings File…", click: () => void openKeybindingsFile() },
    { label: "Reload Keybindings", click: () => void reloadKeybindings() },
    { label: "Reset to Defaults", click: () => void resetKeybindings() },
  ];
  const utilities = createUtilitiesSubmenu({ openExternal: openExternalUtility, openChart: toggleChartWindow });
  const cheats = [{ label: "Configure Cheats…", click: () => cheatController.openWindow() }];
  const profileContext = globalThis[Symbol.for("pokerogue.profile-context")];
  Menu.setApplicationMenu(Menu.buildFromTemplate(createMenuTemplate({
    isMac,
    productName: PRODUCT_NAME,
    onCheckForUpdates: performUpdateCheck,
    onBackup: requestManualBackup,
    onRestore: () => backupController.openWindow(),
    onOpenSaveFolder: () => shell.openPath(paths().userData),
    onCopyDiagnosticReport: () => { void copyDiagnosticReport(); },
    onReload: () => getLiveMainWindow()?.reload(),
    onToggleFullscreen: () => { const window = getLiveMainWindow(); if (window) window.setFullScreen(!window.isFullScreen()); },
    onDeveloperTools: () => getLiveMainWindow()?.webContents.toggleDevTools(),
    utilities,
    keybindings,
    cheats,
    profileNames: listProfiles(paths().root),
    activeProfile: profileContext?.name ?? null,
    onSelectProfile: name => { void switchProfile(name).catch(error => { createMenu(); dialog.showErrorBox("Profile switch failed", error.message); }); },
    onNewProfile: () => profileController.openWindow(),
  })));
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 600, backgroundColor: "#000000", show: false,
    ...(windowIcon ? { icon: windowIcon } : {}),
    webPreferences: { preload: join(moduleRoot, "src", "preload-cheats.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  });
  mainWindow = window;
  const activeProfile = globalThis[Symbol.for("pokerogue.profile-context")]?.name;
  if (activeProfile) {
    window.setTitle(`${PRODUCT_NAME} — ${activeProfile}`);
    window.webContents.on("page-title-updated", event => event.preventDefault());
  }
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => { if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault(); });
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || input.control || input.meta || input.alt) return;
    if (input.key === "F5") { event.preventDefault(); if (mainWindow === window && !window.isDestroyed()) window.reload(); }
  });
  window.webContents.on("did-finish-load", () => {
    if (mainWindow === window && !window.isDestroyed()) void reloadKeybindings(window);
  });
  window.on("focus", async () => {
    if (mainWindow !== window || window.isDestroyed()) return;
    try { if (await keymapModifiedAt(paths().keymap) !== keymapMtime && mainWindow === window && !window.isDestroyed()) await reloadKeybindings(window); }
    catch (error) { console.warn(`Could not refresh keybindings: ${error.message}`); }
  });
  window.once("ready-to-show", () => {
    if (mainWindow === window && !window.isDestroyed()) window.show();
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
  });
  try {
    await window.loadURL(`${APP_ORIGIN}/index.html`);
  } catch (error) {
    if (window.isDestroyed() || mainWindow !== window) return;
    mainWindow = undefined;
    window.destroy();
    dialog.showErrorBox("Could not load game", error.message);
  }
}

async function pruneStaleFiles() {
  try {
    const { userData, backupRoot, downloadRoot } = paths();
    if (await readCurrentIntent({ userData })) return;
    try { await readFile(restoreMarkerPath(), "utf8"); return; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    const results = [await pruneAutomaticBackups(backupRoot, AUTOMATIC_BACKUPS_KEPT), await pruneUpdateDownloads(downloadRoot, app.getVersion())];
    for (const { errors } of results) for (const error of errors) process.stderr.write(`Could not clean up ${error.path}: ${error.message}\n`);
  } catch (error) { process.stderr.write(`Startup cleanup skipped: ${error.message}\n`); }
}

async function offerDownloadsCleanup() {
  try {
    if (startupRecoveryBlocked || startupRestarting || await readCurrentIntent({ userData: paths().userData })) return;
    const version = app.getVersion();
    const trashName = process.platform === "darwin" ? "Trash" : "Recycle Bin";
    const moveLabel = process.platform === "darwin" ? "Move to Trash" : "Move to Recycle Bin";
    const result = await offerOldInstallers({
      statePath: join(paths().root, "installer-cleanup.json"),
      downloadsPath: app.getPath("downloads"),
      currentVersion: version,
      trashItem: path => shell.trashItem(path),
      ask: async names => {
        const count = names.length;
        const shown = names.slice(0, 10);
        if (count > shown.length) shown.push(`and ${count - shown.length} more`);
        const answer = await showMessageBox({
          type: "question", title: "Remove old installers?",
          message: `Move ${count} installer${count > 1 ? "s" : ""} you no longer need to the ${trashName}?`,
          detail: `${shown.join("\n")}\n\nThey are in your Downloads folder. This version is already installed.`,
          buttons: [moveLabel, "Keep"], defaultId: 1, cancelId: 1,
        });
        return answer.response === 0 ? "move" : "keep";
      },
    });
    if (result.failed) {
      const count = result.failed;
      await showMessageBox({
        type: "warning", title: "Some installers were not removed",
        message: `${count} file${count > 1 ? "s" : ""} could not be moved. You can delete ${count > 1 ? "them" : "it"} yourself from your Downloads folder.`,
      });
    }
  } catch (error) { process.stderr.write(`Downloads cleanup offer skipped: ${error.message}\n`); }
}

app.whenReady().then(async () => {
  await mkdir(paths().backupRoot, { recursive: true });
  await applyPendingRestore();
  if (startupRestarting || startupRecoveryBlocked) return;
  try { await resumeColdBackupIntent(); }
  catch (error) {
    startupRecoveryBlocked = true;
    await showMessageBox({ type: "warning", title: "Backup continuation failed", message: "The Backup or Update could not safely continue.", detail: error.message });
    return;
  }
  if (startupRecoveryBlocked || startupRestarting) return;
  await pruneStaleFiles();
  await reloadKeybindings();
  registerGameProtocol(protocol, gameRoot);
  installNetworkPolicy();
  cheatController = createCheatController({
    moduleRoot, configPath: paths().cheats, icon: windowIcon,
    getMainWindow: getLiveMainWindow,
    backup: async config => {
      const requested = await requestColdBackup("cheat", { config });
      if (requested.requested || requested.journalPending) return { deferred: true };
      if (requested.busy) throw new Error("Another Backup continuation is already in progress.");
      throw new Error(requested.error ?? "The cold Backup could not be started.");
    },
    relaunch: async () => { app.relaunch(); app.quit(); },
  });
  cheatController.registerIpc();
  profileController = createProfileController({
    moduleRoot, icon: windowIcon, getMainWindow: getLiveMainWindow,
    createAndRestart: createAndRestartProfile,
  });
  profileController.registerIpc();
  backupController = createBackupController({
    moduleRoot, backupRoot: paths().backupRoot, icon: windowIcon, getMainWindow: getLiveMainWindow,
    validateBackup, restorePath: restoreSelectedBackup, chooseFolder: chooseAndRestore,
  });
  backupController.registerIpc();
  createMenu();
  await createWindow();
  startupReady = true;
  void offerDownloadsCleanup();
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => {
  if (startupReady && !startupRecoveryBlocked && !startupRestarting && !getLiveMainWindow()) void createWindow();
});
