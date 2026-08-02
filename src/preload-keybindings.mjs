import { contextBridge, ipcRenderer } from "electron";
import { KeyRemapController, domCode, domKey } from "./keybindings.mjs";

const remapper = new KeyRemapController((type, key, repeat) => window.dispatchEvent(new KeyboardEvent(type, {
  key: domKey(key), code: domCode(key), repeat, bubbles: true, cancelable: true,
})));

function remapKeyboardEvent(event) {
  if (!remapper.handle(event)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

window.addEventListener("keydown", remapKeyboardEvent, true);
window.addEventListener("keyup", remapKeyboardEvent, true);
window.addEventListener("blur", () => remapper.releaseAll());
ipcRenderer.on("keybindings:update", (_event, mappings) => remapper.replaceMappings(mappings));

contextBridge.exposeInMainWorld("pokerogueDesktop", Object.freeze({
  getVersion: () => ipcRenderer.invoke("app:get-version"),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  backupSaves: () => ipcRenderer.invoke("saves:backup"),
  restoreSaves: () => ipcRenderer.invoke("saves:restore"),
  openSaveFolder: () => ipcRenderer.invoke("saves:open-folder"),
}));
