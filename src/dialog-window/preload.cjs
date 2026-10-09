const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("confirmationDialog", {
  options: () => ipcRenderer.invoke("dialog:options"),
  resize: height => ipcRenderer.send("dialog:resize", height),
  onResized: callback => ipcRenderer.on("dialog:resized", (_event, size) => callback(size)),
  respond: index => ipcRenderer.send("dialog:respond", index),
});
