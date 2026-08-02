import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell } from "electron";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_ORIGIN, PRODUCT_NAME, UPDATE_REPOSITORY } from "./constants.mjs";
import { createBackup, restoreBackup, validateBackup } from "./backup.mjs";
import { createCheatController } from "./cheat-main.mjs";
import { keymapModifiedAt, loadKeymap, resetKeymap } from "./keymap-store.mjs";
import { checkForUpdate, downloadVerified } from "./updater.mjs";
import { registerGameProtocol } from "./protocol.mjs";
import { createUtilitiesSubmenu } from "./utilities.mjs";
import { createMenuTemplate } from "./menu.mjs";

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: true } }]);
app.setName(PRODUCT_NAME);

const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const windowIcon = process.platform === "win32" ? join(moduleRoot, "build", "icon.ico") : undefined;
const gameRoot = app.isPackaged ? join(process.resourcesPath, "game") : join(moduleRoot, "staging", "game");
let mainWindow;
let keymapMtime = 0;
const chartWindows = new Map();
let cheatController;

function paths() {
  const userData = app.getPath("userData");
  return { userData, backupRoot: join(userData, "Save Backups"), downloadRoot: join(userData, "Updates"), keymap: join(userData, "keymap.json"), cheats: join(userData, "cheats.json") };
}

async function reloadKeybindings() {
  const mappings = await loadKeymap(paths().keymap);
  keymapMtime = await keymapModifiedAt(paths().keymap);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("keybindings:update", mappings);
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
    if (existing.isVisible()) { existing.hide(); mainWindow?.focus(); }
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
  chartWindow.once("ready-to-show", () => chartWindow.show());
  chartWindow.on("closed", () => chartWindows.delete(chart.id));
  void chartWindow.loadFile(join(moduleRoot, "src", "assets", chart.asset));
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
    const install = await dialog.showMessageBox(mainWindow, { type: "info", title: "Update downloaded", message: process.platform === "darwin" ? "Open the DMG, drag PokeRogue Offline into Applications, and replace the existing copy. macOS may ask you to approve this unsigned build in System Settings." : "Close the game and run the installer to update.", detail: installer, buttons: ["Open Update", "Later"], defaultId: 0, cancelId: 1 });
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
  const isMac = process.platform === "darwin";
  const keybindings = [
    { label: "Open Keybindings File...", click: () => void openKeybindingsFile() },
    { label: "Reload Keybindings", click: () => void reloadKeybindings() },
    { label: "Reset to Defaults", click: () => void resetKeybindings() },
  ];
  const utilities = createUtilitiesSubmenu({ openExternal: openExternalUtility, openChart: toggleChartWindow });
  const cheats = [{ label: "Configure Cheats...", click: () => cheatController.openWindow() }];
  Menu.setApplicationMenu(Menu.buildFromTemplate(createMenuTemplate({
    isMac,
    productName: PRODUCT_NAME,
    onCheckForUpdates: performUpdateCheck,
    onBackup: () => backupSaves(true),
    onRestore: chooseAndRestore,
    onOpenSaveFolder: () => shell.openPath(paths().userData),
    onReload: () => mainWindow?.reload(),
    onToggleFullscreen: () => mainWindow?.setFullScreen(!mainWindow.isFullScreen()),
    onDeveloperTools: () => mainWindow?.webContents.toggleDevTools(),
    utilities,
    keybindings,
    cheats,
  })));
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
    ...(windowIcon ? { icon: windowIcon } : {}),
    webPreferences: { preload: join(moduleRoot, "src", "preload-cheats.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => { if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault(); });
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || input.control || input.meta || input.alt) return;
    if (input.key === "F5") { event.preventDefault(); mainWindow.reload(); }
  });
  mainWindow.webContents.on("did-finish-load", () => void reloadKeybindings());
  mainWindow.on("focus", async () => {
    try { if (await keymapModifiedAt(paths().keymap) !== keymapMtime) await reloadKeybindings(); }
    catch (error) { console.warn(`Could not refresh keybindings: ${error.message}`); }
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  await mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
}

app.whenReady().then(async () => {
  await mkdir(paths().backupRoot, { recursive: true });
  await applyPendingRestore();
  await reloadKeybindings();
  registerGameProtocol(protocol, gameRoot);
  installNetworkPolicy();
  cheatController = createCheatController({
    moduleRoot, configPath: paths().cheats, icon: windowIcon,
    getMainWindow: () => mainWindow,
    backup: () => backupSaves(false),
    relaunch: async () => { app.relaunch(); app.quit(); },
  });
  cheatController.registerIpc();
  registerIpc();
  createMenu();
  await createWindow();
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
