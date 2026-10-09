import { BrowserWindow, dialog, ipcMain, screen } from "electron";
import { join } from "node:path";
import { MAXIMUM_FUN_CHEATS, NEUTRAL_CHEATS, applyCheatConfiguration, loadCheatDocument } from "./cheats.mjs";
import { showThemedMessageBox } from "./dialog-main.mjs";

export function cheatWindowSize({ width: workAreaWidth, height: workAreaHeight }) {
  return {
    width: Math.min(1140, workAreaWidth),
    height: Math.min(880, workAreaHeight),
    minWidth: Math.min(1140, workAreaWidth),
    minHeight: Math.min(700, workAreaHeight),
  };
}

export function createCheatController({ moduleRoot, configPath, icon, getMainWindow, backup, relaunch }) {
  let editorWindow;
  const assertEditor = event => {
    if (!editorWindow || editorWindow.isDestroyed() || event.sender.id !== editorWindow.webContents.id) throw new Error("Cheat configuration writes are restricted to the local control center.");
  };
  const confirm = async (_current, next) => {
    const candidate = editorWindow && !editorWindow.isDestroyed() ? editorWindow : getMainWindow();
    const parent = candidate && !candidate.isDestroyed() ? candidate : undefined;
    const options = {
      type: "warning", title: "Shared save warning",
      message: next.enabled ? "Apply cheats to shared saves?" : "Disable cheats for shared saves?",
      detail: "A verified timestamped backup will be created before this change. Progress earned while cheats were active will remain in your saves.",
      buttons: ["Back Up and Restart", "Cancel"], defaultId: 1, cancelId: 1, noLink: true,
    };
    const result = await (parent ? showThemedMessageBox(parent, options) : dialog.showMessageBox(options));
    return result.response === 0;
  };
  const apply = requested => applyCheatConfiguration({ path: configPath, requested, confirm, backup, relaunch });

  function openWindow() {
    if (editorWindow && !editorWindow.isDestroyed()) { editorWindow.show(); editorWindow.focus(); return; }
    const candidate = getMainWindow();
    const parent = candidate && !candidate.isDestroyed() ? candidate : undefined;
    const workArea = parent ? screen.getDisplayMatching(parent.getBounds()).workAreaSize : screen.getPrimaryDisplay().workAreaSize;
    editorWindow = new BrowserWindow({
      ...cheatWindowSize(workArea), show: false, autoHideMenuBar: true, frame: false, title: "Cheat Control Center",
      ...(parent ? { parent } : {}), ...(icon ? { icon } : {}),
      webPreferences: { preload: join(moduleRoot, "src", "cheat-window", "preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
    });
    editorWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    editorWindow.webContents.on("will-navigate", event => event.preventDefault());
    editorWindow.once("ready-to-show", () => editorWindow.show());
    editorWindow.on("closed", () => { editorWindow = undefined; });
    void editorWindow.loadFile(join(moduleRoot, "src", "cheat-window", "index.html"));
  }

  function registerIpc() {
    ipcMain.handle("cheats:get-config", async () => (await loadCheatDocument(configPath)).config);
    ipcMain.handle("cheats:load-editor", async event => { assertEditor(event); return { config: (await loadCheatDocument(configPath)).config, maximum: structuredClone(MAXIMUM_FUN_CHEATS) }; });
    ipcMain.handle("cheats:apply", async (event, config) => { assertEditor(event); return apply(config); });
    ipcMain.handle("cheats:reset", async event => { assertEditor(event); return apply(NEUTRAL_CHEATS); });
    ipcMain.on("cheats:close", event => { assertEditor(event); editorWindow.close(); });
  }

  return { openWindow, registerIpc };
}
