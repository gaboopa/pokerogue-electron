const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("confirmationDialog", {
  options: () => ipcRenderer.invoke("dialog:options"),
  resize: height => ipcRenderer.send("dialog:resize", height),
  respond: index => ipcRenderer.send("dialog:respond", index),
});
