import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("pokerogueDesktop", Object.freeze({
  getVersion: () => ipcRenderer.invoke("app:get-version"),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  backupSaves: () => ipcRenderer.invoke("saves:backup"),
  restoreSaves: () => ipcRenderer.invoke("saves:restore"),
  openSaveFolder: () => ipcRenderer.invoke("saves:open-folder"),
}));
