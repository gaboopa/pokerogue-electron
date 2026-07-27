import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell } from "electron";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_ORIGIN, PRODUCT_NAME, UPDATE_REPOSITORY } from "./constants.mjs";
import { createBackup, restoreBackup, validateBackup } from "./backup.mjs";
import { checkForUpdate, downloadVerified } from "./updater.mjs";
import { registerGameProtocol } from "./protocol.mjs";

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: true } }]);
app.setName(PRODUCT_NAME);

const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const gameRoot = app.isPackaged ? join(process.resourcesPath, "game") : join(moduleRoot, "staging", "game");
let mainWindow;

function paths() {
  const userData = app.getPath("userData");
  return { userData, backupRoot: join(userData, "Save Backups"), downloadRoot: join(userData, "Updates") };
}

async function backupSaves(showConfirmation = true) {
  if (mainWindow) await mainWindow.webContents.session.flushStorageData();
  const output = await createBackup(paths().userData, paths().backupRoot);
  if (showConfirmation) await dialog.showMessageBox(mainWindow, { type: "info", title: "Save backup complete", message: "Your saves were backed up.", detail: output });
  return output;
}

async function chooseAndRestore() {
  const result = await dialog.showOpenDialog(mainWindow, { title: "Choose a save backup", defaultPath: paths().backupRoot, properties: ["openDirectory"] });
  if (result.canceled || !result.filePaths[0]) return { restored: false };
  const selected = result.filePaths[0];
  await validateBackup(selected);
  const safetyBackup = await backupSaves(false);
  const pending = join(paths().userData, "pending-restore.json");
  await writeFile(pending, JSON.stringify({ selected, safetyBackup }));
  await dialog.showMessageBox(mainWindow, { type: "info", title: "Restore ready", message: "The application will restart to restore this backup." });
  app.relaunch();
  app.quit();
  return { restored: true };
}

async function applyPendingRestore() {
  const pending = join(paths().userData, "pending-restore.json");
  if (!existsSync(pending)) return;
  const { selected } = JSON.parse(await readFile(pending, "utf8"));
  await restoreBackup(paths().userData, selected);
  await import("node:fs/promises").then(fs => fs.rm(pending, { force: true }));
}

async function performUpdateCheck() {
  try {
    const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : process.platform;
    const result = await checkForUpdate(UPDATE_REPOSITORY, app.getVersion(), platform, process.arch);
    if (!result.available) {
      await dialog.showMessageBox(mainWindow, { type: "info", title: "No update available", message: `${PRODUCT_NAME} is up to date.` });
      return { available: false };
    }
    const answer = await dialog.showMessageBox(mainWindow, { type: "info", title: "Update available", message: `Version ${result.manifest.version} is available.`, detail: "Download the verified installer now?", buttons: ["Download", "Cancel"], defaultId: 0, cancelId: 1 });
    if (answer.response !== 0) return { available: true, downloaded: false };
    const installer = await downloadVerified(result.artifact, paths().downloadRoot);
    await backupSaves(false);
    const install = await dialog.showMessageBox(mainWindow, { type: "info", title: "Update downloaded", message: process.platform === "darwin" ? "Open the DMG, replace the existing application, and approve the unsigned build if prompted." : "Close the game and run the installer to update.", detail: installer, buttons: ["Open Update", "Later"], defaultId: 0, cancelId: 1 });
    if (install.response === 0) await shell.openPath(installer);
    return { available: true, downloaded: true };
  } catch (error) {
    await dialog.showMessageBox(mainWindow, { type: "warning", title: "Update check unavailable", message: "Could not check for updates. Offline gameplay is unaffected.", detail: error.message });
    return { available: false, error: error.message };
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
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: PRODUCT_NAME, submenu: [
      { label: "Check for Updates…", click: performUpdateCheck },
      { type: "separator" },
      { label: "Back Up Saves…", click: () => backupSaves(true) },
      { label: "Restore Backup…", click: chooseAndRestore },
      { label: "Open Save Folder", click: () => shell.openPath(paths().userData) },
      { type: "separator" },
      { role: process.platform === "darwin" ? "close" : "quit" },
    ] },
    { label: "View", submenu: [{ role: "reload" }, { role: "togglefullscreen" }] },
  ]));
}

function registerIpc() {
  ipcMain.handle("app:get-version", () => app.getVersion());
  ipcMain.handle("updates:check", performUpdateCheck);
  ipcMain.handle("saves:backup", () => backupSaves(true));
  ipcMain.handle("saves:restore", chooseAndRestore);
  ipcMain.handle("saves:open-folder", async () => ({ error: await shell.openPath(paths().userData) }));
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 600, backgroundColor: "#000000", show: false,
    webPreferences: { preload: join(moduleRoot, "src", "preload.mjs"), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => { if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault(); });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  await mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
}

app.whenReady().then(async () => {
  await mkdir(paths().backupRoot, { recursive: true });
  await applyPendingRestore();
  registerGameProtocol(protocol, gameRoot);
  installNetworkPolicy();
  registerIpc();
  createMenu();
  await createWindow();
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
