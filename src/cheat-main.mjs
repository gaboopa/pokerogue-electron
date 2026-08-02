import { BrowserWindow, dialog, ipcMain } from "electron";
import { join } from "node:path";
import { MAXIMUM_FUN_CHEATS, NEUTRAL_CHEATS, applyCheatConfiguration, loadCheatDocument } from "./cheats.mjs";

export function createCheatController({ moduleRoot, configPath, icon, getMainWindow, backup, relaunch }) {
  let editorWindow;
  const assertEditor = event => {
    if (!editorWindow || editorWindow.isDestroyed() || event.sender.id !== editorWindow.webContents.id) throw new Error("Cheat configuration writes are restricted to the local control center.");
  };
  const confirm = async (_current, next) => {
    const result = await dialog.showMessageBox(editorWindow ?? getMainWindow(), {
      type: "warning", title: "Shared save warning",
      message: next.enabled ? "Apply cheats to shared saves?" : "Disable cheats for shared saves?",
      detail: "A verified timestamped backup will be created before this change. Progress earned while cheats were active will remain in your saves.",
      buttons: ["Back Up and Restart", "Cancel"], defaultId: 1, cancelId: 1, noLink: true,
    });
    return result.response === 0;
  };
  const apply = requested => applyCheatConfiguration({ path: configPath, requested, confirm, backup, relaunch });

  function openWindow() {
    if (editorWindow && !editorWindow.isDestroyed()) { editorWindow.show(); editorWindow.focus(); return; }
    editorWindow = new BrowserWindow({
      width: 760, height: 820, minWidth: 620, minHeight: 650, show: false, autoHideMenuBar: true,
      parent: getMainWindow() ?? undefined, ...(icon ? { icon } : {}),
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
