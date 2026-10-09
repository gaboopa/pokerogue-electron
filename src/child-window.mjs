import { BrowserWindow } from "electron";

export function createChildWindow(options, preload) {
  const window = new BrowserWindow({
    ...options, show: false, autoHideMenuBar: true, frame: false,
    webPreferences: { ...(preload ? { preload } : {}), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", event => event.preventDefault());
  return window;
}
