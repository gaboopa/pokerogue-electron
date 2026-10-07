const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("profileControl", {
  create: name => ipcRenderer.invoke("profiles:create", name),
  close: () => ipcRenderer.invoke("profiles:close"),
});
