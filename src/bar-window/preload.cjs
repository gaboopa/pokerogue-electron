const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("windowBar", {
  receiveState: callback => ipcRenderer.on("bar:state", (_event, state) => callback(state)),
  activateItem: id => ipcRenderer.send("bar:activate", id),
  menuOpened: () => ipcRenderer.send("bar:menu-opened"),
  menuClosed: () => ipcRenderer.send("bar:menu-closed"),
  escape: () => ipcRenderer.send("bar:escape"),
  minimize: () => ipcRenderer.send("bar:minimize"),
  toggleMaximize: () => ipcRenderer.send("bar:toggle-maximize"),
  close: () => ipcRenderer.send("bar:close"),
  openUpdate: () => ipcRenderer.send("bar:open-update"),
});
