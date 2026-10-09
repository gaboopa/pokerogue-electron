const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("updateProgress", {
  receive: callback => ipcRenderer.on("update:progress", (_event, progress) => callback(progress)),
  cancel: () => ipcRenderer.send("update:cancel"),
  close: () => ipcRenderer.send("update:close"),
});
