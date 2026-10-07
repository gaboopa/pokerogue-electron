const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("backupControl", {
  list: () => ipcRenderer.invoke("backups:list"),
  verify: name => ipcRenderer.invoke("backups:verify", name),
  restore: name => ipcRenderer.invoke("backups:restore", name),
  chooseFolder: () => ipcRenderer.invoke("backups:choose-folder"),
  close: () => ipcRenderer.invoke("backups:close"),
});
