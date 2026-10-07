import { BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { listBackups, resolveBackupName } from "./backup-list.mjs";

export function createBackupController({ moduleRoot, backupRoot, icon, getMainWindow, validateBackup, restorePath, chooseFolder }) {
  let backupWindow;
  const assertWindow = event => {
    if (!backupWindow || backupWindow.isDestroyed() || event.sender.id !== backupWindow.webContents.id) throw new Error("Backup controls are restricted to the local Backup window.");
  };
  const listedPath = async name => {
    const listing = await listBackups(backupRoot);
    return resolveBackupName(backupRoot, name, listing.map(item => item.name));
  };

  function openWindow() {
    if (backupWindow && !backupWindow.isDestroyed()) { backupWindow.show(); backupWindow.focus(); return; }
    backupWindow = new BrowserWindow({
      width: 800, height: 560, minWidth: 680, minHeight: 440, show: false, autoHideMenuBar: true, title: "Backups", frame: false,
      parent: getMainWindow() ?? undefined, ...(icon ? { icon } : {}),
      webPreferences: { preload: join(moduleRoot, "src", "backup-window", "preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
    });
    backupWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    backupWindow.webContents.on("will-navigate", event => event.preventDefault());
    const window = backupWindow;
    window.once("ready-to-show", () => window.show());
    window.on("closed", () => { if (backupWindow === window) backupWindow = undefined; });
    void window.loadFile(join(moduleRoot, "src", "backup-window", "index.html"));
  }

  function registerIpc() {
    ipcMain.handle("backups:list", async event => { assertWindow(event); return listBackups(backupRoot); });
    ipcMain.handle("backups:verify", async (event, name) => {
      assertWindow(event);
      const path = await listedPath(name);
      try { await validateBackup(path); return { status: "Verified", error: "" }; }
      catch (error) { return { status: "Failed", error: error.message }; }
    });
    ipcMain.handle("backups:restore", async (event, name) => {
      assertWindow(event);
      const path = await listedPath(name);
      return restorePath(path, backupWindow);
    });
    ipcMain.handle("backups:choose-folder", async event => { assertWindow(event); return chooseFolder(backupWindow); });
    ipcMain.handle("backups:close", event => { assertWindow(event); backupWindow.close(); });
  }

  return { openWindow, registerIpc };
}
