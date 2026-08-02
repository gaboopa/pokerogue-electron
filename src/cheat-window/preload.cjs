const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cheatControl", {
  load: () => ipcRenderer.invoke("cheats:load-editor"),
  applyConfig: config => ipcRenderer.invoke("cheats:apply", config),
  reset: () => ipcRenderer.invoke("cheats:reset"),
  close: () => ipcRenderer.send("cheats:close"),
});
