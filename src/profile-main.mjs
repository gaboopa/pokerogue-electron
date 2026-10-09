import { ipcMain } from "electron";
import { join } from "node:path";
import { createChildWindow } from "./child-window.mjs";

export function createProfileController({ moduleRoot, icon, getMainWindow, createAndRestart }) {
  let profileWindow;
  const assertProfileWindow = event => {
    if (!profileWindow || profileWindow.isDestroyed() || event.sender.id !== profileWindow.webContents.id) {
      throw new Error("Profile creation is restricted to the local profile window.");
    }
  };

  function openWindow() {
    if (profileWindow && !profileWindow.isDestroyed()) { profileWindow.show(); profileWindow.focus(); return; }
    profileWindow = createChildWindow({
      width: 480, height: 360, resizable: false, title: "New Profile",
      parent: getMainWindow() ?? undefined, ...(icon ? { icon } : {}),
    }, join(moduleRoot, "src", "profile-window", "preload.cjs"));
    const window = profileWindow;
    window.once("ready-to-show", () => window.show());
    window.on("closed", () => { if (profileWindow === window) profileWindow = undefined; });
    void window.loadFile(join(moduleRoot, "src", "profile-window", "index.html"));
  }

  function registerIpc() {
    ipcMain.handle("profiles:create", async (event, name) => { assertProfileWindow(event); return createAndRestart(name); });
    ipcMain.handle("profiles:close", event => { assertProfileWindow(event); profileWindow.close(); });
  }

  return { openWindow, registerIpc };
}
